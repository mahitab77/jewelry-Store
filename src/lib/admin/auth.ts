import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { Pool } from "pg";
import type { AdminConfiguration } from "./config.ts";
import { createLoginThrottle } from "./rate-limit.ts";
import { loadEnabledAdmin } from "./identity.ts";
import { recordAdminAudit } from "./audit.ts";

export function createAdminAuth(config: AdminConfiguration, pool: Pool) {
  const consume = createLoginThrottle(pool, config.secret);
  return betterAuth({
    appName: "La Palme d'Or administration",
    baseURL: config.baseURL,
    basePath: "/api/admin-auth",
    secret: config.secret,
    database: pool,
    telemetry: { enabled: false },
    logger: { disabled: true },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 16, maxPasswordLength: 128 },
    user: {
      modelName: "admin_users",
      fields: { name: "display_name", emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
      additionalFields: {
        role: { type: "string", required: true, input: false, returned: false },
        isActive: { type: "boolean", fieldName: "is_active", required: true, input: false, returned: false },
      },
      changeEmail: { enabled: false }, deleteUser: { enabled: false },
    },
    session: {
      modelName: "admin_auth_sessions", expiresIn: 8 * 60 * 60, disableSessionRefresh: true,
      cookieCache: { enabled: false },
      fields: { userId: "user_id", expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at", ipAddress: "ip_address", userAgent: "user_agent" },
    },
    account: {
      modelName: "admin_auth_accounts", accountLinking: { enabled: false },
      fields: { userId: "user_id", accountId: "account_id", providerId: "provider_id", accessToken: "access_token", refreshToken: "refresh_token", idToken: "id_token", accessTokenExpiresAt: "access_token_expires_at", refreshTokenExpiresAt: "refresh_token_expires_at", createdAt: "created_at", updatedAt: "updated_at" },
    },
    verification: { modelName: "admin_auth_verifications", fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" } },
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "lapalme_admin",
      useSecureCookies: config.baseURL.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "strict", path: "/" },
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: ["x-lapalme-client-ip"] },
    },
    trustedOrigins: [config.baseURL],
    rateLimit: {
      enabled: true, window: 60, max: 60,
      customRules: { "/sign-in/email": { window: 900, max: 30 } },
      customStorage: { consume: (key, rule) => consume(`source:${key}`, rule) },
    },
    hooks: { before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email" || typeof ctx.body?.email !== "string") return;
      const limit = await consume(`account:${ctx.body.email.trim().toLowerCase()}`, { window: 900, max: 5 });
      if (!limit.allowed) {
        throw new APIError("TOO_MANY_REQUESTS", { message: "Please wait before trying again." }, { "Retry-After": String(limit.retryAfter) });
      }
    }) },
    databaseHooks: { session: { create: { before: async (session) => {
      if (!await loadEnabledAdmin(pool, session.userId)) {
        await recordAdminAudit(pool, "ADMIN_ACCESS_DENIED");
        return false;
      }
      // Session request metadata is not needed for this foundation.
      return { data: { ...session, ipAddress: null, userAgent: null } };
    } } } },
  });
}

export type AdminAuth = ReturnType<typeof createAdminAuth>;
