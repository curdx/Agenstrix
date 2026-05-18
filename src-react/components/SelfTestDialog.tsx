/**
 * SelfTestDialog — modal showing self-test failures with platform-specific fix commands.
 *
 * Features per D-10/11/12:
 * - Shows each warning's message + platform-appropriate fix command
 * - Copy button per fix command
 * - Re-check button calls /healthz and updates store
 */

import { Check, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SelfTestWarning } from "@/lib/store";
import { useStore } from "@/lib/store";

export interface SelfTestDialogProps {
  open: boolean;
  warnings: SelfTestWarning[];
  onClose: () => void;
}

// Detect platform for fix command
function getPlatform(): "mac" | "linux" | "windows" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "linux";
}

function getFixCmd(w: SelfTestWarning): string {
  const platform = getPlatform();
  if (platform === "windows") return w.fixWindows;
  if (platform === "mac") return w.fixMac;
  return w.fixLinux;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={handleCopy}
      aria-label="复制命令"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

export function SelfTestDialog({ open, warnings, onClose }: SelfTestDialogProps) {
  const setSelfTestWarnings = useStore((s) => s.setSelfTestWarnings);
  const [rechecking, setRechecking] = useState(false);

  async function handleRecheck() {
    setRechecking(true);
    try {
      // CR-02: /healthz returns the *cached* boot-time warnings; only
      // POST /api/selftest/recheck actually re-runs the self-test (INFRA-06).
      // The endpoint returns { ok, claudeFound, gitFound, sqliteWritable,
      // bunOk, warnings } — see rest.ts:83.
      const resp = await fetch("/api/selftest/recheck", { method: "POST" });
      if (resp.ok) {
        const data = (await resp.json()) as { warnings?: SelfTestWarning[] };
        const fresh = data.warnings ?? [];
        setSelfTestWarnings(fresh);
        if (fresh.length === 0) {
          onClose();
        }
      }
    } catch {
      // Network error — keep dialog open
    } finally {
      setRechecking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>系统检查失败</DialogTitle>
          <DialogDescription>运行以下命令修复问题，然后点击「重新检查」。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {warnings.map((w) => {
            const fixCmd = getFixCmd(w);
            return (
              <Alert key={w.item} variant="destructive" className="bg-destructive/5">
                <AlertDescription className="flex flex-col gap-2">
                  <span className="font-medium">{w.message}</span>
                  <div className="flex items-center gap-2 rounded bg-muted px-3 py-2">
                    <code className="flex-1 text-xs break-all font-mono text-foreground">
                      {fixCmd}
                    </code>
                    <CopyButton text={fixCmd} />
                  </div>
                </AlertDescription>
              </Alert>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button onClick={handleRecheck} disabled={rechecking}>
            {rechecking ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            重新检查
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
