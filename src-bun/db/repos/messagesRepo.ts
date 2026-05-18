/**
 * messagesRepo — thin typed wrapper around the `messages` table.
 */
import { eq, asc } from "drizzle-orm";
import { getDb } from "../index";
import { messages } from "../schema";
import { nanoid } from "nanoid";

export const messagesRepo = {
  async append(input: {
    workerId: string;
    role: "user" | "assistant";
    content: string;
    ts?: number;
  }): Promise<void> {
    const db = getDb();
    await db.insert(messages).values({
      id: nanoid(),
      workerId: input.workerId,
      ts: input.ts ?? Date.now(),
      role: input.role,
      content: input.content,
    });
  },

  async listByWorker(
    workerId: string
  ): Promise<
    Array<{ id: string; workerId: string | null; ts: number; role: string; content: string }>
  > {
    const db = getDb();
    return db
      .select()
      .from(messages)
      .where(eq(messages.workerId, workerId))
      .orderBy(asc(messages.ts));
  },
};
