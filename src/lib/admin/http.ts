import "server-only";
import { isIP } from "node:net";
import { getAdminRuntime, type AdminRuntime } from "./runtime.ts";
import { recordAdminAudit } from "./audit.ts";
import { loadEnabledAdmin } from "./identity.ts";
import { createLoginThrottle } from "./rate-limit.ts";

const failure = "Sign-in was unsuccessful. Check your details or try again later.";

function reply(status: number, message: string, headers?: Headers) {
  const output = new Headers(headers);
  output.set("Cache-Control", "no-store");
  output.set("Content-Type", "application/json");
  output.set("X-Content-Type-Options", "nosniff");
  output.delete("Content-Length");
  return new Response(JSON.stringify(status === 200 ? { ok: true } : { message }), { status, headers: output });
}

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new Error();
  const reader = request.body?.getReader();
  if (!reader) throw new Error();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
  return data as Record<string, unknown>;
}

export async function handleAdminAuth(request: Request, suppliedRuntime?: AdminRuntime, operation?: "logout"): Promise<Response> {
  const url = new URL(request.url);
  const path = operation === "logout" ? "/api/admin-auth/sign-out" : url.pathname;
  if (!["/api/admin-auth/sign-in/email", "/api/admin-auth/sign-out"].includes(path)) return reply(404, "Not found.");
  if (request.method !== "POST") return reply(405, "Use a secure POST operation.", new Headers({ Allow: "POST" }));
  try {
    const runtime = suppliedRuntime ?? getAdminRuntime();
    const transport = await createLoginThrottle(runtime.pool, runtime.config.secret)("transport:global", { window: 60, max: 120 });
    if (!transport.allowed) return reply(429, "Too many requests. Please try again later.", new Headers({ "Retry-After": String(transport.retryAfter) }));
    if (request.headers.get("origin") !== runtime.config.baseURL || request.headers.get("sec-fetch-site") === "cross-site") {
      await recordAdminAudit(runtime.pool, "ADMIN_ORIGIN_REJECTED");
      return reply(403, "This request could not be verified.");
    }
    let body: Record<string, unknown>;
    try {
      if (url.search) throw new Error();
      body = await boundedJson(request);
      const allowed = path.endsWith("/sign-in/email") ? ["email", "password"] : [];
      if (Object.keys(body).some((key) => !allowed.includes(key))) throw new Error();
      if (allowed.length) {
        if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
          typeof body.password !== "string" || body.password.length < 1 || body.password.length > 128) throw new Error();
        body.email = body.email.trim().toLowerCase();
      }
    } catch {
      await recordAdminAudit(runtime.pool, "ADMIN_LOGIN_FAILED");
      return reply(400, failure);
    }
    const headers = new Headers(request.headers);
    // Trust no browser-supplied forwarding headers by default. A deployment may
    // opt into a header only when its edge overwrites it and isolates the origin.
    const source = runtime.config.trustedIpHeader ? headers.get(runtime.config.trustedIpHeader) : null;
    headers.set("x-lapalme-client-ip", source && isIP(source) ? source : "127.0.0.1");
    headers.delete("content-length");
    const forwarded = new Request(new URL(path, runtime.config.baseURL), { method: "POST", headers, body: JSON.stringify(body) });
    const previous = path.endsWith("/sign-out") ? await runtime.auth.api.getSession({ headers }) : null;
    const response = await runtime.auth.handler(forwarded);
    if (response.status === 429) {
      await recordAdminAudit(runtime.pool, "ADMIN_LOGIN_THROTTLED");
      const retry = response.headers.get("Retry-After") ?? response.headers.get("X-Retry-After") ?? "900";
      return reply(429, "Too many attempts. Please wait before trying again.", new Headers({ "Retry-After": retry }));
    }
    if (!response.ok) {
      await recordAdminAudit(runtime.pool, "ADMIN_LOGIN_FAILED");
      return reply(response.status >= 500 ? 503 : 401, failure);
    }
    if (path.endsWith("/sign-in/email")) {
      // Better Auth's standard JSON includes its bearer token. Consume that only
      // on the server, then return a minimal result and the library-set cookies.
      const result = await response.json() as { token: string; user: { id: string } };
      if (!await loadEnabledAdmin(runtime.pool, result.user.id)) {
        await runtime.pool.query("DELETE FROM admin_auth_sessions WHERE token = $1", [result.token]);
        await recordAdminAudit(runtime.pool, "ADMIN_ACCESS_DENIED");
        return reply(401, failure);
      }
      try { await recordAdminAudit(runtime.pool, "ADMIN_LOGIN_SUCCEEDED", result.user.id); }
      catch {
        await runtime.pool.query("DELETE FROM admin_auth_sessions WHERE token = $1", [result.token]);
        return reply(503, "Administrator sign-in is temporarily unavailable.");
      }
    } else {
      // The library logs some revocation failures and returns success. Confirm
      // the database postcondition before acknowledging a completed logout.
      if (await runtime.auth.api.getSession({ headers })) return reply(503, "Sign-out could not be completed. Please try again.");
      if (previous) await recordAdminAudit(runtime.pool, "ADMIN_LOGOUT", previous.user.id);
    }
    return reply(200, "", response.headers);
  } catch {
    return reply(503, "Administrator access is temporarily unavailable.");
  }
}
