"use client";

import { useEffect, useRef, useState } from "react";

/**
 * BTC racing the line.
 *
 * The line is the window's opening price — settle above it and UP wins, below
 * and DOWN wins. That is the whole game in one picture, and the near-miss (the
 * price creeping to within a few dollars of the line and falling away) is the
 * most gut-wrenching thing on the screen. It costs nothing to draw.
 *
 * The series is accumulated CLIENT-SIDE from the poll, because a round is only
 * sixty seconds and the feed's coarsest useful candle is a full minute. It
 * resets whenever the round index changes.
 */
export interface Point {
  t: number;
  p: number;
}

export function usePriceSeries(roundIndex: number | null, price: number | null) {
  const [points, setPoints] = useState<Point[]>([]);
  // Sample on a timer rather than on price change: BTC often sits at the same
  // number for several polls, and an effect keyed on `price` never fires then,
  // so the tape stayed empty and the chart never drew.
  const latest = useRef<{ round: number | null; price: number | null }>({ round: null, price: null });
  const round = useRef<number | null>(null);

  latest.current = { round: roundIndex, price };

  useEffect(() => {
    const id = setInterval(() => {
      const { round: r, price: p } = latest.current;
      if (r === null || p === null) return;
      if (round.current !== r) {
        round.current = r;
        setPoints([{ t: Date.now(), p }]);
        return;
      }
      // A minute of one-second samples is 60 points; keep a little headroom.
      setPoints((prev) => [...prev, { t: Date.now(), p }].slice(-120));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return points;
}

export function Chart({
  points,
  strike,
  price,
  secondsLeft,
}: {
  points: Point[];
  strike: number | null;
  price: number | null;
  secondsLeft: number;
}) {
  const W = 1000;
  const H = 260;

  if (!strike || price === null || points.length < 2) {
    return (
      <div
        className="flex h-[260px] items-center justify-center rounded-2xl border border-[var(--edge)] text-xs tracking-widest text-[var(--dim)]"
        style={{ background: "var(--panel)" }}
      >
        {strike ? "READING THE TAPE…" : "WAITING FOR THE LINE"}
      </div>
    );
  }

  const prices = points.map((p) => p.p).concat(strike);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  // Keep the line in frame and never divide by zero on a flat tape.
  const pad = Math.max((hi - lo) * 0.35, 2);
  const min = lo - pad;
  const max = hi + pad;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const x = (i: number) => (i / Math.max(points.length - 1, 1)) * W;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  // Close the path to the strike so the winning territory is filled, not implied.
  const strikeY = y(strike);
  const area = `${line} L${W},${strikeY} L0,${strikeY} Z`;

  const above = price >= strike;
  const colour = above ? "var(--up)" : "var(--down)";
  const delta = price - strike;
  const cx = x(points.length - 1);
  const cy = y(price);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border"
      style={{
        background: "linear-gradient(180deg, var(--panel-2), var(--panel))",
        borderColor: above ? "#10331f" : "#3a0f18",
        boxShadow: `inset 0 0 90px -50px ${colour}`,
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colour} stopOpacity="0.34" />
            <stop offset="100%" stopColor={colour} stopOpacity="0.02" />
          </linearGradient>
          <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path d={area} fill="url(#fill)" />

        {/* The line to beat. Everything on the screen is relative to it. */}
        <line
          x1="0"
          x2={W}
          y1={strikeY}
          y2={strikeY}
          stroke="var(--gold)"
          strokeWidth="1.5"
          strokeDasharray="7 7"
          opacity="0.75"
          vectorEffect="non-scaling-stroke"
        />

        <path
          d={line}
          fill="none"
          stroke={colour}
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          filter="url(#bloom)"
          vectorEffect="non-scaling-stroke"
        />

        {/* The head of the tape, pulsing, so the eye knows where "now" is. */}
        <circle cx={cx} cy={cy} r="16" fill={colour} opacity="0.18">
          <animate attributeName="r" values="10;22;10" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0.03;0.3" dur="1.6s" repeatCount="indefinite" />
        </circle>
        <circle cx={cx} cy={cy} r="5" fill={colour} filter="url(#bloom)" />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">TO BEAT</p>
            <p className="tabular text-2xl font-black glow-gold">
              {strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p
              className="tabular truncate text-4xl font-black leading-none sm:text-5xl"
              style={{ color: colour, textShadow: `0 0 50px ${colour}66` }}
            >
              {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        <div className="flex items-end justify-between">
          <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">
            BTC · 1 MINUTE
          </p>
          <p className="tabular text-lg font-black" style={{ color: colour }}>
            {delta >= 0 ? "▲ +" : "▼ "}
            {delta.toFixed(2)}
            <span className="ml-3 text-xs tracking-[0.2em] opacity-80">
              {above ? "UP IS WINNING" : "DOWN IS WINNING"}
            </span>
          </p>
        </div>
      </div>

      {/* A thin bar draining to zero — time, felt rather than read. */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-[#ffffff08]">
        <div
          className="h-full transition-[width] duration-1000 ease-linear"
          style={{
            width: `${Math.max(0, Math.min(100, (secondsLeft / 60) * 100))}%`,
            background: secondsLeft < 10 ? "var(--down)" : "var(--gold)",
            boxShadow: `0 0 18px ${secondsLeft < 10 ? "var(--down)" : "var(--gold)"}`,
          }}
        />
      </div>
    </div>
  );
}
