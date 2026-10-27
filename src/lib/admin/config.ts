import "server-only";
import { databaseConfig, isLoopback } from "../db/config.ts";

export class AdminConfigurationError extends Error {
  constructor() { super("Administrator sign-in is not configured."); this.name = "AdminConfigurationError"; }
}

export interface AdminConfiguration {
  databaseUrl: string;
  baseURL: string;
  secret: string;
  trustedIpHeader?: "cf-connecting-ip" | "x-real-ip";
}

export function adminConfiguration(env: NodeJS.ProcessEnv = process.env): AdminConfiguration {
  try {
    const databaseUrl = env.ADMIN_DATABASE_URL ?? "";
    databaseConfig(databaseUrl);
    const url = new URL(env.BETTER_AUTH_URL ?? "");
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && url.protocol === "http:" && isLoopback(url.hostname)))) throw new Error();
    const secret = env.BETTER_AUTH_SECRET ?? "";
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret) || new Set(secret).size < 12 || /YOUR|PLACEHOLDER|EXAMPLE/i.test(secret)) throw new Error();
    const trustedIpHeader = env.ADMIN_TRUSTED_IP_HEADER || undefined;
    if (trustedIpHeader && !["cf-connecting-ip", "x-real-ip"].includes(trustedIpHeader)) throw new Error();
    return { databaseUrl, baseURL: url.origin, secret, trustedIpHeader: trustedIpHeader as AdminConfiguration["trustedIpHeader"] };
  } catch { throw new AdminConfigurationError(); }
}
