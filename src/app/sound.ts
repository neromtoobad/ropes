"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Everything you hear, synthesised.
 *
 * No audio files: a strict CSP and a cold cache both make fetched assets a
 * liability, and the whole palette here is a few oscillators. It also means the
 * last ten seconds of a round never wait on a network request.
 *
 * Browsers refuse to start an AudioContext without a user gesture, so nothing
 * exists until the player clicks something — `arm()` is called from the first
 * real interaction as well as from the speaker toggle.
 */
class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  get ready() {
    return this.ctx !== null;
  }

  arm() {
    if (this.ctx) {
      // Tabs suspend the context on blur; bring it back on the next gesture.
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  close() {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  /** One shaped oscillator hit. The only primitive the rest is built from. */
  private tone(opts: {
    freq: number;
    to?: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
  }) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(opts.to, 1), t + opts.dur);
    // Fast attack, exponential decay — a percussive envelope, no click.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + opts.dur + 0.02);
  }

  /** Lub-dub. `urgency` 0→1 tightens and brightens it as the clock runs down. */
  heartbeat(urgency: number) {
    const base = 46 + urgency * 16;
    const gain = 0.18 + urgency * 0.3;
    this.tone({ freq: base, to: base * 0.6, dur: 0.16, gain });
    this.tone({ freq: base * 0.9, to: base * 0.55, dur: 0.14, gain: gain * 0.7, delay: 0.17 });
  }

  /** Your side won and your stack just multiplied. */
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.5, gain: 0.26, type: "triangle", delay: i * 0.07 }),
    );
  }

  /** Your run just ended. Low, final, no resolution. */
  death() {
    this.tone({ freq: 150, to: 42, dur: 1.1, gain: 0.4, type: "sawtooth" });
    this.tone({ freq: 74, to: 32, dur: 1.3, gain: 0.3 });
  }

  /** The bell for a round you were not in — the table still moved. */
  toll() {
    this.tone({ freq: 196, to: 130, dur: 0.7, gain: 0.2, type: "triangle" });
  }

  /** Void: nobody died, nothing resolved. */
  push() {
    this.tone({ freq: 330, dur: 0.25, gain: 0.18, type: "square" });
    this.tone({ freq: 330, dur: 0.25, gain: 0.18, type: "square", delay: 0.3 });
  }

  click() {
    this.tone({ freq: 880, to: 660, dur: 0.07, gain: 0.16, type: "square" });
  }
}

const engine = new Engine();

export function useSound() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(localStorage.getItem("lc.sound") === "on");
  }, []);

  const arm = useCallback(() => {
    if (localStorage.getItem("lc.sound") === "off") return;
    engine.arm();
  }, []);

  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      localStorage.setItem("lc.sound", next ? "on" : "off");
      if (next) engine.arm();
      else engine.close();
      return next;
    });
  }, []);

  const play = useCallback(
    (what: "win" | "death" | "toll" | "push" | "click", urgency = 0) => {
      if (!engine.ready) return;
      if (what === "win") engine.win();
      else if (what === "death") engine.death();
      else if (what === "toll") engine.toll();
      else if (what === "push") engine.push();
      else engine.click();
      void urgency;
    },
    [],
  );

  return { on, toggle, arm, play, engine };
}

/**
 * The heartbeat. Silent until the last stretch of a round, then it accelerates
 * from roughly one beat a second to four — which is most of what makes the
 * final ten seconds feel like anything.
 */
export function useHeartbeat(secondsLeft: number, active: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secs = useRef(secondsLeft);
  const live = useRef(active);
  secs.current = secondsLeft;
  live.current = active;

  useEffect(() => {
    const START = 20; // seconds out at which the heart starts
    // The heart STOPS five seconds out. Sudden silence right as the camera
    // pushes in is the drop — the bell lands into it.
    const CUT = 5;

    const beat = () => {
      const s = secs.current;
      if (live.current && engine.ready && s > CUT && s <= START) {
        const urgency = 1 - s / START;
        engine.heartbeat(urgency);
        // 900ms out at the edge of the window, down to 240ms at the buzzer.
        timer.current = setTimeout(beat, 900 - urgency * 660);
      } else {
        // Idle poll — cheap, and picks the beat back up on the next round.
        timer.current = setTimeout(beat, 400);
      }
    };
    beat();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
}
