/**
 * WorkerTerminal — xterm.js + WebSocket bridge with history replay.
 *
 * Implements D-07 (WeChat-style replay), D-08 (no replay animation),
 * D-09 (500ms loading spinner).
 *
 * Addon load order (RESEARCH.md §Pattern 12):
 * 1. FitAddon — no dependency
 * 2. Unicode11Addon — requires allowProposedApi: true
 * 3. term.unicode.activeVersion = "11" — after loading, before open()
 * 4. WebLinksAddon
 * 5. try WebglAddon (catch → CanvasAddon)
 * 6. term.open() — container MUST be visible (Landmine #5)
 * 7. fit.fit()
 *
 * WS pattern (RESEARCH.md §Pattern 4):
 * - Open WS first, buffer live chunks
 * - Fetch history in ws.onopen (avoids race condition)
 * - Replay history → then flush live buffer → wsReady = true
 */

import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

export interface WorkerTerminalProps {
  workerId: string;
  isFullscreen?: boolean; // controls layout, not addon re-init (Landmine #14)
}

export function WorkerTerminal({ workerId }: WorkerTerminalProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!divRef.current) return;

    // MUST: container must be visible before term.open() (Landmine #5, Pitfall 3)
    const container = divRef.current;

    // Terminal constructor — MUST include allowProposedApi: true for Unicode11 (Landmine #6)
    const term = new Terminal({
      fontFamily: 'ui-monospace, "JetBrains Mono", "Cascadia Code", monospace',
      fontSize: 13,
      convertEol: false, // PTY is authoritative — no EOL transforms (D-07)
      cursorBlink: true,
      allowProposedApi: true, // required for Unicode11Addon
      scrollback: 100_000, // D-07 + D-08: WeChat-style full history
      theme: {
        background: "#1a1b1e",
        foreground: "#d4d4d8",
        cursor: "#d4d4d8",
        selectionBackground: "#3a3a5c",
      },
    });

    // Addon load order (Pattern 12): FitAddon → Unicode11 → WebLinks → WebGL/Canvas
    const fit = new FitAddon();
    term.loadAddon(fit);

    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11"; // activate AFTER loading addon

    term.loadAddon(new WebLinksAddon());

    // WebGL renderer with Canvas fallback
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      try {
        term.loadAddon(new CanvasAddon());
      } catch {
        // DOM fallback — no-op
      }
    }

    // Defer term.open() until the container actually has a real width.
    // Under React 19 StrictMode the first effect run can fire before CSS
    // layout has finalized — clientWidth can be ~0 or single-digit pixels,
    // FitAddon would then compute cols≈3 and pin xterm to a narrow strip
    // that ResizeObserver re-fits CANNOT visually repair after content has
    // already been written into the cramped grid (Landmine #5 / Pitfall 3
    // generalized: visible-but-not-yet-sized parents).
    //
    // Minimum container width threshold below which we refuse to call open():
    const MIN_OPEN_WIDTH_PX = 100;

    let opened = false; // tracks whether term.open() has run
    let onOpened: (() => void) | null = null; // wired below to flush pending bytes
    const openTerminalWhenReady = () => {
      if (opened) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < MIN_OPEN_WIDTH_PX || h < 20) return;
      opened = true;
      term.open(container);
      fit.fit();
      // Notify server-side PTY of the actually-sized cols/rows so the very
      // first claude TUI repaint matches the renderer grid (the 100ms
      // timeout that used to live here was racy under StrictMode).
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
      onOpened?.();
    };

    // ── History replay + live stream (D-07: WeChat-style) ──────────────────
    let wsReady = false;
    const pendingLive: Uint8Array[] = [];

    // Open WS FIRST, buffer live chunks (avoids race between history fetch and live stream)
    const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/worker/${workerId}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    // D-09: show loading spinner only after 500ms
    let loadingTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      setIsLoading(true);
      loadingTimer = null;
    }, 500);

    ws.onmessage = (evt) => {
      const data = evt.data as ArrayBuffer;
      const chunk = new Uint8Array(data);
      if (chunk.length === 0) return; // heartbeat null frame — ignore

      // Buffer if either (a) WS not finished with history replay yet, or
      // (b) xterm hasn't been opened (container size not finalized) — writing
      // to a terminal that hasn't called open() drops content into a 0-size
      // buffer that the eventual renderer can't reformat.
      if (!wsReady || !opened) {
        pendingLive.push(chunk);
        return;
      }
      term.write(chunk);
    };

    // Tries to open the terminal NOW (if container is already sized) so the
    // initial resize frame races with WS handshake — but is safe to call
    // before any size is available; the ResizeObserver below picks it up.
    openTerminalWhenReady();

    ws.onopen = async () => {
      // Notify server-side PTY of cols/rows the instant the socket is up,
      // if the terminal has already been opened. If not, openTerminalWhenReady
      // will send the resize once it runs.
      if (opened) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }

      let historyBytes: Uint8Array[] = [];
      try {
        // Fetch full history via REST (D-07: one-shot HTTP GET)
        const resp = await fetch(`/api/workers/${workerId}/chunks`);
        if (resp.ok) {
          const chunks = (await resp.json()) as Array<{ bytes: string; seq: number }>;
          // Sort by seq just in case (should already be ordered)
          chunks.sort((a, b) => a.seq - b.seq);
          historyBytes = chunks.map((c) =>
            Uint8Array.from(atob(c.bytes), (ch) => ch.charCodeAt(0))
          );
        }
      } catch {
        // Ignore history fetch failure — live stream continues
      } finally {
        // Defer all writes until the terminal has been opened with a real
        // size. If `opened` is already true we flush immediately; otherwise
        // `onOpened` (set just below) will run the flush when
        // openTerminalWhenReady() finally succeeds.
        const flush = () => {
          for (const b of historyBytes) term.write(b);
          for (const chunk of pendingLive) term.write(chunk);
          pendingLive.length = 0;
          wsReady = true;

          // Hide loading indicator
          if (loadingTimer) {
            clearTimeout(loadingTimer);
            loadingTimer = null;
          }
          setIsLoading(false);

          // Scroll to bottom (show latest content per D-07)
          term.scrollToBottom();
        };

        if (opened) {
          flush();
        } else {
          onOpened = flush;
        }
      }
    };

    ws.onerror = () => {
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
      setIsLoading(false);
    };

    // Keystroke injection — terminal keys → PTY stdin via WS
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Resize observer — open on first measurable size, then re-fit + notify
    // server on subsequent resizes.
    const ro = new ResizeObserver(() => {
      if (!opened) {
        openTerminalWhenReady();
        return;
      }
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    });
    ro.observe(container);

    // Belt-and-suspenders rAF chain: some browsers don't fire ResizeObserver
    // for the initial layout if the element was 0×0 on mount and only grew
    // due to its parent's flexbox measurement — poll for up to ~5 frames.
    let rafTries = 0;
    const rafTick = () => {
      if (opened) return;
      openTerminalWhenReady();
      if (!opened && rafTries++ < 5) {
        requestAnimationFrame(rafTick);
      }
    };
    requestAnimationFrame(rafTick);

    // Cleanup
    return () => {
      if (loadingTimer) clearTimeout(loadingTimer);
      ws.close(1000); // normal client closure
      term.dispose();
      ro.disconnect();
    };
  }, [workerId]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Loading overlay — only shown after 500ms (D-09) */}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </div>
      )}
      <div ref={divRef} style={{ width: "100%", height: "100%" }} className="overflow-hidden" />
    </div>
  );
}
