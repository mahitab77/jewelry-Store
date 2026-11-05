import { CartContents } from "../../../components/cart/CartContents";
import Link from "next/link";
import { connection } from "next/server";
import { quotationOnly } from "../../../lib/commerce-policy.ts";
export const metadata = { title: "Shopping Bag | La Palme d'Or Gems", description: "Review your selection of La Palme d'Or jewelry.", robots: { index: false, follow: false } };
export default async function CartPage() { await connection(); if (quotationOnly()) return <section className="maison-container section-spacing"><h1 className="font-display">A personal quotation comes first.</h1><p>Direct purchasing is currently unavailable. Explore the collection and request a quotation or designer consultation. Existing purchase records remain private and unchanged.</p><p><Link href="/collections">Explore the collections</Link> · <Link href="/appointment">Consult the Designer</Link></p></section>; return <CartContents />; }
