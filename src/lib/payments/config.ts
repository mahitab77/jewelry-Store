import 'server-only';
import { cartOrigin } from '../cart/session.ts';
import { draftSavingEnabled } from '../checkout/repository.ts';
import { databaseConfig } from '../db/config.ts';
import { PaymentError } from './types.ts';

export const PAYMOB_API = 'https://accept.paymob.com';
export const PAYMOB_CHECKOUT = 'https://eg.checkout.paymob.com/';
export const INTENTION_SECONDS = 900;
const positive = (value: string | undefined) => Boolean(value && /^[1-9]\d{0,14}$/.test(value) && Number.isSafeInteger(Number(value)));
const secret = (value: string | undefined) => Boolean(value && value.length >= 16 && value.length <= 2048 && !/\s|YOUR|PLACEHOLDER/i.test(value));
export function verificationConfig() {
  const e = process.env;
  if (e.PAYMOB_MODE !== 'test' || !secret(e.PAYMOB_HMAC_SECRET) || !positive(e.PAYMOB_INTEGRATION_ID) || !positive(e.PAYMOB_OWNER_ID)) throw new PaymentError('Test payment verification is unavailable.',503);
  return { hmac: e.PAYMOB_HMAC_SECRET!, integrationId: e.PAYMOB_INTEGRATION_ID!, ownerId: e.PAYMOB_OWNER_ID! };
}
export function paymobConfig() {
  const verification = verificationConfig(), e = process.env, origin = cartOrigin().origin;
  if (!/^sk_test_[A-Za-z0-9_-]{16,200}$/.test(e.PAYMOB_SECRET_KEY ?? '') || !/^(?:egy_)?pk_test_[A-Za-z0-9_-]{16,200}$/.test(e.PAYMOB_PUBLIC_KEY ?? '') || !secret(e.PAYMOB_API_KEY)) throw new PaymentError('Online test payment is currently unavailable.',503);
  return { ...verification, secretKey: e.PAYMOB_SECRET_KEY!, publicKey: e.PAYMOB_PUBLIC_KEY!, apiKey: e.PAYMOB_API_KEY!, origin };
}
export function requirePaymentInitiation() {
  if (process.env.PAYMENTS_TEST_ENABLED !== 'true' || process.env.PAYMENTS_RECONCILIATION_READY !== 'true' || !draftSavingEnabled()) throw new PaymentError('Online test payment is currently unavailable. You can still prepare your details.',503);
  databaseConfig(process.env.PAYMENT_DATABASE_URL || '');
  return paymobConfig();
}
export function paymentsAvailable() { try { requirePaymentInitiation(); return true; } catch { return false; } }
export function hostedCheckout(clientSecret: string, publicKey: string): string {
  if (!/^egy_csk_test_[A-Za-z0-9_-]{16,200}$/.test(clientSecret) || !/^(?:egy_)?pk_test_[A-Za-z0-9_-]{16,200}$/.test(publicKey)) throw new PaymentError('The test checkout destination could not be verified.',503);
  const url = new URL(PAYMOB_CHECKOUT); url.searchParams.set('publicKey',publicKey); url.searchParams.set('clientSecret',clientSecret); return url.href;
}
