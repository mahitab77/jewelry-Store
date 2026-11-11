"use client";
import Link from "next/link";
import { Fragment, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { usePathname } from "next/navigation";
import { customerSignIn } from "../../lib/customer/intent";
import styles from "../requests/request.module.css";

export interface CustomerSession { id: string; expiresAt: string; name: string; email: string; phone: string }
type State = { customer: CustomerSession | null; checking: boolean };
type Context = State & { refresh: (force?: boolean, quiet?: boolean) => Promise<void>; signOut: () => Promise<boolean>; hide: () => void };
const CustomerContext = createContext<Context | null>(null);
export const privateCustomerClear = () => window.dispatchEvent(new Event("lapalme-customer-clear"));
export function CustomerSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname(), [state, setState] = useState<State>({ customer: null, checking: true });
  const sequence = useRef(0), controller = useRef<AbortController | null>(null), lastIdentity = useRef<string | null>(null), active = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const logoutBlocked = useRef(false);
  const hide = useCallback(() => { sequence.current++; controller.current?.abort(); controller.current = null; setState({ customer: null, checking: true }); }, []);
  const refresh = useCallback(async (force = false, quiet = false) => {
    if (force) logoutBlocked.current = false;
    if (logoutBlocked.current) return;
    if (!active.current || document.visibilityState !== "visible") return;
    if (quiet) { sequence.current++; controller.current?.abort(); } else hide();
    const version = sequence.current, request = new AbortController(); controller.current = request;
    try {
      const response = await fetch("/api/customer-auth/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
      const result = await response.json();
      if (!active.current || version !== sequence.current) return;
      if (!response.ok || result.customer && (typeof result.customer.id !== "string" || !Number.isFinite(Date.parse(result.customer.expiresAt)) || Date.parse(result.customer.expiresAt) <= Date.now() || typeof result.customer.email !== "string" || typeof result.customer.name !== "string" || typeof result.customer.phone !== "string")) throw new Error();
      if (!result.customer || lastIdentity.current && result.customer.id !== lastIdentity.current) privateCustomerClear();
      lastIdentity.current = result.customer?.id ?? null;
      setState({ customer: result.customer ?? null, checking: false });
    } catch { if (active.current && version === sequence.current) { privateCustomerClear(); setState({ customer: null, checking: false }); } }
  }, [hide]);
  const signOut = useCallback(async () => {
    logoutBlocked.current = true; hide(); privateCustomerClear(); channel.current?.postMessage("hide");
    try {
      const response = await fetch("/api/customer-auth/sign-out", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) { setState({ customer: null, checking: false }); return false; }
      lastIdentity.current = null; setState({ customer: null, checking: false }); channel.current?.postMessage("changed"); return true;
    } catch { setState({ customer: null, checking: false }); return false; }
  }, [hide]);
  useLayoutEffect(() => {
    if (pathname.startsWith("/admin")) return;
    active.current = true;
    const hideNow = () => flushSync(hide);
    const restore = () => { hideNow(); void refresh(); };
    const visibility = () => document.visibilityState === "visible" ? restore() : hideNow();
    const restored = (event: PageTransitionEvent) => { if (event.persisted) restore(); };
    const denied = () => { hideNow(); privateCustomerClear(); setState({ customer: null, checking: false }); };
    window.addEventListener("pagehide", hideNow); window.addEventListener("pageshow", restored); window.addEventListener("popstate", restore); window.addEventListener("focus", restore);
    window.addEventListener("lapalme-customer-denied", denied); document.addEventListener("visibilitychange", visibility);
    channel.current = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("lapalme-customer");
    if (channel.current) channel.current.onmessage = event => {
      if (event.data === "hide") { logoutBlocked.current = true; hideNow(); privateCustomerClear(); }
      else { logoutBlocked.current = false; restore(); }
    };
    // Security boundary: hide cached private content before the next paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(false, true); }, 30000);
    // Invalidate the current generation, not a captured generation from setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { active.current = false; sequence.current++; controller.current?.abort(); clearInterval(poll); channel.current?.close(); channel.current = null;
      window.removeEventListener("pagehide", hideNow); window.removeEventListener("pageshow", restored); window.removeEventListener("popstate", restore); window.removeEventListener("focus", restore);
      window.removeEventListener("lapalme-customer-denied", denied); document.removeEventListener("visibilitychange", visibility); };
  }, [pathname, hide, refresh]);
  useEffect(() => {
    if (!state.customer) return;
    const timer = window.setTimeout(() => { hide(); privateCustomerClear(); void refresh(); }, Math.max(0, Date.parse(state.customer.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [state.customer, hide, refresh]);
  return <CustomerContext.Provider value={{ ...state, refresh, signOut, hide }}>{children}</CustomerContext.Provider>;
}
export function useCustomer() { const value = useContext(CustomerContext); if (!value) throw new Error("Customer context is required."); return value; }
export function CustomerGate({ children, returnTo = "/account" }: { children: ReactNode; returnTo?: string }) {
  const { customer, checking } = useCustomer();
  if (checking) return <section className={styles.root}><p role="status">Checking your private account access…</p></section>;
  if (!customer) return <section className={styles.root}><h2>A personal conversation.</h2><p>Sign in or create an account to continue. Your selected jewelry and configuration will be kept.</p><Link className={`hero-cta hero-primary-button ${styles.button}`} href={customerSignIn(returnTo)}>Sign In / Create Account</Link></section>;
  return <Fragment key={customer.id}>{children}</Fragment>;
}
