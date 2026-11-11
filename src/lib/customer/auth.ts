import "server-only";
import { createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { Pool } from "pg";
import type { CustomerConfiguration } from "./config.ts";
import type { CustomerMailer } from "./email.ts";
export function createCustomerAuth(config: CustomerConfiguration, pool: Pool, mailer: CustomerMailer) {
  return betterAuth({
    appName: "La Palme d'Or", baseURL: config.baseURL, basePath: "/api/customer-auth", secret: config.secret, database: pool,
    telemetry: { enabled: false }, logger: { disabled: true }, emailAndPassword: { enabled: false },
    user: { modelName: "customer_auth_users", fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" }, changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    session: { modelName: "customer_auth_sessions", expiresIn: 7 * 86400, disableSessionRefresh: true, cookieCache: { enabled: false },
      fields: { userId: "user_id", expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at", ipAddress: "ip_address", userAgent: "user_agent" } },
    account: { modelName: "customer_auth_accounts", accountLinking: { enabled: false }, fields: { userId: "user_id", accountId: "account_id", providerId: "provider_id", accessToken: "access_token", refreshToken: "refresh_token", idToken: "id_token", accessTokenExpiresAt: "access_token_expires_at", refreshTokenExpiresAt: "refresh_token_expires_at", createdAt: "created_at", updatedAt: "updated_at" } },
    verification: { modelName: "customer_auth_verifications", fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" } },
    advanced: { database: { generateId: "uuid" }, cookiePrefix: "lapalme_customer", useSecureCookies: config.baseURL.startsWith("https://"), defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" }, disableOriginCheck: false, disableCSRFCheck: false },
    trustedOrigins: [config.baseURL],
    // The allowlisted HTTP transport applies distributed limits to all operations,
    // including server API calls, rather than relying on in-process/IP counters.
    rateLimit: { enabled: false },
    plugins: [emailOTP({ otpLength: 8, expiresIn: 300, allowedAttempts: 3, resendStrategy: "rotate",
      storeOTP: { hash: async code => createHmac("sha256", config.secret).update(`customer-otp:${code}`).digest("hex") },
      sendVerificationOTP: async ({ email, otp, type }) => { if (type !== "sign-in") throw new Error("Unsupported verification operation."); await mailer({ email, otp }); } })],
    databaseHooks: {
      user: { create: { before: async user => {
        const name = user.name.normalize("NFKC").trim();
        if (name.length < 2 || name.length > 100 || (name.match(/\p{L}/gu) ?? []).length < 2) throw new APIError("BAD_REQUEST", { message: "Complete your name and request a new code." });
        return { data: { ...user, name, image: null } };
      } } },
      session: { create: { before: async session => ({ data: { ...session, ipAddress: null, userAgent: null } }) } },
    },
  });
}
