---
created: 2026-05-18
source: phase-01-verification
resolves_phase: "01"
severity: low
type: cosmetic
component: src-react/components/WorkerTerminal.tsx
---

# WorkerTerminal WS cleanup warning under React 19 StrictMode

## Symptom
Browser console emits:
```
WebSocket connection to 'ws://localhost:5173/ws/worker/<id>' failed:
WebSocket is closed before the connection is established.
```
once per page load (and once per reload).

## Root cause
`main.tsx` wraps the tree in `<StrictMode>` — React 19 deliberately mounts every effect twice in development. `WorkerTerminal`'s `useEffect`:
1. opens WS (state = `CONNECTING`)
2. is torn down by StrictMode's first cleanup
3. cleanup calls `ws.close(1000)` while WS is still `CONNECTING` → browser warning
4. second mount opens a fresh WS — that one succeeds

Functional impact: zero. The user-visible terminal still gets populated by the REST history replay (`/api/workers/:id/chunks`), and the second WS bridge is the live one.

## Fix sketch
In `src-react/components/WorkerTerminal.tsx` cleanup:
```ts
return () => {
  if (loadingTimer) clearTimeout(loadingTimer);
  if (ws.readyState === WebSocket.CONNECTING) {
    // Wait for open before closing — avoid the browser warning
    ws.addEventListener('open', () => ws.close(1000), { once: true });
  } else if (ws.readyState === WebSocket.OPEN) {
    ws.close(1000);
  }
  term.dispose();
  ro.disconnect();
};
```

## Repro
1. `bun run dev:be` + `bunx vite`
2. Open http://localhost:5173
3. DevTools console → warning present

## When to fix
Low priority — pick up during Plan 01-02 (real `claude` worker) since that plan touches WorkerTerminal anyway, or as part of Phase 1 polish before merge.
