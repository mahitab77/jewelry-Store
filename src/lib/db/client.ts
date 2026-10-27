import "server-only";
import pg from "pg";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { databaseConfig, DatabaseError } from "./config.ts";

type Access = "catalogue" | "cart";
const state = globalThis as typeof globalThis & { laPalmeDatabasePool?: Pool; laPalmeCartPool?: Pool };

function pool(access: Access): Pool {
  const key = access === "cart" ? "laPalmeCartPool" : "laPalmeDatabasePool";
  if (!state[key]) {
    const instance = new pg.Pool(databaseConfig(access === "cart" ? process.env.CART_DATABASE_URL || "" : process.env.DATABASE_URL));
    // pg removes failed idle clients. Handle the event without logging SQL/secrets.
    instance.on("error", () => console.error("An idle database connection was closed."));
    state[key] = instance;
  }
  return state[key]!;
}

export async function withDatabaseClient<T>(operation: (client: PoolClient) => Promise<T>, access: Access = "catalogue"): Promise<T> {
  let client: PoolClient | undefined;
  let discard = false;
  try {
    client = await pool(access).connect();
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

// Cart writes use a separate restricted pool with the same transaction lifecycle.
export async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>, readOnly = false, access: Access = "catalogue"): Promise<T> {
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
  }, access);
}

// Call after outstanding work completes in Node scripts/tests, never per page query.
export async function closeDatabase(): Promise<void> {
  const instances = [state.laPalmeDatabasePool, state.laPalmeCartPool];
  delete state.laPalmeDatabasePool;
  delete state.laPalmeCartPool;
  await Promise.all(instances.filter((instance): instance is Pool => Boolean(instance)).map((instance) => instance.end()));
}
