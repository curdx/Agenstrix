/**
 * WorkspaceBar — top bar showing current working directory.
 * Phase 1: display-only. Phase 2+: clickable workspace switcher.
 */

export interface WorkspaceBarProps {
  cwd: string;
}

export function WorkspaceBar({ cwd }: WorkspaceBarProps) {
  return (
    <header className="border-b border-border/50 px-4 py-2 text-sm text-muted-foreground shrink-0">
      {cwd ? (
        <>
          <span className="font-medium text-foreground/60">cwd:</span>{" "}
          <span className="font-mono">{cwd}</span>
        </>
      ) : (
        <span className="italic">工作目录未设置</span>
      )}
    </header>
  );
}
