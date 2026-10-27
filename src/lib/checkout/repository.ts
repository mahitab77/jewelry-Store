import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { withDatabaseClient, withTransaction } from "../db/client.ts";
import { readOwnedCart } from "../cart/repository.ts";
import { emptyCart } from "../cart/types.ts";
import { emptyDetails, type BoutiqueLocation, type CheckoutDetails, type CheckoutView, type CheckoutErrors } from "./types.ts";
import { checkoutStep, validateDetails } from "./validation.ts";

const revisionSql = `to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
type Owned = NonNullable<Awaited<ReturnType<typeof readOwnedCart>>>;
type Draft = { details: CheckoutDetails; revision: string; expiresAt: string; fingerprint: string };
export const checkoutFingerprint = (cart: CheckoutView["cart"], locations: BoutiqueLocation[]) => createHash("sha256").update(JSON.stringify({ cart, locations })).digest("hex");
export const draftSavingEnabled = () => process.env.NODE_ENV !== "production" || process.env.CHECKOUT_DRAFT_RETENTION_READY === "true";
export const emptyCheckout = (): CheckoutView => ({ cart: emptyCart(), details: emptyDetails(), locations: [], fingerprint: "", draft: null, state: "CART_REVIEW", changed: false, savingAvailable: draftSavingEnabled() });

export async function purgeCheckoutDrafts(limit = 100): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid retention batch size.");
  return withDatabaseClient(async (client) => (await client.query(`DELETE FROM checkout_drafts WHERE id IN (
    SELECT d.id FROM checkout_drafts d JOIN carts c ON c.id=d.cart_id
    WHERE d.expires_at<=clock_timestamp() OR c.expires_at<=clock_timestamp() OR c.status<>'ACTIVE' OR c.customer_profile_id IS NOT NULL
    ORDER BY d.expires_at,d.id LIMIT $1 FOR UPDATE OF d SKIP LOCKED)`, [limit])).rowCount ?? 0, "cart");
}
async function locations(client: PoolClient): Promise<BoutiqueLocation[]> {
  return (await client.query<BoutiqueLocation>(`SELECT id,name,governorate,city_area AS city,street_address AS street
    FROM boutique_locations WHERE is_active AND country_code='EG' ORDER BY name,id LIMIT 100`)).rows;
}
async function draft(client: PoolClient, cartId: string): Promise<Draft | null> {
  const row = (await client.query(`SELECT full_name AS "fullName",email,phone,COALESCE(fulfillment_method,'') AS method,
    country_code AS "countryCode",governorate,city_area AS city,street_address AS street,building,floor_unit AS "floorUnit",instructions,
    COALESCE(boutique_location_id::TEXT,'') AS "locationId",context_fingerprint AS fingerprint,${revisionSql} AS revision,expires_at
    FROM checkout_drafts WHERE cart_id=$1 AND expires_at>clock_timestamp() FOR UPDATE`, [cartId])).rows[0];
  if (!row) return null;
  const { fingerprint, revision, expires_at, ...details } = row;
  return { details: details as CheckoutDetails, fingerprint, revision, expiresAt: (expires_at as Date).toISOString() };
}
function view(owned: Owned, stored: Draft | null, available: BoutiqueLocation[]): CheckoutView {
  const fingerprint = checkoutFingerprint(owned.cart, available), details = stored?.details ?? emptyDetails();
  const errors = validateDetails(details, available), changed = Boolean(stored && stored.fingerprint !== fingerprint);
  return { cart: owned.cart, details, fingerprint, locations: available,
    draft: stored ? { revision: stored.revision, expiresAt: stored.expiresAt } : null,
    state: checkoutStep(owned.cart.eligible, errors, changed), changed, savingAvailable: draftSavingEnabled() };
}
export async function loadCheckout(token: string | null): Promise<CheckoutView> {
  if (!token) return emptyCheckout();
  await purgeCheckoutDrafts();
  return withTransaction(async (client) => {
    const owned = await readOwnedCart(client, token, true);
    if (!owned) return emptyCheckout();
    const stored = await draft(client, owned.id), available = await locations(client);
    return view(owned, stored, available);
  }, false, "cart");
}
type Command = { action: "save" | "review"; details: CheckoutDetails; fingerprint: string; revision: string | null } | { action: "delete"; revision: string | null };
export async function prepareCheckout(token: string | null, command: Command) {
  if (!token) return { status: 401, message: "Open your shopping bag to begin checkout preparation.", checkout: emptyCheckout() };
  await purgeCheckoutDrafts();
  return withTransaction(async (client) => {
    const owned = await readOwnedCart(client, token, true);
    if (!owned) return { status: 401, message: "Your shopping bag session is no longer active.", checkout: emptyCheckout() };
    const stored = await draft(client, owned.id), available = await locations(client), current = view(owned, stored, available);
    if (command.action === "save" && !draftSavingEnabled()) return { status: 503, message: "Saved checkout details are temporarily unavailable. You can review without saving.", checkout: current };
    if (command.action === "delete") {
      if (command.revision !== (stored?.revision ?? null)) return { status: 409, message: "Saved details changed. Restore the current draft before clearing it.", checkout: current };
      await client.query("DELETE FROM checkout_drafts WHERE cart_id=$1", [owned.id]);
      return { status: 200, message: "Saved checkout details cleared.", checkout: view(owned, null, available) };
    }
    if (command.fingerprint !== current.fingerprint) return { status: 409, message: "Your bag or collection options changed. Review the current information before continuing.", checkout: current };
    if (command.action === "save" && command.revision !== (stored?.revision ?? null)) return { status: 409, message: "Saved details changed or expired. Restore the current draft before saving again.", checkout: current };
    const errors: CheckoutErrors = validateDetails(command.details, available, command.action === "review");
    if (!owned.cart.eligible) errors.cart = "Please review unavailable selections or quantities in your shopping bag.";
    if (Object.keys(errors).length) return { status: 422, message: "Please review the highlighted details.", errors, checkout: current };
    if (command.action === "review") {
      const latest = await readOwnedCart(client, token, true);
      if (!latest) return { status: 401, message: "Your shopping bag session is no longer active.", checkout: emptyCheckout() };
      const checked = view(latest, stored, await locations(client));
      if (checked.fingerprint !== command.fingerprint || !checked.cart.eligible) return { status: 409, message: "Your bag or collection options changed. Review the current information before continuing.", checkout: checked };
      return { status: 200, message: "Your details are ready for review. No order, payment or reservation has been created.", checkout: {
        ...checked, details: command.details, state: "REVIEW_READY" as const, changed: false,
      } };
    }
    const d = command.details;
    // One owner-locked transaction, and one explicit PII save. Expiry never rolls.
    const saved = await client.query(`WITH moment AS (SELECT clock_timestamp() AS at)
      INSERT INTO checkout_drafts(cart_id,full_name,email,phone,fulfillment_method,country_code,governorate,city_area,street_address,
        building,floor_unit,instructions,boutique_location_id,context_fingerprint,created_at,updated_at,expires_at)
      SELECT c.id,$2,$3,$4,$5,'EG',$6,$7,$8,$9,$10,$11,$12,$13,moment.at,moment.at,LEAST(c.expires_at,moment.at+INTERVAL '24 hours')
      FROM carts c CROSS JOIN moment WHERE c.id=$1 AND c.status='ACTIVE' AND c.customer_profile_id IS NULL AND c.expires_at>clock_timestamp()
        AND ($5 IS DISTINCT FROM 'BOUTIQUE_COLLECTION' OR $12::UUID IS NULL OR EXISTS(SELECT 1 FROM boutique_locations WHERE id=$12 AND is_active))
      ON CONFLICT(cart_id) DO UPDATE SET full_name=EXCLUDED.full_name,email=EXCLUDED.email,phone=EXCLUDED.phone,
        fulfillment_method=EXCLUDED.fulfillment_method,governorate=EXCLUDED.governorate,city_area=EXCLUDED.city_area,
        street_address=EXCLUDED.street_address,building=EXCLUDED.building,floor_unit=EXCLUDED.floor_unit,instructions=EXCLUDED.instructions,
        boutique_location_id=EXCLUDED.boutique_location_id,context_fingerprint=EXCLUDED.context_fingerprint,updated_at=clock_timestamp(),
        expires_at=LEAST(checkout_drafts.expires_at,EXCLUDED.expires_at) RETURNING id`,
    [owned.id, d.fullName, d.email, d.phone, d.method || null, d.governorate, d.city, d.street, d.building, d.floorUnit, d.instructions, d.locationId || null, current.fingerprint]);
    if (!saved.rowCount) return { status: 409, message: "Your bag or collection options changed. Refresh before saving again.", checkout: current };
    const latest = await readOwnedCart(client, token, true);
    if (!latest) { await client.query("DELETE FROM checkout_drafts WHERE cart_id=$1", [owned.id]); return { status: 401, message: "Your shopping bag session is no longer active.", checkout: emptyCheckout() }; }
    return { status: 200, message: "Checkout draft saved for up to 24 hours. No order has been placed.", checkout: view(latest, await draft(client, owned.id), await locations(client)) };
  }, false, "cart");
}
