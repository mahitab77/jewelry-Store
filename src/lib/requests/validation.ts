import { egyptianMobile } from "../checkout/egypt.ts";
import { emailValid } from "../checkout/validation.ts";
import { cairoInstant } from "./cairo.ts";
import { requestKinds, type ConsultationChannel, type RequestFailureOutcome, type RequestKind } from "./types.ts";

export class RequestError extends Error {
  readonly status: number; readonly field?: string; readonly outcome: RequestFailureOutcome; readonly submissionId?: string;
  constructor(message: string, status = 400, field?: string, details?: { outcome: RequestFailureOutcome; submissionId?: string }) {
    super(message); this.name = "RequestError"; this.status = status; this.field = field;
    this.outcome = details?.outcome ?? "UNKNOWN"; this.submissionId = details?.submissionId;
  }
}
export function fail(message: string, status = 400, field?: string): never { throw new RequestError(message, status, field); }
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) fail("Unexpected request fields.");
  return value as Record<string, unknown>;
}
export function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail("Review this field and its length.", 400, field);
  const normalized = (value as string).normalize("NFKC").trim();
  if (normalized.length > max || required && !normalized) fail("Complete this required field.", 400, field);
  return normalized;
}
export function uuid(value: unknown, field = "reference"): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)) fail("Use a valid reference.", 400, field);
  return (value as string).toLowerCase();
}
export function submissionReference(value: unknown): string {
  const id = uuid(value, "submissionId");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) fail("Use a fresh secure submission reference.", 400, "submissionId");
  return id;
}
export function requestKind(value: unknown): RequestKind {
  if (!requestKinds.includes(value as RequestKind)) fail("Choose a supported request type.", 400, "kind");
  return value as RequestKind;
}
export interface NormalizedRequest {
  submissionId: string; kind: RequestKind; productId: string | null; variantId: string | null;
  name: string; email: string | null; phone: string | null; message: string;
  channel: ConsultationChannel | null; preferredStart: string | null;
}
export function parseRequest(value: unknown): NormalizedRequest {
  const body = object(value, ["submissionId", "kind", "productId", "variantId", "name", "email", "phone", "message", "channel", "preferredDate", "preferredTime"]);
  const submissionId = submissionReference(body.submissionId);
  const kind = requestKind(body.kind), name = text(body.name, "name", 100, true), message = text(body.message, "message", 10000, true);
  if ((name.match(/\p{L}/gu) ?? []).length < 2) fail("Enter your name using at least two letters.", 400, "name");
  const email = text(body.email, "email", 254).toLowerCase() || null;
  if (email && !emailValid(email)) fail("Enter a valid email address.", 400, "email");
  const rawPhone = text(body.phone, "phone", 40), phone = rawPhone ? egyptianMobile(rawPhone) ?? ( /^\+[1-9][0-9]{7,14}$/.test(rawPhone.replace(/[ ()-]/g, "")) ? rawPhone.replace(/[ ()-]/g, "") : null) : null;
  if (rawPhone && !phone) fail("Enter an Egyptian mobile or international telephone number beginning with + and its country code.", 400, "phone");
  if (!email && !phone) fail("Provide an email address or telephone number.", 400, "email");
  const productId = body.productId === undefined || body.productId === "" ? null : uuid(body.productId, "productId");
  const variantId = body.variantId === undefined || body.variantId === "" ? null : uuid(body.variantId, "variantId");
  if (variantId && !productId) fail("Select the published piece for this configuration.", 400, "productId");
  if ((kind === "QUOTATION" || kind === "MODIFICATION") && !productId) fail("Choose a published piece for this request.", 400, "productId");
  if (kind === "BESPOKE" && productId) fail("Use Request Changes for an existing piece.", 400, "kind");
  let channel: ConsultationChannel | null = null, preferredStart: string | null = null;
  if (kind === "CONSULTATION") {
    if (body.channel !== "ZOOM" && body.channel !== "BOUTIQUE") fail("Choose Zoom or Boutique Consultation.", 400, "channel");
    channel = body.channel as ConsultationChannel;
    if (channel === "ZOOM" && !email) fail("An email address is required for a Zoom invitation.", 400, "email");
    const date = text(body.preferredDate, "preferredDate", 10), time = text(body.preferredTime, "preferredTime", 5);
    if (date || time) { try { preferredStart = cairoInstant(date, time); } catch (error) { fail((error as Error).message, 400, "preferredTime"); } }
  } else if (body.channel !== undefined || body.preferredDate || body.preferredTime) fail("Consultation fields belong only to a consultation request.");
  return { submissionId, kind, productId, variantId, name, email, phone, message, channel, preferredStart };
}
