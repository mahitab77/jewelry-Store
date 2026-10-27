import "server-only";
import pg from "pg";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { databaseConfig, DatabaseError } from "./config.ts";

const state = globalThis as typeof globalThis & { laPalmeDatabasePool?: Pool };

function pool(): Pool {
  if (!state.laPalmeDatabasePool) {
    const instance = new pg.Pool(databaseConfig());
    // pg removes failed idle clients. Handle the event without logging SQL/secrets.
    instance.on("error", () => console.error("An idle database connection was closed."));
    state.laPalmeDatabasePool = instance;
  }
  return state.laPalmeDatabasePool;
}

export async function withDatabaseClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient | undefined;
  let discard = false;
  try {
    client = await pool().connect();
    return await operation(client);
  } catch (error) {
    discard = true;
    // Deliberately omit cause, SQL, connection strings, and driver error details.
    throw error instanceof DatabaseError ? error : new DatabaseError("DATABASE_UNAVAILABLE");
  } finally {
    client?.release(discard);
  }
}

export async function queryRows<T extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  return withDatabaseClient(async (client) => (await client.query<T>(sql, values)).rows);
}

// The borrowed client is the future transaction boundary; no checkout mutations here.
export async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  return withDatabaseClient(async (client) => {
    await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    try {
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

// Call after outstanding work completes in Node scripts/tests, never per page query.
export async function closeDatabase(): Promise<void> {
  const instance = state.laPalmeDatabasePool;
  delete state.laPalmeDatabasePool;
  if (instance) await instance.end();
}
