import "server-only";
import type { Pool } from "pg";
import { databaseThrottle } from "../auth/rate-limit.ts";
export function createLoginThrottle(pool: Pool, secret: string) {
  return databaseThrottle(pool, secret, "admin_auth_rate_limits");
}