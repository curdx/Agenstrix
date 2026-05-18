/**
 * MessageCard — reusable container for Master/Worker agents (D-05, D-06).
 *
 * Per D-06: this is the FINAL component shape, not throwaway.
 * Phase 3+ Workers each get their own MessageCard instance.
 *
 * Features:
 * - Card header: status dot + label + PID + uptime ticker
 * - Card body: embedded WorkerTerminal (xterm.js)
 * - ⤢ fullscreen toggle (CSS approach — no DOM remount, Landmine #14)
 */

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { WorkerTerminal } from "./WorkerTerminal";

export interface MessageCardProps {
  workerId: string;
  label: string; // "Master Claude" in Phase 1
  pid?: number;
  startedAt?: number;
}

function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

export function MessageCard({ workerId, label, pid, startedAt }: MessageCardProps) {
  const [uptimeMs, setUptimeMs] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Uptime ticker (1s interval)
  useEffect(() => {
    if (startedAt) {
      setUptimeMs(Date.now() - startedAt);
      intervalRef.current = setInterval(() => {
        setUptimeMs(Date.now() - startedAt);
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startedAt]);

  // SSE subscription: listen for worker.exited events (Plan 02 — D-01)
  useEffect(() => {
    const es = new EventSource("/sse/events");
    const handleEvent = (evt: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(evt.data) as {
          type?: string;
          workerId?: string;
          payload?: { exitCode?: number };
        };
        if (parsed.type === "worker.exited" && parsed.workerId === workerId) {
          setExitCode(parsed.payload?.exitCode ?? null);
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch {
        // Ignore malformed SSE payloads
      }
    };
    es.addEventListener("event", handleEvent);
    return () => {
      es.removeEventListener("event", handleEvent);
      es.close();
    };
  }, [workerId]);

  // D-01: use label prop as-is (caller sets "Master Claude" for the master worker)
  const displayLabel = label;

  return (
    <Card
      className={cn(
        "flex flex-col overflow-hidden transition-all duration-200",
        isFullscreen && "fixed inset-0 z-50 rounded-none border-0"
      )}
      data-fullscreen={isFullscreen}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 py-2 px-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          {/* Status dot — green when running, gray when exited */}
          <div
            className={cn(
              "size-2 rounded-full",
              exitCode !== null ? "bg-gray-400" : "bg-green-500 animate-pulse"
            )}
          />
          <span className="text-sm font-medium">{displayLabel}</span>
          {pid !== undefined && <span className="text-xs text-muted-foreground">PID {pid}</span>}
          {startedAt !== undefined && exitCode === null && (
            <span className="text-xs text-muted-foreground">{formatUptime(uptimeMs)}</span>
          )}
          {exitCode !== null && (
            <span className="text-xs text-muted-foreground">Exited with code {exitCode}</span>
          )}
        </div>

        {/* ⤢ Fullscreen toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setIsFullscreen((prev) => !prev)}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </CardHeader>

      <CardContent
        className={cn("flex-1 p-0 overflow-hidden", isFullscreen ? "h-full" : "min-h-[400px]")}
      >
        {/* WorkerTerminal — CSS fullscreen (no DOM remount, preserves scrollback — Landmine #14) */}
        <WorkerTerminal workerId={workerId} isFullscreen={isFullscreen} />
      </CardContent>
    </Card>
  );
}
