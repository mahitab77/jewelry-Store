import "server-only";

// This private deployment setting is deliberately independent of product sales
// modes and payment-provider flags. Missing and unknown values fail closed.
// DIRECT_SALES is reserved for a separately reviewed operator activation.
export function quotationOnly(): boolean { return process.env.COMMERCE_MODE !== "DIRECT_SALES"; }
export const purchasingUnavailableMessage = "Purchasing is unavailable. Please request a quotation or designer consultation.";
