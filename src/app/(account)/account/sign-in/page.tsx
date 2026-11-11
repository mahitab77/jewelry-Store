import { CustomerAuthForm } from "../../../../components/customer/CustomerAuthForm";
import { customerReturn } from "../../../../lib/customer/intent";
export const metadata = { title: "Sign In | La Palme d'Or", robots: { index: false, follow: false } };
export default async function CustomerSignIn({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CustomerAuthForm destination={customerReturn((await searchParams).returnTo)} />;
}
