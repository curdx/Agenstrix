/**
 * AnsiChunkBatcher — ANSI-aware chunk batching for SQLite persistence.
 *
 * SKELETON STUB in Phase 1: immediately flushes every ingested chunk.
 * Plan 02 replaces with real VT500 state machine (ANSI-SPLITTER-01).
 *
 * Key design invariant: forward to WS immediately (caller does this BEFORE calling ingest).
 * The batcher is only for SQLite persistence atomicity.
 */

export class AnsiChunkBatcher {
  private readonly onFlush: (chunk: Uint8Array) => void;

  constructor(onFlush: (chunk: Uint8Array) => void) {
    this.onFlush = onFlush;
  }

  /**
   * Ingest a chunk. In Phase 1: immediately calls onFlush (no batching).
   * Plan 02: implements VT500 state machine with ~100KB / 250ms flush.
   */
  ingest(chunk: Uint8Array): void {
    // SKELETON STUB — Plan 02 replaces with real ANSI state machine (ANSI-SPLITTER-01)
    this.onFlush(chunk);
  }

  /**
   * Force flush any buffered bytes (called on shutdown).
   * In Phase 1: no-op (nothing buffered).
   */
  flushNow(): void {
    // SKELETON STUB — Plan 02 implements
  }
}
