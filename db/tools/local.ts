import "server-only";
import { databaseConfig, isLoopback } from "../../src/lib/db/config.ts";

export class LocalDatabaseError extends Error {
  constructor() {
    super("Database tools require non-production execution, loopback, and a lapalme_dev_* or lapalme_test_* database.");
    this.name = "LocalDatabaseError";
  }
}

export function localDatabaseConfig(url: string | undefined) {
  const config = databaseConfig(url);
  if (process.env.NODE_ENV === "production" || !isLoopback(config.host ?? "") ||
    !/^lapalme_(dev|test)_[a-z0-9_]+$/.test(config.database ?? "")) throw new LocalDatabaseError();
  return { ...config, max: 1, maxLifetimeSeconds: 0, application_name: "la-palme-local-tools" };
}
