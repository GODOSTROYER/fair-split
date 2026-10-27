// drizzle-kit reads the schema and writes SQL migrations to ./migrations.
// Triggers, roles, functions and grants live in hand-written `--custom` migrations in the same folder.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  strict: true,
  verbose: false,
  migrations: { table: "__drizzle_migrations", schema: "drizzle" },
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/fairsplit" },
});
