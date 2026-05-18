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
          {/* Status dot — green when running */}
          <div className="size-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm font-medium">{label}</span>
          {pid !== undefined && <span className="text-xs text-muted-foreground">PID {pid}</span>}
          {startedAt !== undefined && (
            <span className="text-xs text-muted-foreground">{formatUptime(uptimeMs)}</span>
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
