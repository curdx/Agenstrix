import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Note: drizzle-kit 0.31.x does not accept "bun-sqlite" as a driver value.
  // The dialect "sqlite" is sufficient for migration generation.
  dialect: "sqlite",
  schema: "./src-bun/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
});
