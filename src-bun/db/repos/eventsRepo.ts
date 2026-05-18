/**
 * eventsRepo — thin typed wrapper around the `events` table.
 */
import { eq, asc, gte, and } from "drizzle-orm";
import { getDb } from "../index";
import { events } from "../schema";
import { nanoid } from "nanoid";

export const eventsRepo = {
  async append(input: {
    workerId?: string;
    type: string;
    payload?: unknown;
    ts?: number;
  }): Promise<void> {
    const db = getDb();
    await db.insert(events).values({
      id: nanoid(),
      workerId: input.workerId ?? null,
      ts: input.ts ?? Date.now(),
      type: input.type,
      payload: input.payload !== undefined ? JSON.stringify(input.payload) : null,
    });
  },

  async listByWorker(
    workerId: string,
    sinceTs?: number
  ): Promise<
    Array<{ id: string; workerId: string | null; ts: number; type: string; payload: string | null }>
  > {
    const db = getDb();
    const conditions = [eq(events.workerId, workerId)];
    if (sinceTs !== undefined) {
      conditions.push(gte(events.ts, sinceTs));
    }
    return db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.ts));
  },
};
