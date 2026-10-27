"use client";
import { useSyncExternalStore } from "react";
import type { Cart } from "../../lib/cart/types.ts";

type State = { cart: Cart | null; loading: boolean; pending: boolean; error: string | null };
const initial: State = { cart: null, loading: true, pending: false, error: null };
let state = initial, epoch = 0, read: Promise<void> | null = null, queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
let stop: (() => void) | undefined, channel: BroadcastChannel | undefined;
function update(change: Partial<State>) { state = { ...state, ...change }; listeners.forEach((listener) => listener()); }
export async function refreshCart() {
  if (read) return read;
  const version = epoch; update({ loading: true });
  read = (async () => {
    try {
      const response = await fetch("/api/cart", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok || !result.cart) throw new Error();
      if (version === epoch) update({ cart: result.cart, error: null });
    } catch { if (version === epoch) update({ error: "Your bag could not be refreshed. Check it again before making changes." }); }
    finally { read = null; update({ loading: false }); }
  })();
  return read;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stop) {
    const refresh = () => { if (document.visibilityState === "visible") void refreshCart(); };
    window.addEventListener("focus", refresh); window.addEventListener("pageshow", refresh); document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 30000);
    if (typeof BroadcastChannel !== "undefined") { channel = new BroadcastChannel("la-palme-shopping-bag"); channel.onmessage = refresh; }
    stop = () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); document.removeEventListener("visibilitychange", refresh); channel?.close(); channel = undefined; stop = undefined; };
    void refreshCart();
  }
  return () => { listeners.delete(listener); if (!listeners.size) stop?.(); };
}
const getSnapshot = () => state;
const getServerSnapshot = () => initial;
export function useCart() { return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot); }
export function changeCart(method: "POST" | "PATCH" | "DELETE", path: string, body: Record<string, unknown>) {
  const operation = queue.then(async () => {
    epoch++; update({ pending: true });
    try {
      const response = await fetch("/api/cart/" + path, { method, credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      let result: { cart?: Cart; message?: string };
      try { result = await response.json(); } catch { throw new Error("The update could not be confirmed. Refresh your bag before trying again."); }
      epoch++; if (result.cart) update({ cart: result.cart, error: null });
      if (!response.ok) throw new Error(result.message || "Your bag could not be updated.");
      channel?.postMessage("refresh");
      return result.message || "Shopping bag updated.";
    } catch (error) {
      // Never retry an add automatically: the first request may have committed.
      await refreshCart();
      throw new Error(error instanceof Error && error.name === "Error" ? error.message : "The update could not be confirmed. Refresh your bag before trying again.");
    } finally { update({ pending: false }); }
  });
  queue = operation.catch(() => undefined);
  return operation;
}
