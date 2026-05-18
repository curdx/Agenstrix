/**
 * Drizzle ORM schema — 11 tables for Agenstrix.
 * Phase 1 uses: workers, pty_chunks, events, messages
 * Placeholder tables (populated Phase 2+): workspaces, conversations, repos,
 *   services, skills, templates, learned_commands
 */
import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ── Core tables ─────────────────────────────────────────────────────────────

export const workers = sqliteTable("workers", {
  id: text("id").primaryKey(), // nanoid 21-char
  cli: text("cli").notNull(), // 'claude' | 'codex' | 'echo-skeleton'
  cwd: text("cwd").notNull(),
  pid: integer("pid"),
  pgid: integer("pgid"),
  state: text("state").notNull().default("idle"), // idle | running | exited | killed
  envMode: text("env_mode").notNull().default("no-worktree"),
  createdAt: integer("created_at").notNull(), // unix ms
  exitedAt: integer("exited_at"),
  exitCode: integer("exit_code"),
});

export const ptyChunks = sqliteTable("pty_chunks", {
  id: text("id").primaryKey(),
  workerId: text("worker_id")
    .notNull()
    .references(() => workers.id),
  ts: integer("ts").notNull(), // unix ms
  seq: integer("seq").notNull(), // monotonic per worker
  bytes: blob("bytes", { mode: "buffer" }).notNull(), // raw PTY bytes (redacted)
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  workerId: text("worker_id").references(() => workers.id),
  ts: integer("ts").notNull(),
  type: text("type").notNull(), // 'worker.spawned' | 'worker.killed' | ...
  payload: text("payload"), // JSON
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  workerId: text("worker_id").references(() => workers.id),
  ts: integer("ts").notNull(),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
});

// ── Phase 2+ placeholder tables ──────────────────────────────────────────────

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  path: text("path").notNull(),
  name: text("name"),
  createdAt: integer("created_at").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  createdAt: integer("created_at").notNull(),
});

export const repos = sqliteTable("repos", {
  id: text("id").primaryKey(),
  path: text("path").notNull(),
});

export const services = sqliteTable("services", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  state: text("state").notNull(),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull(),
});

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull(),
});

export const learnedCommands = sqliteTable("learned_commands", {
  id: text("id").primaryKey(),
  repoId: text("repo_id"),
  cmd: text("cmd").notNull(),
});
