import "server-only";
import { readCartJson } from "../cart/http.ts";
import { databaseThrottle } from "../auth/rate-limit.ts";
import { getCustomerRuntime, type CustomerRuntime } from "./runtime.ts";
import { CustomerError } from "./config.ts";
import { customerProvider, requireCustomer } from "./authorization.ts";
export const customerJson = (body: unknown, status = 200, source?: Headers) => {
  const headers = new Headers(source);
  headers.set("Cache-Control", "private, no-store, max-age=0"); headers.set("Content-Type", "application/json");
  headers.set("X-Content-Type-Options", "nosniff"); headers.set("Referrer-Policy", "no-referrer"); headers.delete("Content-Length");
  return new Response(JSON.stringify(body), { status, headers });
};
export function customerOrigin(request: Request, runtime: CustomerRuntime) {
  if (request.headers.get("origin") !== runtime.config.baseURL || request.headers.get("sec-fetch-site") === "cross-site") throw new CustomerError("This request could not be verified.", 403);
}
export async function customerAuthHttp(request: Request, supplied?: CustomerRuntime) {
  const url = new URL(request.url), path = url.pathname.slice("/api/customer-auth".length);
  if (!["/send-code", "/verify-code", "/sign-out", "/session"].includes(path)) return customerJson({ message: "Not found." }, 404);
  if (request.method !== (path === "/session" ? "GET" : "POST")) return customerJson({ message: "Method not allowed." }, 405);
  try {
    const runtime = supplied ?? getCustomerRuntime();
    if (url.search) throw new CustomerError("Unexpected query parameters.", 400);
    if (path === "/session") {
      try {
        const c = await requireCustomer(request.headers, runtime);
        return customerJson({ customer: { id: c.id, expiresAt: c.expiresAt, name: c.name, email: c.email, phone: c.phone } });
      } catch (error) { if (error instanceof CustomerError && error.status === 401) return customerJson({ customer: null }); throw error; }
    }
    customerOrigin(request, runtime);
    const limit = databaseThrottle(runtime.pool, runtime.config.secret, "customer_auth_rate_limits");
    if (!(await limit("transport:global", { window: 60, max: 120 })).allowed) throw new CustomerError("Please wait before trying again.", 429);
    for (const table of ["customer_auth_verifications", "customer_auth_sessions"] as const) await runtime.pool.query(`DELETE FROM ${table} WHERE id IN
      (SELECT id FROM ${table} WHERE expires_at<=statement_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`);
    const value = await readCartJson(request, 4096);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CustomerError("Review your sign-in details.", 400);
    const body = value as Record<string, unknown>;
    const allowed = path === "/sign-out" ? [] : path === "/send-code" ? ["email"] : ["email", "code", "name"];
    if (Object.keys(body).some(k => !allowed.includes(k))) throw new CustomerError("Unexpected sign-in fields.", 400);
    if (path === "/sign-out") {
      const response = await runtime.auth.handler(new Request(runtime.config.baseURL + "/api/customer-auth/sign-out", { method: "POST", headers: request.headers, body: "{}" }));
      if (!response.ok || await runtime.auth.api.getSession({ headers: request.headers })) throw new CustomerError("Sign-out could not be confirmed. Please try again.");
      return customerJson({ ok: true }, 200, response.headers);
    }
    if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) throw new CustomerError("Enter a valid email address.", 400);
    const email = body.email.trim().toLowerCase();
    if (path === "/send-code") {
      for (const [key, window, max] of [[`send:cooldown:${email}`, 60, 1], [`send:hour:${email}`, 3600, 5], ["send:day:global", 86400, 80]] as const) {
        if (!(await limit(key, { window, max })).allowed) throw new CustomerError("Please wait before requesting another code.", 429);
      }
      await runtime.sendCode(email);
      return customerJson({ ok: true, message: "A sign-in code was sent. It expires in five minutes." });
    }
    if (typeof body.code !== "string" || !/^\d{8}$/.test(body.code) || body.name !== undefined && (typeof body.name !== "string" || body.name.length > 100)) throw new CustomerError("Enter the eight-digit code and review your details.", 400);
    if (!(await limit(`verify:${email}`, { window: 900, max: 10 })).allowed) throw new CustomerError("Please wait before trying again.", 429);
    const headers = new Headers(request.headers); headers.delete("content-length");
    const response = await runtime.auth.handler(new Request(runtime.config.baseURL + "/api/customer-auth/sign-in/email-otp", { method: "POST", headers,
      body: JSON.stringify({ email, otp: body.code, name: typeof body.name === "string" ? body.name.trim() : undefined }) }));
    if (!response.ok) throw new CustomerError("The code could not be verified. Review your name if creating an account, or request a new code.", 400);
    const result = await response.json() as { token: string; user: { id: string; name: string; email: string; emailVerified: boolean } };
    try {
      if (!result.user.emailVerified) throw new Error();
      await runtime.pool.query(`INSERT INTO customer_profiles(auth_provider,auth_subject,full_name,email) VALUES($1,$2,$3,$4)
        ON CONFLICT(auth_provider,auth_subject) DO NOTHING`, [customerProvider, result.user.id, result.user.name, result.user.email]);
    } catch {
      await runtime.pool.query("DELETE FROM customer_auth_sessions WHERE token=$1", [result.token]);
      throw new CustomerError("Your sign-in could not be completed. Please request a new code.");
    }
    return customerJson({ ok: true }, 200, response.headers);
  } catch (error) {
    if (path === "/session") return customerJson({ customer: null, available: false });
    if (error instanceof CustomerError) return customerJson({ message: error.message }, error.status);
    return customerJson({ message: "Sign-in could not be completed. A code was not confirmed as delivered. Please wait and try again." }, 503);
  }
}
