import "server-only";
import { databaseConfig, isLoopback } from "../db/config.ts";
export class CustomerError extends Error {
  readonly status: number;
  constructor(message: string, status = 503) { super(message); this.name = "CustomerError"; this.status = status; }
}
export interface CustomerConfiguration { databaseUrl: string; baseURL: string; secret: string }
export function customerConfiguration(env = process.env): CustomerConfiguration {
  try {
    if (env.CUSTOMER_AUTH_ENABLED !== "true") throw new Error();
    const databaseUrl = env.CUSTOMER_DATABASE_URL ?? ""; databaseConfig(databaseUrl);
    const url = new URL(env.BETTER_AUTH_URL ?? "");
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && url.protocol === "http:" && isLoopback(url.hostname)))) throw new Error();
    const secret = env.CUSTOMER_AUTH_SECRET ?? "";
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret) || new Set(secret).size < 12 || /YOUR|PLACEHOLDER|EXAMPLE/i.test(secret) || secret === env.BETTER_AUTH_SECRET) throw new Error();
    return { databaseUrl, baseURL: url.origin, secret };
  } catch { throw new CustomerError("Customer sign-in is not available yet. Please try again later."); }
}
