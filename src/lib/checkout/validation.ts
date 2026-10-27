import { object, CartError } from "../cart/session.ts";
import { egyptianMobile, governorates } from "./egypt.ts";
import { emptyDetails, type CheckoutDetails, type CheckoutErrors, type BoutiqueLocation, type CheckoutStep } from "./types.ts";

export function parseDetails(value: unknown): CheckoutDetails {
  const blank = emptyDetails(), fields = Object.keys(blank), body = object(value, fields);
  const details = { ...blank } as Record<string, string>;
  for (const key of fields) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string" || (body[key] as string).length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body[key] as string)) throw new CartError("Invalid checkout details.");
    details[key] = (body[key] as string).normalize("NFKC").trim().replace(/\s+/g, " ");
  }
  if (details.countryCode !== "EG" || !["", "PRIVATE_DELIVERY", "BOUTIQUE_COLLECTION"].includes(details.method)) throw new CartError("Choose an Egyptian destination and a supported fulfillment method.");
  // Irrelevant personal address fields are discarded before storage.
  if (details.method !== "PRIVATE_DELIVERY") for (const key of ["governorate", "city", "street", "building", "floorUnit", "instructions"]) details[key] = "";
  if (details.method !== "BOUTIQUE_COLLECTION") details.locationId = "";
  details.email = details.email.toLowerCase();
  const normalizedPhone = details.phone ? egyptianMobile(details.phone) : "";
  if (normalizedPhone !== null) details.phone = normalizedPhone;
  return details as unknown as CheckoutDetails;
}
function emailValid(value: string) {
  if (value.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(value)) return false;
  const [local, domain] = value.split("@");
  return local.length <= 64 && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..") && domain.split(".").every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}
export function validateDetails(d: CheckoutDetails, locations: BoutiqueLocation[], complete = true): CheckoutErrors {
  const errors: CheckoutErrors = {};
  if ((!d.fullName && complete) || d.fullName && (d.fullName.length > 100 || !/^[\p{L}\p{M} .'’\-]+$/u.test(d.fullName) || (d.fullName.match(/\p{L}/gu) ?? []).length < 2)) errors.fullName = "Enter your full name using letters.";
  if ((!d.email && complete) || d.email && !emailValid(d.email)) errors.email = "Enter a valid email address.";
  if ((!d.phone && complete) || d.phone && !egyptianMobile(d.phone)) errors.phone = "Enter an Egyptian mobile number, such as 01… or +20 1….";
  if (!d.method && complete) errors.method = "Choose Private Delivery or Boutique Collection.";
  if (d.method === "PRIVATE_DELIVERY") {
    if ((!d.governorate && complete) || d.governorate && !governorates.includes(d.governorate as typeof governorates[number])) errors.governorate = "Choose an Egyptian governorate from the list.";
    if ((!d.city && complete) || d.city && (d.city.length < 2 || d.city.length > 100)) errors.city = "Enter your city or area, up to 100 characters.";
    if ((!d.street && complete) || d.street && (d.street.length < 5 || d.street.length > 200)) errors.street = "Enter a street address between 5 and 200 characters.";
    if (d.building.length > 100) errors.building = "Building details must be at most 100 characters.";
    if (d.floorUnit.length > 80) errors.floorUnit = "Floor or apartment details must be at most 80 characters.";
    if (d.instructions.length > 500) errors.instructions = "Instructions must be at most 500 characters.";
  }
  if (d.method === "BOUTIQUE_COLLECTION" && ((!d.locationId && complete) || d.locationId && !locations.some((location) => location.id === d.locationId))) errors.locationId = "Choose an available boutique location.";
  return errors;
}
export function checkoutStep(cartEligible: boolean, errors: CheckoutErrors, contextChanged = false): CheckoutStep {
  if (!cartEligible || contextChanged) return "CART_REVIEW";
  if (errors.fullName || errors.email || errors.phone) return "CUSTOMER_DETAILS";
  return Object.keys(errors).length ? "FULFILLMENT" : "REVIEW_READY";
}
