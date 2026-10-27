import { connection } from "next/server";
import { adminConfiguration } from "../../../lib/admin/config.ts";
import { AdminLoginForm } from "../../../components/admin/AdminLoginForm";
import styles from "../../../components/admin/admin.module.css";

export const metadata = { title: "Administrator Sign-in | La Palme d'Or Gems" };

export default async function AdminLoginPage() {
  await connection();
  let configured = true;
  try { adminConfiguration(); } catch { configured = false; }
  return <section className={`royal-frame ${styles.loginPanel}`}>
    <p className={styles.eyebrow}>Authorised team access</p><div className="gold-hairline" />
    <h1 className="font-display">Administrator sign-in</h1>
    {configured ? <><p>Use your administrator credentials to continue.</p><AdminLoginForm /></>
      : <p role="status">Administrator sign-in is currently unavailable. Please contact the site operator.</p>}
  </section>;
}
