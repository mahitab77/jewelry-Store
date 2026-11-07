"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useCatalogueNavigationGuard } from "../admin/useCatalogueNavigationGuard";

type Update<T> = T | ((current: T) => T);
type DraftSlot<T> = { get: () => T; update: (value: Update<T>) => void; subscribe: (listener: () => void) => () => void };
type NavigationGuard = { message: string };
type Experience = { slots: Map<string, DraftSlot<unknown>>; getGuard: () => NavigationGuard | null; registerGuard: (value: NavigationGuard) => () => void };
const RequestExperience = createContext<Experience | null>(null);
const historyKey = "__lpRequestHistory";
type Position = { scope: string; index: number };
type NavigationEntry = { key: string; index: number };
type TraverseEvent = Event & { navigationType: string; destination: { url: string; key: string; index: number; sameDocument: boolean } };
type BrowserNavigation = EventTarget & { currentEntry?: NavigationEntry };
function navigation() { return (window as Window & { navigation?: BrowserNavigation }).navigation; }
function position(state: unknown, scope: string): number | undefined {
  if (!state || typeof state !== "object") return;
  const value = (state as Record<string, unknown>)[historyKey] as Position | undefined;
  if (value?.scope === scope && Number.isSafeInteger(value.index)) return value.index;
}
function stateWithPosition(state: unknown, value: Position): unknown {
  // Next owns its complete history payload. Merge one non-sensitive namespace;
  // never replace its tree, infer an entry from a URL, or insert a trap entry.
  // Other callers' null/primitive/array payloads retain their original semantics.
  return state && typeof state === "object" && !Array.isArray(state) ? { ...state, [historyKey]: value } : state;
}
function isNextState(state: unknown): state is Record<string, unknown> {
  return Boolean(state && typeof state === "object" && (state as Record<string, unknown>).__NA === true && (state as Record<string, unknown>).__PRIVATE_NEXTJS_INTERNALS_TREE);
}
function sameRoute(left: string, right: string) {
  const source = new URL(left), destination = new URL(right);
  return source.origin === destination.origin && source.pathname === destination.pathname && source.search === destination.search;
}

export function RequestExperienceProvider({ children }: { children: ReactNode }) {
  // A document-local canonical store is required with cacheComponents disabled:
  // request pages unmount during Next navigation. No request state is copied to
  // browser storage, history payloads, URLs, or an additional persistence layer.
  const [experience] = useState<Experience>(() => {
    let guard: NavigationGuard | null = null;
    return { slots: new Map(), getGuard: () => guard, registerGuard: (value) => { guard = value; return () => { if (guard === value) guard = null; }; } };
  });
  useEffect(() => {
    const scope = crypto.randomUUID(), native = navigation();
    const originalPush = history.pushState, originalReplace = history.replaceState;
    let index = 0, nativeIndex = native?.currentEntry?.index;
    let href = location.href, lastState: unknown = history.state;
    let restoring: number | undefined;
    originalReplace.call(history, stateWithPosition(history.state, { scope, index }), "");
    const stampWrittenNextState = (writtenIndex: number) => {
      // Next can turn a caller's null payload into its own router state inside
      // the delegated method. Label that resulting object after the call; leave
      // actual null/primitive third-party payloads untouched.
      if (isNextState(history.state) && position(history.state, scope) !== writtenIndex) originalReplace.call(history, stateWithPosition(history.state, { scope, index: writtenIndex }), "");
    };
    const push: History["pushState"] = function (state, unused, url) {
      const next = index + 1;
      originalPush.call(history, stateWithPosition(state, { scope, index: next }), unused, url);
      stampWrittenNextState(next);
      index = next; nativeIndex = native?.currentEntry?.index; href = location.href; lastState = history.state;
    };
    const replace: History["replaceState"] = function (state, unused, url) {
      originalReplace.call(history, stateWithPosition(state, { scope, index }), unused, url);
      stampWrittenNextState(index);
      nativeIndex = native?.currentEntry?.index; href = location.href; lastState = history.state;
    };
    history.pushState = push; history.replaceState = replace;
    const stampFragment = () => {
      if (history.state !== null || !sameRoute(href, location.href) || new URL(href).hash === location.hash || !isNextState(lastState)) return;
      // Native fragment links create a genuine entry without calling pushState.
      // Keep its existing route tree and label that entry in place so a later
      // fallback traversal counts it correctly. This does not change payloads
      // passed by callers to pushState/replaceState or create another entry.
      index += 1;
      originalReplace.call(history, stateWithPosition(lastState, { scope, index }), "");
      nativeIndex = native?.currentEntry?.index; href = location.href; lastState = history.state;
    };
    const traverse = (raw: Event) => {
      const event = raw as TraverseEvent;
      if (event.navigationType !== "traverse" || event.destination.sameDocument !== false || restoring !== undefined || sameRoute(href, event.destination.url)) return;
      const guard = experience.getGuard();
      if (!guard || !event.cancelable) return;
      // Reserve native precommit cancellation for cross-document exits. Chromium
      // can coalesce an immediate history.forward after preventDefault, so all
      // same-document decisions use indexed capture restoration below. Native
      // currentEntry indexes remain available when a state lacks our marker.
      if (!window.confirm(guard.message)) event.preventDefault();
    };
    const pop = (event: PopStateEvent) => {
      const fragmentOnly = sameRoute(href, location.href);
      stampFragment();
      const destination = position(event.state, scope) ?? position(history.state, scope);
      const nextNativeIndex = native?.currentEntry?.index;
      if (restoring !== undefined) {
        event.stopImmediatePropagation();
        if (destination === restoring || destination === undefined && nextNativeIndex !== undefined && nextNativeIndex === nativeIndex) restoring = undefined;
        else {
          // A second browser gesture can supersede an in-flight restoration.
          // Recompute from its actual destination instead of assuming the
          // first history.go has reached the source entry already.
          const delta = destination !== undefined ? restoring - destination : nativeIndex !== undefined && nextNativeIndex !== undefined ? nativeIndex - nextNativeIndex : 0;
          if (delta) history.go(delta);
        }
        return;
      }
      const guard = experience.getGuard();
      const delta = destination !== undefined ? index - destination : nativeIndex !== undefined && nextNativeIndex !== undefined ? nativeIndex - nextNativeIndex : undefined;
      // Arbitrary third-party history entries with primitive payloads expose no
      // index in older engines. Do not offer a Cancel action we cannot honor.
      // All app-router and native fragment entries are indexed; canonical drafts
      // still survive other same-document entries and beforeunload guards exit.
      if (guard && !fragmentOnly && delta !== undefined && delta !== 0 && !window.confirm(guard.message)) {
          // popstate itself is not cancelable. Keep Next's source tree mounted,
          // then traverse to the actual source entry, suppressing only that
          // restoration event. This preserves Back/Forward order and all Next
          // state, including repeated URLs, without a synthetic history push.
          event.stopImmediatePropagation(); restoring = index; history.go(delta); return;
      }
      if (destination !== undefined) index = destination;
      nativeIndex = nextNativeIndex; href = location.href; lastState = history.state;
    };
    native?.addEventListener("navigate", traverse);
    window.addEventListener("popstate", pop, true);
    window.addEventListener("hashchange", stampFragment);
    return () => {
      native?.removeEventListener("navigate", traverse);
      window.removeEventListener("popstate", pop, true);
      window.removeEventListener("hashchange", stampFragment);
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
    };
  }, [experience]);
  return <RequestExperience.Provider value={experience}>{children}</RequestExperience.Provider>;
}

export function useRequestDraft<T>(key: string, create: () => T) {
  const experience = useContext(RequestExperience);
  if (!experience) throw new Error("Request forms require the request experience provider.");
  const slot = useMemo(() => {
    const saved = experience.slots.get(key);
    if (saved) return saved as DraftSlot<T>;
    let value = create();
    const listeners = new Set<() => void>();
    const created: DraftSlot<T> = {
      get: () => value,
      update: (next) => { value = typeof next === "function" ? (next as (current: T) => T)(value) : next; for (const listener of listeners) listener(); },
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    experience.slots.set(key, created as DraftSlot<unknown>); return created;
    // The initializer belongs to a context's first visit, not each re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experience, key]);
  const state = useSyncExternalStore(slot.subscribe, slot.get, slot.get);
  return [state, slot.update, slot.get] as const;
}

export function useRequestNavigationGuard(blocked: boolean, message: string) {
  const experience = useContext(RequestExperience);
  // Reuse the established click and full-document unload behavior; catalogue
  // editors keep their existing hook unchanged. Only active requests register
  // with the additional Back/Forward guard.
  useCatalogueNavigationGuard(blocked, message);
  useEffect(() => {
    if (!experience || !blocked) return;
    return experience.registerGuard({ message });
  }, [experience, blocked, message]);
}
