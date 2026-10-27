import "server-only";
import { createHmac } from "node:crypto";
import type { Pool } from "pg";

export function createLoginThrottle(pool: Pool, secret: string) {
  return async function consume(key: string, rule: { window: number; max: number }) {
    const keyHash = createHmac("sha256", secret).update(key).digest("hex");
    // Bounded opportunistic retention, including failed/unknown accounts.
    // SKIP LOCKED avoids competing cleanup requests waiting on the same rows.
    await pool.query(`DELETE FROM admin_auth_rate_limits WHERE id IN
      (SELECT id FROM admin_auth_rate_limits WHERE expires_at <= statement_timestamp() AND key_hash <> $1
       ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`, [keyHash]);
    const result = await pool.query<{ allowed: boolean; retry_after: number }>(`
      INSERT INTO admin_auth_rate_limits(key_hash, count, expires_at)
      VALUES ($1, 1, statement_timestamp() + $2 * INTERVAL '1 second')
      ON CONFLICT (key_hash) DO UPDATE SET
        count = CASE WHEN admin_auth_rate_limits.expires_at <= statement_timestamp() THEN 1
          ELSE LEAST(admin_auth_rate_limits.count + 1, $3 + 1) END,
        expires_at = CASE WHEN admin_auth_rate_limits.expires_at <= statement_timestamp()
          THEN statement_timestamp() + $2 * INTERVAL '1 second' ELSE admin_auth_rate_limits.expires_at END
      RETURNING count <= $3 AS allowed,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - statement_timestamp())))::INTEGER AS retry_after`,
    [keyHash, rule.window, rule.max]);
    return { allowed: result.rows[0].allowed, retryAfter: result.rows[0].allowed ? null : result.rows[0].retry_after };
  };
}
