/**
 * Secret redactor — inline PTY pipeline stage.
 * Placement: BEFORE SQLite write AND BEFORE WS forward (single pass).
 *
 * SKELETON STUB in Phase 1: identity function (returns chunk unchanged).
 * Plan 05 replaces with real regex pipeline (SEC-01).
 *
 * Target patterns (Plan 05):
 *   sk-ant-[A-Za-z0-9_-]{20,}  → ANTHROPIC key
 *   ghp_[A-Za-z0-9]{36}        → GitHub token
 *   sk-[A-Za-z0-9]{40,}        → OpenAI key
 *   AKIA[0-9A-Z]{16}            → AWS access key
 */

// SKELETON STUB — Plan 05 replaces with real regex pipeline (SEC-01)
export function redactChunk(chunk: Uint8Array): Uint8Array {
  return chunk;
}
