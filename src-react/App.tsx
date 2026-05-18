/**
 * App.tsx — three-column shell per D-05.
 * Placeholder implementation for Task 1; Task 3 completes the full UI.
 */
export function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left sidebar placeholder */}
      <aside className="w-64 shrink-0 border-r border-border" />

      {/* Center: main content area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading Agenstrix…</p>
        </div>
      </main>

      {/* Right sidebar placeholder */}
      <aside className="w-64 shrink-0 border-l border-border" />
    </div>
  );
}
