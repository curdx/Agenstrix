/**
 * Unit tests for AnsiChunkBatcher (ANSI-SPLITTER-01).
 *
 * Contract: chunks flushed to SQLite must NEVER end in the middle of an
 * ANSI/VT500 escape sequence.  Partial sequences are held in the tail
 * buffer and forwarded on the NEXT ingest() call.
 *
 * Tests 1–9 mirror the plan acceptance criteria exactly.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { AnsiChunkBatcher } from "../../src-bun/pty/batcher";

// ---------------------------------------------------------------------------
// Helper: collect all flushed Uint8Arrays into an array
// ---------------------------------------------------------------------------
function makeCollector(): { flushed: Uint8Array[]; batcher: AnsiChunkBatcher } {
  const flushed: Uint8Array[] = [];
  const batcher = new AnsiChunkBatcher({
    onFlush: (chunk) => flushed.push(chunk),
  });
  return { flushed, batcher };
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function decode(u: Uint8Array): string {
  return new TextDecoder().decode(u);
}

// Check that no flushed chunk ends with a "raw ESC open" pattern (bytes that
// end mid-sequence: bare ESC at end, or ESC + [ with no final byte yet, etc.)
function assertNoMidSequenceCut(flushed: Uint8Array[]): void {
  for (const chunk of flushed) {
    // A chunk that ends with bare ESC (0x1B) means the next byte has been
    // deferred — this is the key invariant the batcher must NOT violate.
    const last = chunk[chunk.length - 1];
    // The ONLY time a chunk may end with 0x1B is during a forced flushNow()
    // call (shutdown path). Regular ingest + timer flushes must NOT end there.
    // We test this only for non-forced flushes (Tests 2–6).
    if (last === 0x1b) {
      throw new Error(
        `Flushed chunk ends with bare ESC (0x1B) — mid-sequence cut!\n` +
          `Chunk bytes: [${Array.from(chunk).join(", ")}]`
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe("AnsiChunkBatcher", () => {
  // ─── Test 1: no escape, passthrough ───────────────────────────────────────
  it("Test 1 — plain ASCII passes through on flushNow()", () => {
    const { flushed, batcher } = makeCollector();

    batcher.ingest(encode("hello world\n"));
    batcher.flushNow();

    expect(flushed.length).toBeGreaterThanOrEqual(1);
    const merged = decode(concat(flushed));
    expect(merged).toContain("hello world\n");
  });

  // ─── Test 2: complete CSI sequence intact ─────────────────────────────────
  it("Test 2 — complete CSI color sequence stays intact on flushNow()", () => {
    const { flushed, batcher } = makeCollector();

    batcher.ingest(encode("\x1b[31mRED\x1b[0m"));
    batcher.flushNow();

    expect(flushed.length).toBeGreaterThanOrEqual(1);
    const merged = decode(concat(flushed));
    expect(merged).toBe("\x1b[31mRED\x1b[0m");
    assertNoMidSequenceCut(flushed);
  });

  // ─── Test 3: CSI split across two ingests ─────────────────────────────────
  it("Test 3 — partial CSI split across two ingests — no mid-sequence cut", () => {
    const { flushed, batcher } = makeCollector();

    batcher.ingest(encode("\x1b[3")); // partial CSI param
    batcher.ingest(encode("1mRED\x1b[0m"));
    batcher.flushNow();

    const merged = decode(concat(flushed));
    expect(merged).toContain("\x1b[31mRED\x1b[0m");

    // No flush chunk should end with bare ESC or ESC + [ (partial CSI open)
    for (const chunk of flushed) {
      // Last byte is not a bare ESC that signals an unresolved partial
      const str = decode(chunk);
      // The CSI intro "\x1b[" must NOT appear at the tail of any flush unless
      // followed by at least a final byte:
      const trailingCSI = /\x1b\[$/.test(str);
      expect(trailingCSI).toBe(false);
    }
  });

  // ─── Test 4: OSC window title across chunk boundary ───────────────────────
  it("Test 4 — OSC across boundary: held until BEL terminator", () => {
    const { flushed, batcher } = makeCollector();

    batcher.ingest(encode("\x1b]0;My Tit")); // OSC still open — no BEL yet
    batcher.ingest(encode("le\x07more output")); // BEL lands in second chunk

    batcher.flushNow();

    const merged = decode(concat(flushed));
    // The OSC sequence must be intact in the merged output
    expect(merged).toContain("\x1b]0;My Title\x07");
    expect(merged).toContain("more output");

    // No flushed chunk should contain only the partial OSC without the BEL
    for (const chunk of flushed) {
      const str = decode(chunk);
      // A chunk that contains \x1b] but no \x07 or \x1b\\ would be a partial flush
      if (str.includes("\x1b]") && !str.includes("\x07") && !str.includes("\x1b\\")) {
        throw new Error("Flushed partial OSC without terminator!\nChunk: " + JSON.stringify(str));
      }
    }
  });

  // ─── Test 5: force-flush at 100KB ─────────────────────────────────────────
  it("Test 5 — 200KB plain ASCII triggers multiple flushes (≤ ~100KB each)", async () => {
    const { flushed, batcher } = makeCollector();

    const bigChunk = new Uint8Array(200_000).fill(65); // 200_000 × 'A'
    batcher.ingest(bigChunk);
    // Give the batcher time to emit the size-triggered flush synchronously
    batcher.flushNow();

    // Should have flushed at least twice
    expect(flushed.length).toBeGreaterThanOrEqual(2);

    // No byte loss
    const totalBytes = flushed.reduce((s, c) => s + c.length, 0);
    expect(totalBytes).toBe(200_000);

    // Each flush ≤ ~100KB + small epsilon for boundary rounding
    for (const chunk of flushed) {
      expect(chunk.length).toBeLessThanOrEqual(110_000);
    }
  });

  // ─── Test 6: 250ms timer flush ────────────────────────────────────────────
  it("Test 6 — 250ms timer auto-flushes a buffered complete CSI sequence", async () => {
    const { flushed, batcher } = makeCollector();

    batcher.ingest(encode("\x1b[32mGREEN\x1b[0m"));

    // Wait > 250ms for the timer to fire
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(flushed.length).toBeGreaterThanOrEqual(1);
    const merged = decode(concat(flushed));
    expect(merged).toContain("\x1b[32mGREEN\x1b[0m");
  }, 5_000 /* test timeout */);

  // ─── Test 7: DCS / ESC P sequence ─────────────────────────────────────────
  it("Test 7 — DCS (ESC P … ESC \\) flushed as single intact sequence", () => {
    const { flushed, batcher } = makeCollector();

    // DCS: ESC P <data> ESC \  (String Terminator)
    batcher.ingest(encode("\x1bP1;1qcustom-data\x1b\\"));
    batcher.flushNow();

    const merged = decode(concat(flushed));
    expect(merged).toContain("\x1bP1;1qcustom-data\x1b\\");
    assertNoMidSequenceCut(flushed);
  });

  // ─── Test 8: no infinite hold — flushNow() emits even mid-sequence ────────
  it("Test 8 — flushNow() forces partial ESC open to be emitted (no infinite hold)", () => {
    const { flushed, batcher } = makeCollector();

    batcher.ingest(encode("\x1b[")); // partial CSI — no final byte

    // flushNow() MUST flush even though we're mid-sequence (shutdown path)
    batcher.flushNow();

    const totalBytes = flushed.reduce((s, c) => s + c.length, 0);
    expect(totalBytes).toBe(2); // ESC + [

    const merged = concat(flushed);
    expect(merged[0]).toBe(0x1b);
    expect(merged[1]).toBe(0x5b);
  });

  // ─── Test 9: byte preservation across multi-chunk session ─────────────────
  it("Test 9 — sum of onFlush bytes equals total ingested bytes (500KB)", () => {
    const { flushed, batcher } = makeCollector();

    const TARGET = 500_000;
    const CHUNK_SIZE = 50_000;

    let offset = 0;
    while (offset < TARGET) {
      const size = Math.min(CHUNK_SIZE, TARGET - offset);
      const chunk = new Uint8Array(size);
      // Alternate between plain ASCII, CSI color codes, and OSC titles to
      // exercise multiple state transitions within a single large session.
      if (offset % 150_000 === 0) {
        // Inject a CSI sequence at the start of every 150KB block
        const csi = encode("\x1b[1;32mHELLO\x1b[0m");
        chunk.set(csi, 0);
        chunk.fill(65, csi.length); // fill rest with 'A'
      } else {
        chunk.fill(65); // plain ASCII
      }
      batcher.ingest(chunk);
      offset += size;
    }

    batcher.flushNow();

    const totalFlushed = flushed.reduce((s, c) => s + c.length, 0);
    expect(totalFlushed).toBe(TARGET);
  });
});
