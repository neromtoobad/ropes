"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Glide toward a target that arrives in steps.
 *
 * The state poll lands every 750ms, so every number on screen — and the wall
 * itself — used to move in eased JUMPS, one per poll. This lerps at frame
 * rate instead: exponential approach with time constant `tau` (ms), which is
 * frame-rate independent and never overshoots.
 *
 * `snapAbove` guards the cut moments: a brand-new run or a reset jumps the
 * target by whole multiples, and gliding through that would scroll the whole
 * world past like a slot machine. Big jumps snap; small ones glide.
 */
export function useSmoothed(target: number, tau = 320, snapAbove = 2) {
  const [value, setValue] = useState(target);
  const s = useRef({ value: target, target, raf: 0, last: 0 });
  s.current.target = target;

  useEffect(() => {
    const st = s.current;
    if (Math.abs(st.value - target) > snapAbove) {
      st.value = target;
      setValue(target);
      return;
    }
    if (st.raf) return; // a loop is already chasing the (updated) target

    const step = (now: number) => {
      const dt = st.last ? now - st.last : 16;
      st.last = now;
      const diff = st.target - st.value;
      if (Math.abs(diff) < 0.0004) {
        st.value = st.target;
        st.raf = 0;
        st.last = 0;
        setValue(st.target);
        return;
      }
      st.value += diff * (1 - Math.exp(-dt / tau));
      setValue(st.value);
      st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
    return () => {
      if (st.raf) cancelAnimationFrame(st.raf);
      st.raf = 0;
      st.last = 0;
    };
  }, [target, tau, snapAbove]);

  return value;
}
