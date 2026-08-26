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
}: {
  points: Point[];
  strike: number | null;
  price: number | null;
}) {
  const W = 720;
  const H = 130;

  if (!strike || price === null || points.length < 2) {
    return (
      <div
        className="mt-3 flex h-[130px] items-center justify-center rounded-xl border border-[var(--edge)] text-xs text-[var(--dim)]"
        style={{ background: "var(--panel)" }}
      >
        {strike ? "reading the tape…" : "waiting for the line"}
      </div>
    );
  }

  const prices = points.map((p) => p.p).concat(strike);
  // Always keep the line in frame, and never let a flat tape divide by zero.
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = Math.max((hi - lo) * 0.25, 1);
  const min = lo - pad;
  const max = hi + pad;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const x = (i: number) => (i / Math.max(points.length - 1, 1)) * W;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  const strikeY = y(strike);
  const above = price >= strike;
  const colour = above ? "var(--up)" : "var(--down)";
  const delta = price - strike;

  return (
    <div className="relative mt-3 overflow-hidden rounded-xl border border-[var(--edge)]" style={{ background: "var(--panel)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }} preserveAspectRatio="none">
        {/* Winning territory: everything above the line belongs to UP. */}
        <rect x="0" y="0" width={W} height={strikeY} fill="var(--up)" opacity="0.05" />
        <rect x="0" y={strikeY} width={W} height={H - strikeY} fill="var(--down)" opacity="0.05" />
        <line
          x1="0"
          x2={W}
          y1={strikeY}
          y2={strikeY}
          stroke="var(--gold)"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.8"
          vectorEffect="non-scaling-stroke"
        />
        <path d={path} fill="none" stroke={colour} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <circle cx={x(points.length - 1)} cy={y(price)} r="4" fill={colour} />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex items-start justify-between p-3">
        <div>
          <p className="text-[10px] tracking-widest text-[var(--dim)]">THE LINE</p>
          <p className="tabular text-sm font-bold text-[var(--gold)]">
            {strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular text-2xl font-black" style={{ color: colour }}>
            {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <p className="tabular text-xs font-semibold" style={{ color: colour }}>
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(2)} · {above ? "UP winning" : "DOWN winning"}
          </p>
        </div>
      </div>
    </div>
  );
}
