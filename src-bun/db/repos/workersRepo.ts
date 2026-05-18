/**
 * workersRepo — thin typed wrapper around the `workers` table.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../index";
import { workers } from "../schema";

type WorkerState = "idle" | "running" | "exited" | "killed";

export const workersRepo = {
  async insert(row: {
    id: string;
    cli: string;
    cwd: string;
    pid: number;
    pgid: number;
    envMode: string;
    createdAt: number;
  }): Promise<void> {
    const db = getDb();
    await db.insert(workers).values({
      id: row.id,
      cli: row.cli,
      cwd: row.cwd,
      pid: row.pid,
      pgid: row.pgid,
      state: "running",
      envMode: row.envMode,
      createdAt: row.createdAt,
    });
  },

  async updateState(
    id: string,
    state: WorkerState,
    exitedAt?: number,
    exitCode?: number
  ): Promise<void> {
    const db = getDb();
    await db
      .update(workers)
      .set({
        state,
        ...(exitedAt !== undefined ? { exitedAt } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
      })
      .where(eq(workers.id, id));
  },

  async get(id: string): Promise<{
    id: string;
    cli: string;
    cwd: string;
    pid: number | null;
    pgid: number | null;
    state: string;
    envMode: string;
    createdAt: number;
    exitedAt: number | null;
    exitCode: number | null;
  } | null> {
    const db = getDb();
    const rows = await db.select().from(workers).where(eq(workers.id, id));
    return rows[0] ?? null;
  },

  async list(): Promise<
    Array<{
      id: string;
      cli: string;
      cwd: string;
      pid: number | null;
      pgid: number | null;
      state: string;
      envMode: string;
      createdAt: number;
    }>
  > {
    const db = getDb();
    return db.select().from(workers);
  },
};
