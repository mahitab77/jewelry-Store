import "server-only";
import pg from "pg";
import { databaseConfig } from "../db/config.ts";
import { adminConfiguration, type AdminConfiguration } from "./config.ts";
import { createAdminAuth } from "./auth.ts";

export function createAdminRuntime(config: AdminConfiguration) {
  const pool = new pg.Pool({ ...databaseConfig(config.databaseUrl), application_name: "la-palme-admin" });
  pool.on("error", () => console.error("An idle administrator database connection was closed."));
  return { config, pool, auth: createAdminAuth(config, pool) };
}
export type AdminRuntime = ReturnType<typeof createAdminRuntime>;
const state = globalThis as typeof globalThis & { laPalmeAdminRuntime?: AdminRuntime };

// No secret parsing, database connection or authentication initialization at import.
export function getAdminRuntime(): AdminRuntime {
  return state.laPalmeAdminRuntime ??= createAdminRuntime(adminConfiguration());
}
