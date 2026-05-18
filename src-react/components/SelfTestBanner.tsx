/**
 * SelfTestBanner — red banner shown when self-test warnings are present.
 *
 * Clicking the banner or any chip opens the SelfTestDialog.
 * Hidden when there are no warnings.
 */

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import type { SelfTestWarning } from "@/lib/store";
import { SelfTestDialog } from "./SelfTestDialog";

export interface SelfTestBannerProps {
  warnings: SelfTestWarning[];
}

export function SelfTestBanner({ warnings }: SelfTestBannerProps) {
  const [open, setOpen] = useState(false);

  if (warnings.length === 0) return null;

  return (
    <>
      <button
        type="button"
        aria-label="查看自检警告详情"
        onClick={() => setOpen(true)}
        className="flex w-full cursor-pointer items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-medium">系统检查发现问题：</span>
        <span className="flex flex-wrap gap-1">
          {warnings.map((w) => (
            <span
              key={w.item}
              className="rounded border border-destructive/30 bg-destructive/20 px-1.5 py-0.5 text-xs font-mono"
            >
              {w.item}
            </span>
          ))}
        </span>
        <span className="ml-auto text-xs underline underline-offset-2">点击查看详情</span>
      </button>

      <SelfTestDialog open={open} warnings={warnings} onClose={() => setOpen(false)} />
    </>
  );
}
