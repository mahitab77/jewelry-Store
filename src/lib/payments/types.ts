export type PaymentOutcome = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REVIEW';
export interface VerifiedTransaction {
  transactionId: string; providerOrderId: string; amountMinor: string; currency: string;
  integrationId: string; ownerId: string; outcome: PaymentOutcome; createdAt: string;
  proof: string; source: 'PAYMOB_HMAC' | 'PAYMOB_API'; specialReference: string | null;
}
export interface OrderView {
  reference: string; orderStatus: string; paymentStatus: string; fulfillmentStatus: string;
  reconciliationRequired: boolean; inventoryFinalized: boolean; testMode: true;
  amountMinor: string; currency: 'EGP'; method: 'PRIVATE_DELIVERY' | 'BOUTIQUE_COLLECTION';
  destination: string; items: { name: string; sku: string; configuration: string; quantity: number; unitPriceMinor: string; lineTotalMinor: string }[];
  attempt: { reference: string; status: string; initiationState: string } | null;
  canRetry: boolean; canContinue: boolean;
}
export class PaymentError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.name = 'PaymentError'; this.status = status; }
}
