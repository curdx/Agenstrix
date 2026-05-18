/**
 * App.tsx — three-column shell per D-05 (Pattern 13).
 *
 * Layout:
 * - Left aside: Worker list (Phase 3+, empty sidebar Phase 1)
 * - Center: WorkspaceBar + SelfTestBanner + scrollable MessageCard area + ChatInput
 * - Right aside: Topology graph (Phase 3+, empty sidebar Phase 1)
 *
 * Boot flow:
 * 1. Fetch /healthz → seed store (workerId, pid, cwd, selfTestWarnings)
 * 2. Open SSE /sse/events for live system events
 */
import { useEffect, useRef } from "react";
import { ChatInput } from "@/components/ChatInput";
import { MessageCard } from "@/components/MessageCard";
import { SelfTestBanner } from "@/components/SelfTestBanner";
import { WorkspaceBar } from "@/components/WorkspaceBar";
import type { SelfTestWarning } from "@/lib/store";
import { useStore } from "@/lib/store";

interface HealthzResponse {
  ok: boolean;
  bunVersion?: string;
  skeletonWorkerId?: string;
  cwd?: string;
  selfTestWarnings?: SelfTestWarning[];
  pid?: number;
  startedAt?: number;
}

export function App() {
  const {
    skeletonWorkerId,
    skeletonPid,
    skeletonStartedAt,
    cwd,
    selfTestWarnings,
    setSkeletonWorker,
    setCwd,
    setSelfTestWarnings,
  } = useStore();

  const sseRef = useRef<EventSource | null>(null);

  // Boot: fetch /healthz → seed store
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const resp = await fetch("/healthz");
        if (!resp.ok || cancelled) return;
        const data: HealthzResponse = await resp.json();
        if (data.skeletonWorkerId) {
          setSkeletonWorker(data.skeletonWorkerId, data.pid, data.startedAt);
        }
        if (data.cwd) setCwd(data.cwd);
        setSelfTestWarnings(data.selfTestWarnings ?? []);
      } catch {
        // Network error — app shows empty state
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [setSkeletonWorker, setCwd, setSelfTestWarnings]);

  // SSE: subscribe to live system events
  useEffect(() => {
    const es = new EventSource("/sse/events");
    sseRef.current = es;

    es.addEventListener("event", (evt) => {
      try {
        const payload = JSON.parse(evt.data) as Record<string, unknown>;
        // worker.started event from the backend
        if (payload.type === "worker.started" && typeof payload.workerId === "string") {
          setSkeletonWorker(
            payload.workerId,
            typeof payload.pid === "number" ? payload.pid : undefined,
            typeof payload.startedAt === "number" ? payload.startedAt : undefined
          );
        }
      } catch {
        // Ignore malformed SSE payload
      }
    });

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [setSkeletonWorker]);

  // Send text → PTY stdin via REST
  async function handleSend(text: string) {
    if (!skeletonWorkerId) return;
    try {
      await fetch(`/api/workers/${skeletonWorkerId}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch {
      // Ignore — terminal will show error via WS stream
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left sidebar — Worker list (Phase 3+) */}
      <aside className="w-56 shrink-0 border-r border-border/50 hidden lg:block" />

      {/* Center: main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <WorkspaceBar cwd={cwd} />

        {/* Self-test warnings banner */}
        <SelfTestBanner warnings={selfTestWarnings} />

        {/* Scrollable message / terminal area */}
        <div className="flex-1 overflow-y-auto p-4">
          {skeletonWorkerId ? (
            <MessageCard
              workerId={skeletonWorkerId}
              label="Master Claude"
              pid={skeletonPid ?? undefined}
              startedAt={skeletonStartedAt ?? undefined}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">正在启动 Master Claude…</p>
            </div>
          )}
        </div>

        {/* Chat input */}
        <ChatInput
          onSend={handleSend}
          disabled={!skeletonWorkerId}
          placeholder={
            skeletonWorkerId
              ? "给 Master Claude 发送消息… (Enter 发送，Shift+Enter 换行)"
              : "等待 Master Claude 启动…"
          }
        />
      </main>

      {/* Right sidebar — Topology graph (Phase 3+) */}
      <aside className="w-56 shrink-0 border-l border-border/50 hidden xl:block" />
    </div>
  );
}
