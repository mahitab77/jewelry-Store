import "server-only";
import type { PoolConfig } from "pg";

export class DatabaseError extends Error {
  readonly code: "DATABASE_NOT_CONFIGURED" | "DATABASE_CONFIGURATION_INVALID" | "DATABASE_UNAVAILABLE";

  constructor(code: DatabaseError["code"]) {
    const messages = {
      DATABASE_NOT_CONFIGURED: "DATABASE_URL must be configured for database operations.",
      DATABASE_CONFIGURATION_INVALID: "Database configuration is invalid or uses unsupported TLS settings.",
      DATABASE_UNAVAILABLE: "The catalogue database is temporarily unavailable.",
    };
    super(messages[code]);
    this.name = "DatabaseError";
    this.code = code;
  }
}

export function isLoopback(host: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host.toLowerCase());
}

// Parse explicitly: connectionString SSL parameters must not override TLS policy.
export function databaseConfig(value = process.env.DATABASE_URL): PoolConfig {
  if (!value?.trim()) throw new DatabaseError("DATABASE_NOT_CONFIGURED");
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || url.hash) throw new Error();
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!database || database.includes("/")) throw new Error();
    for (const key of url.searchParams.keys()) {
      if (!["sslmode", "channel_binding"].includes(key) || url.searchParams.getAll(key).length !== 1) throw new Error();
    }
    const mode = url.searchParams.get("sslmode");
    const local = isLoopback(url.hostname);
    if (mode && !["require", "verify-full", "disable"].includes(mode)) throw new Error();
    if (mode === "disable" && !local) throw new Error();
    const binding = url.searchParams.get("channel_binding");
    if (binding && !["require", "prefer", "disable"].includes(binding)) throw new Error();
    const port = url.port ? Number(url.port) : 5432;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
    return {
      host: url.hostname.replace(/^\[|\]$/g, ""), port, database,
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      ssl: local && (!mode || mode === "disable") ? false : { rejectUnauthorized: true },
      enableChannelBinding: binding !== "disable",
      max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
      statement_timeout: 8000, query_timeout: 10000,
      idle_in_transaction_session_timeout: 10000, maxLifetimeSeconds: 60,
      allowExitOnIdle: true, application_name: "la-palme-catalogue",
    };
  } catch {
    throw new DatabaseError("DATABASE_CONFIGURATION_INVALID");
  }
}
