import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isLoopback } from "../db/config.ts";

export const CART_LIFETIME = 30 * 24 * 60 * 60;
export class CartError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.name = "CartError"; this.status = status; }
}
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const cookieName = () => process.env.NODE_ENV === "production" ? "__Host-la-palme-bag" : "la-palme-bag";
export function readToken(headers: Headers) {
  const values = (headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(cookieName() + "="));
  const token = values.length === 1 ? values[0].slice(cookieName().length + 1) : null;
  return { present: values.length > 0, token: token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null };
}
export function cartOrigin(value = process.env.CART_ORIGIN): URL {
  try {
    const url = new URL(value ?? "");
    if (url.origin !== value || url.username || url.password || url.search || url.hash ||
      (!isLoopback(url.hostname) && /YOUR|\.invalid$/.test(url.hostname)) ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname) && process.env.NODE_ENV !== "production"))) throw new Error();
    return url;
  } catch { throw new CartError("Shopping bag updates are temporarily unavailable. Please try again later.", 503); }
}
export function setCartCookie(token: string, expiresAt: string) {
  const secure = process.env.NODE_ENV === "production" || cartOrigin().protocol === "https:";
  return `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CART_LIFETIME}; Expires=${new Date(expiresAt).toUTCString()}${secure ? "; Secure" : ""}`;
}
export function clearCartCookie() {
  return `${cookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) throw new CartError("Invalid shopping bag fields.");
  return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) throw new CartError("Invalid jewelry selection.");
  return value;
}
export function quantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 99) throw new CartError("Choose a whole quantity between 1 and 99.");
  return value;
}
export function revision(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value)) throw new CartError("Reload your shopping bag before changing this selection.", 409);
  return value;
}
