/**
 * ptyChunksRepo — thin typed wrapper around the `pty_chunks` table.
 */
import { eq, asc, and, max } from "drizzle-orm";
import { getDb } from "../index";
import { ptyChunks } from "../schema";
import { nanoid } from "nanoid";

export const ptyChunksRepo = {
  async append(input: {
    workerId: string;
    seq: number;
    ts: number;
    bytes: Buffer;
  }): Promise<void> {
    const db = getDb();
    await db.insert(ptyChunks).values({
      id: nanoid(),
      workerId: input.workerId,
      seq: input.seq,
      ts: input.ts,
      bytes: input.bytes,
    });
  },

  async listByWorker(
    workerId: string
  ): Promise<Array<{ seq: number; ts: number; bytes: Buffer }>> {
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

  async nextSeq(workerId: string): Promise<number> {
    const db = getDb();
    const result = await db
      .select({ maxSeq: max(ptyChunks.seq) })
      .from(ptyChunks)
      .where(eq(ptyChunks.workerId, workerId));

    const maxSeq = result[0]?.maxSeq;
    return maxSeq !== null && maxSeq !== undefined ? maxSeq + 1 : 0;
  },
};
