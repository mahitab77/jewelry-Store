"use client";

import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";

type HeroRingStageProps = {
  children: React.ReactNode;
};

const TX_MAX = 12;
const TY_MAX = 5;
const ROT_MAX = 2.8;
const SCALE_HOVER = 1.022;

function subscribeReducedMotion(onStoreChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getReducedMotionServerSnapshot() {
  return false;
}

function subscribePointerFine(onStoreChange: () => void) {
  const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getPointerFineSnapshot() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function getPointerFineServerSnapshot() {
  return false;
}

export function HeroRingStage({ children }: HeroRingStageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const reduceMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const pointerFine = useSyncExternalStore(
    subscribePointerFine,
    getPointerFineSnapshot,
    getPointerFineServerSnapshot,
  );

  const tiltEnabled = !reduceMotion && pointerFine;
  const reset = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty("--ring-tx", "0px");
    el.style.setProperty("--ring-ty", "0px");
    el.style.setProperty("--ring-rot", "0deg");
    el.style.setProperty("--ring-scale", "1");
    el.dataset.ringHover = "0";
  }, []);

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = rootRef.current;
      if (!el || !tiltEnabled) return;
      const r = el.getBoundingClientRect();
      const halfW = r.width / 2;
      const halfH = r.height / 2;
      const nx = Math.max(-1, Math.min(1, (clientX - r.left - halfW) / Math.max(halfW, 1)));
      const ny = Math.max(-1, Math.min(1, (clientY - r.top - halfH) / Math.max(halfH, 1)));
      const tx = nx * TX_MAX;
      const ty = ny * TY_MAX;
      const rot = nx * ROT_MAX;
      const scale = 1 + Math.min(Math.abs(nx), 1) * (SCALE_HOVER - 1);
      el.style.setProperty("--ring-tx", `${tx}px`);
      el.style.setProperty("--ring-ty", `${ty}px`);
      el.style.setProperty("--ring-rot", `${rot}deg`);
      el.style.setProperty("--ring-scale", scale.toFixed(4));
      el.dataset.ringHover = "1";
    },
    [tiltEnabled],
  );

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!tiltEnabled) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyPointer(e.clientX, e.clientY);
    });
  };

  const onPointerLeave = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    reset();
  };

  return (
    <div
      ref={rootRef}
      className="hero-jewel-stage hero-ring-stage"
      aria-label="Featured jewelry"
      onPointerMove={tiltEnabled ? onPointerMove : undefined}
      onPointerLeave={tiltEnabled ? onPointerLeave : undefined}
    >
      <div className="hero-stage-lights" aria-hidden="true">
        <div className="hero-spotlight hero-spotlight--left" />
        <div className="hero-spotlight hero-spotlight--center" />
        <div className="hero-spotlight hero-spotlight--right" />
      </div>
      <div className="hero-floor-glow" aria-hidden="true" />
      <div className="hero-podium" aria-hidden="true" />
      <div className="hero-ring-wrap">{children}</div>
    </div>
  );
}
