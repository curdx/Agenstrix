/**
 * ptyChunksRepo — thin typed wrapper around the `pty_chunks` table.
 *
 * Replay correctness (INFRA-03):
 * - listByWorker always returns rows ordered by seq ASC.
 * - nextSeq returns 1 for a brand-new worker (no previous chunks).
 * - appendAtomic wraps seq allocation + insert in a single SQLite transaction
 *   (T-01-03-04) so concurrent calls cannot produce duplicate seq values.
 */
import { asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../index";
import { ptyChunks } from "../schema";

export const ptyChunksRepo = {
  /**
   * Append a chunk with a caller-supplied seq.
   * Prefer appendAtomic for production use — this exists for compatibility
   * with code that already computed the seq externally (e.g. Plan 01-02 wiring).
   */
  async append(input: { workerId: string; seq: number; ts: number; bytes: Buffer }): Promise<void> {
    const db = getDb();
    await db.insert(ptyChunks).values({
      id: nanoid(),
      workerId: input.workerId,
      seq: input.seq,
      ts: input.ts,
      bytes: input.bytes,
    });
  },

  /**
   * Atomically compute the next seq and insert the chunk in a single transaction.
   * Concurrent calls for the same workerId are serialised by SQLite's write lock,
   * guaranteeing unique, gap-free seq values (T-01-03-04).
   *
   * @returns The seq assigned to the new chunk.
   */
  async appendAtomic(workerId: string, ts: number, bytes: Buffer): Promise<number> {
    const db = getDb();
    let assignedSeq = 0;

    // Use IMMEDIATE transaction so the first caller acquires the write lock
    // before any concurrent caller reads MAX(seq). Without this, two concurrent
    // calls both see MAX=0, both compute seq=1, and a UNIQUE constraint would
    // fail (or both inserts race). IMMEDIATE serialises all writers (T-01-03-04).
    await db.transaction(
      async (tx) => {
        // Read the current max seq for this worker inside the transaction.
        // COALESCE(MAX(seq), 0) returns 0 when there are no rows yet.
        const maxRow = await tx
          .select({ m: sql<number>`COALESCE(MAX(${ptyChunks.seq}), 0)` })
          .from(ptyChunks)
          .where(eq(ptyChunks.workerId, workerId))
          .get();

        const seq = (maxRow?.m ?? 0) + 1;
        assignedSeq = seq;

        await tx.insert(ptyChunks).values({
          id: nanoid(),
          workerId,
          ts,
          seq,
          bytes,
        });
      },
      { behavior: "immediate" }
    );

    return assignedSeq;
  },

  /**
   * Return all chunks for a worker ordered by seq ASC (replay-correct order).
   */
  async listByWorker(workerId: string): Promise<Array<{ seq: number; ts: number; bytes: Buffer }>> {
    const db = getDb();
    const rows = await db
      .select({ seq: ptyChunks.seq, ts: ptyChunks.ts, bytes: ptyChunks.bytes })
      .from(ptyChunks)
      .where(eq(ptyChunks.workerId, workerId))
      .orderBy(asc(ptyChunks.seq));

    return rows.map((r) => ({
      seq: r.seq,
      ts: r.ts,
      bytes: Buffer.from(r.bytes as Buffer),
    }));
  },

  /**
   * Return the next seq for a worker (existing max + 1, or 1 if none).
   * NOTE: This is NOT atomic — use appendAtomic when you need guaranteed
   * uniqueness under concurrent writes.
   */
  async nextSeq(workerId: string): Promise<number> {
    const db = getDb();
    const result = await db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${ptyChunks.seq}), 0)` })
      .from(ptyChunks)
      .where(eq(ptyChunks.workerId, workerId));

    const maxSeq = result[0]?.maxSeq ?? 0;
    return maxSeq + 1;
  },
};
