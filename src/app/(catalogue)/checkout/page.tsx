import { CheckoutPreparation } from "../../../components/checkout/CheckoutPreparation";
import Link from "next/link";
import { connection } from "next/server";
import { quotationOnly } from "../../../lib/commerce-policy.ts";
export const metadata = { title: "Checkout Preparation | La Palme d'Or Gems", description: "Review your jewelry selection and personal fulfillment details.", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function CheckoutPage() { await connection(); if (quotationOnly()) return <section className="maison-container section-spacing"><h1 className="font-display">Checkout is unavailable.</h1><p>Please request a personal quotation for a piece or speak with our designer. A request does not create an order or payment.</p><p><Link href="/collections">Explore the collections</Link> · <Link href="/appointment">Consult the Designer</Link></p></section>; return <CheckoutPreparation />; }
