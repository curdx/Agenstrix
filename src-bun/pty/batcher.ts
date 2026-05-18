/**
 * AnsiChunkBatcher — ANSI-safe chunk batching for SQLite persistence.
 *
 * ANSI-SPLITTER-01: Guarantees that flushed chunks never end in the middle
 * of an ANSI/VT500 escape sequence.  Partial sequences are held in the tail
 * buffer and forwarded on the NEXT ingest() call.
 *
 * Flush triggers (non-forced):
 *   - bytesSinceFlush >= maxBytes (default 100_000)
 *   - maxMs timer fires (default 250ms)
 *   - Both triggers fire only when state === GROUND (safe boundary)
 *
 * Forced flush (flushNow / shutdown):
 *   - Emits ALL buffered bytes including any partial tail sequence
 *   - Required at shutdown to prevent data loss
 */

// VT500-series parser states (Paul Williams state machine, simplified)
enum AnsiState {
  GROUND = 0, // Normal text; safe flush boundary
  ESC = 1, // Received 0x1B; awaiting next byte
  CSI_PARAM = 2, // ESC [ — reading parameter bytes (0x30–0x3F)
  CSI_INTERM = 3, // CSI intermediate bytes (0x20–0x2F)
  OSC_STRING = 4, // ESC ] — reading until BEL (0x07) or ESC \
  DCS_STRING = 5, // ESC P — reading until ESC \
  PM_STRING = 6, // ESC ^ — reading until ESC \
  APC_STRING = 7, // ESC _ — reading until ESC \
  SOS_STRING = 8, // ESC X — reading until ESC \
  STRING_ST = 9, // Inside a string, received ESC — waiting for \ to complete ST
}

// The STRING_ST state carries a "return" context so we know which string type
// to return to if the ESC is NOT followed by \.
type StringState =
  | AnsiState.OSC_STRING
  | AnsiState.DCS_STRING
  | AnsiState.PM_STRING
  | AnsiState.APC_STRING
  | AnsiState.SOS_STRING;

export interface AnsiChunkBatcherOpts {
  onFlush: (chunk: Uint8Array) => void;
  maxBytes?: number; // default 100_000 (~100KB)
  maxMs?: number; // default 250ms
}

export class AnsiChunkBatcher {
  private readonly onFlush: (chunk: Uint8Array) => void;
  private readonly maxBytes: number;
  private readonly maxMs: number;

  private state: AnsiState = AnsiState.GROUND;
  // When in STRING_ST, remember which string type to resume if ESC is not \ :
  private prevStringState: StringState = AnsiState.OSC_STRING;

  // Bytes that are safe to flush (state was GROUND at end of these bytes)
  private safeBuffer: Uint8Array[] = [];
  private safeBytesTotal = 0;

  // Bytes that form an incomplete sequence (state != GROUND at end)
  private tail: Uint8Array | null = null;

  // Timer for maxMs flush
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: AnsiChunkBatcherOpts) {
    this.onFlush = opts.onFlush;
    this.maxBytes = opts.maxBytes ?? 100_000;
    this.maxMs = opts.maxMs ?? 250;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  ingest(chunk: Uint8Array): void {
    // Prepend any incomplete tail from the last ingest
    const input = this.tail !== null ? concatArrays(this.tail, chunk) : chunk;
    this.tail = null;

    // Walk the bytes, tracking state and GROUND boundaries.
    // We may need to emit multiple intermediate flushes for large inputs.
    let segStart = 0; // start of the current "not yet committed" segment
    let lastGroundIdx = -1; // index of last safe boundary within current segment
    let state = this.state;
    let prevStrState = this.prevStringState;

    for (let i = 0; i < input.length; i++) {
      const b = input[i] ?? 0;
      state = this.transition(state, b, prevStrState, (next) => {
        prevStrState = next;
      });

      if (state === AnsiState.GROUND) {
        lastGroundIdx = i;
      }

      // If we've accumulated enough safe bytes, emit a size-based flush mid-walk
      const candidateSafeBytes =
        this.safeBytesTotal + (lastGroundIdx >= segStart ? lastGroundIdx - segStart + 1 : 0);
      if (candidateSafeBytes >= this.maxBytes && lastGroundIdx >= segStart) {
        // Commit bytes up to lastGroundIdx into safeBuffer and flush
        const safe = input.subarray(segStart, lastGroundIdx + 1);
        this.safeBuffer.push(safe);
        this.safeBytesTotal += safe.length;
        this.flushInner();
        segStart = lastGroundIdx + 1;
        lastGroundIdx = -1;
      }
    }

    this.state = state;
    this.prevStringState = prevStrState;

    // Remaining bytes after the last mid-walk flush
    if (segStart < input.length) {
      if (lastGroundIdx >= segStart) {
        // Safe bytes from segStart up to lastGroundIdx
        const safe = input.subarray(segStart, lastGroundIdx + 1);
        this.safeBuffer.push(safe);
        this.safeBytesTotal += safe.length;

        const remainder = input.subarray(lastGroundIdx + 1);
        this.tail = remainder.length > 0 ? remainder.slice() : null;
      } else {
        // No GROUND boundary in remaining segment — all is tail
        this.tail = input.subarray(segStart).slice();
      }
    }

    // Size-based flush trigger for remaining safeBuffer
    if (this.safeBytesTotal >= this.maxBytes) {
      this.flushInner();
    } else if (this.safeBytesTotal > 0) {
      // (Re)arm the timer
      this.armTimer();
    }
  }

  /**
   * Force-flush everything including any incomplete tail sequence.
   * Called at shutdown to prevent data loss.
   */
  flushNow(): void {
    this.clearTimer();

    const parts: Uint8Array[] = [...this.safeBuffer];
    if (this.tail !== null) {
      parts.push(this.tail);
      this.tail = null;
    }

    const combined = concatArrays(...parts);
    if (combined.length > 0) {
      this.onFlush(combined);
    }

    this.safeBuffer = [];
    this.safeBytesTotal = 0;
    this.state = AnsiState.GROUND;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Flush the safeBuffer (does NOT include tail — state is non-GROUND).
   * Called by size trigger and timer.
   */
  private flushInner(): void {
    this.clearTimer();

    if (this.safeBytesTotal === 0) {
      return;
    }

    const combined = concatArrays(...this.safeBuffer);
    this.safeBuffer = [];
    this.safeBytesTotal = 0;

    if (combined.length > 0) {
      this.onFlush(combined);
    }
  }

  private armTimer(): void {
    if (this.flushTimer !== null) return; // already armed
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushInner();
    }, this.maxMs);
  }

  private clearTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * VT500-series state machine transition.
   * Returns the next state after processing byte `b`.
   */
  private transition(
    state: AnsiState,
    b: number,
    prevStrState: StringState,
    setPrevStrState: (s: StringState) => void
  ): AnsiState {
    switch (state) {
      case AnsiState.GROUND:
        if (b === 0x1b) return AnsiState.ESC;
        return AnsiState.GROUND;

      case AnsiState.ESC:
        if (b === 0x5b) return AnsiState.CSI_PARAM; // ESC [ → CSI
        if (b === 0x5d) {
          setPrevStrState(AnsiState.OSC_STRING);
          return AnsiState.OSC_STRING; // ESC ] → OSC
        }
        if (b === 0x50) {
          setPrevStrState(AnsiState.DCS_STRING);
          return AnsiState.DCS_STRING; // ESC P → DCS
        }
        if (b === 0x5e) {
          setPrevStrState(AnsiState.PM_STRING);
          return AnsiState.PM_STRING; // ESC ^ → PM
        }
        if (b === 0x5f) {
          setPrevStrState(AnsiState.APC_STRING);
          return AnsiState.APC_STRING; // ESC _ → APC
        }
        if (b === 0x58) {
          setPrevStrState(AnsiState.SOS_STRING);
          return AnsiState.SOS_STRING; // ESC X → SOS
        }
        // Other C1 (0x40–0x5F two-byte sequence), or any other byte → GROUND
        return AnsiState.GROUND;

      case AnsiState.CSI_PARAM:
        if (b >= 0x30 && b <= 0x3f) return AnsiState.CSI_PARAM; // param bytes
        if (b >= 0x20 && b <= 0x2f) return AnsiState.CSI_INTERM; // intermediate
        if (b >= 0x40 && b <= 0x7e) return AnsiState.GROUND; // final byte
        // Control bytes inside CSI — treat as aborting CSI, return to GROUND
        return AnsiState.GROUND;

      case AnsiState.CSI_INTERM:
        if (b >= 0x20 && b <= 0x2f) return AnsiState.CSI_INTERM; // more intermediate
        if (b >= 0x40 && b <= 0x7e) return AnsiState.GROUND; // final byte
        return AnsiState.GROUND;

      case AnsiState.OSC_STRING:
      case AnsiState.DCS_STRING:
      case AnsiState.PM_STRING:
      case AnsiState.APC_STRING:
      case AnsiState.SOS_STRING:
        if (b === 0x07 && state === AnsiState.OSC_STRING) {
          return AnsiState.GROUND; // OSC terminated by BEL
        }
        if (b === 0x1b) {
          setPrevStrState(state as StringState);
          return AnsiState.STRING_ST; // ESC inside string — wait for \
        }
        return state; // Stay in string state

      case AnsiState.STRING_ST:
        if (b === 0x5c) {
          return AnsiState.GROUND; // ESC \ — String Terminator completes
        }
        // ESC followed by something other than \ — treat ESC as part of payload,
        // resume the original string state and process this byte there.
        return this.transition(prevStrState, b, prevStrState, setPrevStrState);

      default:
        return AnsiState.GROUND;
    }
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function concatArrays(...arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 0) return new Uint8Array(0);
  if (arrays.length === 1) return arrays[0] ?? new Uint8Array(0);

  let total = 0;
  for (const a of arrays) total += a.length;

  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}
