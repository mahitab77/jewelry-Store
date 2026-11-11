import "server-only";
import { createHmac } from "node:crypto";
import type { Pool } from "pg";

// Fixed table identifiers only, shared by the two authentication configurations.
export function databaseThrottle(pool: Pool, secret: string, table: "admin_auth_rate_limits" | "customer_auth_rate_limits") {
  return async (key: string, rule: { window: number; max: number }) => {
    const hash = createHmac("sha256", secret).update(key).digest("hex");
    await pool.query(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table}
      WHERE expires_at<=statement_timestamp() AND key_hash<>$1 ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`, [hash]);
    const result = await pool.query<{ allowed: boolean; retry_after: number }>(`INSERT INTO ${table}(key_hash,count,expires_at)
      VALUES($1,1,statement_timestamp()+$2*INTERVAL '1 second') ON CONFLICT(key_hash) DO UPDATE SET
      count=CASE WHEN ${table}.expires_at<=statement_timestamp() THEN 1 ELSE LEAST(${table}.count+1,$3+1) END,
      expires_at=CASE WHEN ${table}.expires_at<=statement_timestamp() THEN statement_timestamp()+$2*INTERVAL '1 second' ELSE ${table}.expires_at END
      RETURNING count<=$3 AS allowed,GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-statement_timestamp())))::INTEGER AS retry_after`, [hash, rule.window, rule.max]);
    return { allowed: result.rows[0].allowed, retryAfter: result.rows[0].allowed ? null : result.rows[0].retry_after };
  };
}
