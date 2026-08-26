"use client";

import { useEffect, useRef, useState } from "react";

/**
 * BTC racing the line.
 *
 * The line is the window's opening price — settle above it and UP wins, below
 * and DOWN wins. That is the whole game in one picture, and the near-miss (the
 * price creeping toward the line and falling away) is the most gut-wrenching
 * thing on the screen.
 *
 * Built as an OBJECT rather than a panel: a bevelled housing, a real price axis
 * in a right-hand gutter, the open labelled on that axis, and the live price in
 * a pill riding the head of the tape. A flat rounded rectangle reads as a
 * dashboard widget no matter what is drawn inside it.
 *
 * The tape is accumulated CLIENT-SIDE from the poll, because a round is only
 * sixty seconds and the feed's coarsest useful candle is a full minute.
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
      setPoints((prev) => [...prev, { t: Date.now(), p }].slice(-120));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return points;
}

/** Width of the price gutter in px. Labels live here; the plot stops short. */
const GUTTER = 84;
const H = 300;
const W = 1000;

export function Chart({
  points,
  strike,
  price,
  secondsLeft,
  roundIndex,
}: {
  points: Point[];
  strike: number | null;
  price: number | null;
  secondsLeft: number;
  roundIndex: number | null;
}) {
  if (!strike || price === null || points.length < 2) {
    return (
      <Frame>
        <div className="flex h-full items-center justify-center text-[10px] tracking-[0.3em] text-[var(--dim)] sm:text-xs">
          {strike ? "READING THE TAPE…" : "WAITING FOR THE LINE"}
        </div>
      </Frame>
    );
  }

  const prices = points.map((p) => p.p).concat(strike);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  // Keep the line off the edges, and never divide by zero on a flat tape.
  const pad = Math.max((hi - lo) * 0.45, 3);
  const min = lo - pad;
  const max = hi + pad;

  /** value → 0..1 from the top, shared by the SVG and the HTML overlays. */
  const t = (v: number) => 1 - (v - min) / (max - min);
  const y = (v: number) => t(v) * H;
  const x = (i: number) => (i / Math.max(points.length - 1, 1)) * W;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  const strikeY = y(strike);
  const area = `${line} L${W},${strikeY} L0,${strikeY} Z`;

  const above = price >= strike;
  const colour = above ? "var(--up)" : "var(--down)";
  const delta = price - strike;
  const headX = x(points.length - 1);
  const headY = y(price);

  // Grid rows on readable intervals.
  const step = niceStep((max - min) / 4);
  const rows: number[] = [];
  for (let v = Math.ceil(min / step) * step; v < max; v += step) rows.push(v);
  // Drop any axis label the OPEN or price pill would sit on top of — a collision
  // there makes the gutter unreadable exactly where it matters most.
  const clear = (v: number) => Math.abs(t(v) - t(strike)) > 0.06 && Math.abs(t(v) - t(price)) > 0.06;

  return (
    <Frame tint={above ? "up" : "down"}>
      {/* the plot, stopping short of the gutter */}
      <div className="absolute inset-y-0 left-0" style={{ right: GUTTER }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colour} stopOpacity="0.3" />
              <stop offset="100%" stopColor={colour} stopOpacity="0.02" />
            </linearGradient>
            <filter id="lc-bloom" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {rows.map((v) => (
            <line
              key={v}
              x1="0"
              x2={W}
              y1={y(v)}
              y2={y(v)}
              stroke="#ffffff"
              strokeOpacity="0.045"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={area} fill="url(#lc-fill)" />

          {/* the open — everything on screen is relative to this */}
          <line
            x1="0"
            x2={W}
            y1={strikeY}
            y2={strikeY}
            stroke="var(--gold)"
            strokeWidth="1.5"
            strokeDasharray="6 6"
            opacity="0.8"
            vectorEffect="non-scaling-stroke"
          />

          <path
            d={line}
            fill="none"
            stroke={colour}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            filter="url(#lc-bloom)"
            vectorEffect="non-scaling-stroke"
          />

          <circle cx={headX} cy={headY} r="14" fill={colour} opacity="0.2">
            <animate attributeName="r" values="8;20;8" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.32;0.03;0.32" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <circle cx={headX} cy={headY} r="5" fill={colour} filter="url(#lc-bloom)" />
        </svg>
      </div>

      {/* price gutter — HTML, so type stays crisp under a stretched viewBox */}
      <div className="absolute inset-y-0 right-0" style={{ width: GUTTER }}>
        {rows.filter(clear).map((v) => (
          <div
            key={v}
            className="tabular absolute right-2 -translate-y-1/2 text-[10px] font-semibold text-[var(--dim)]"
            style={{ top: `${t(v) * 100}%` }}
          >
            {v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        ))}

        {/* the open, labelled where a trader expects to find it */}
        <div
          className="tabular absolute right-1 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-black"
          style={{
            top: `${t(strike) * 100}%`,
            background: "#2a220c",
            color: "var(--gold)",
            boxShadow: "0 0 18px var(--gold-glow)",
          }}
        >
          OPEN
        </div>

        {/* the live price, riding the head of the tape */}
        <div
          className="display tabular absolute right-1 -translate-y-1/2 rounded px-1.5 py-1 text-[11px] text-black"
          style={{
            top: `${t(price) * 100}%`,
            background: colour,
            boxShadow: `0 0 22px ${colour}`,
          }}
        >
          {price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      </div>

      {/* whose half of the board is whose */}
      <div
        className="pointer-events-none absolute text-base leading-none glow-up"
        style={{ right: GUTTER + 4, top: `${Math.max(t(strike) * 100 - 24, 5)}%` }}
      >
        ▲
      </div>
      <div
        className="pointer-events-none absolute text-base leading-none glow-down"
        style={{ right: GUTTER + 4, top: `${Math.min(t(strike) * 100 + 16, 88)}%` }}
      >
        ▼
      </div>

      {/* corner furniture */}
      <div className="pointer-events-none absolute inset-0 p-4" style={{ paddingRight: GUTTER + 8 }}>
        <div className="flex items-start justify-between gap-6">
          <div className="hidden items-center gap-2 sm:flex">
            <span className="rounded bg-[#ffffff0a] px-2 py-1 text-[9px] font-black tracking-[0.2em] text-[var(--dim)]">
              BTC · 1M
            </span>
            {roundIndex !== null && (
              <span className="rounded bg-[#ffffff0a] px-2 py-1 text-[9px] font-black tracking-[0.2em] text-[var(--dim)]">
                ROUND {roundIndex}
              </span>
            )}
          </div>
          <div className="min-w-0 text-right">
            <p
              className="display tabular truncate text-xl leading-none sm:text-4xl"
              style={{ color: colour, textShadow: `0 0 44px ${colour}66` }}
            >
              {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* The delta lives at the foot, where the strike line can never reach it. */}
        <div className="absolute inset-x-4 bottom-4 flex items-end justify-end" style={{ right: GUTTER + 8 }}>
          <p className="tabular whitespace-nowrap text-[11px] font-black sm:text-sm" style={{ color: colour }}>
            {delta >= 0 ? "▲ +" : "▼ "}
            {delta.toFixed(2)}
            <span className="ml-2 hidden text-[10px] tracking-[0.2em] opacity-75 sm:inline">
              {above ? "UP IS WINNING" : "DOWN IS WINNING"}
            </span>
          </p>
        </div>
      </div>

      {/* time, draining */}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-[#ffffff0a]">
        <div
          className="h-full transition-[width] duration-1000 ease-linear"
          style={{
            width: `${Math.max(0, Math.min(100, (secondsLeft / 60) * 100))}%`,
            background: secondsLeft < 10 ? "var(--down)" : "var(--gold)",
            boxShadow: `0 0 16px ${secondsLeft < 10 ? "var(--down)" : "var(--gold)"}`,
          }}
        />
      </div>
    </Frame>
  );
}

/**
 * The bevelled housing. This is what stops the chart reading as a div: a raised
 * outer rail, a dark inset well, and an edge that takes the colour of whoever
 * is currently winning.
 */
function Frame({ children, tint }: { children: React.ReactNode; tint?: "up" | "down" }) {
  const edge = tint === "up" ? "#123a26" : tint === "down" ? "#3d1220" : "#242a36";
  return (
    <div
      className="rounded-2xl p-[10px]"
      style={{
        background: "linear-gradient(180deg, #23293a, #12151d 55%, #1b1f2b)",
        boxShadow: "0 18px 46px -22px #000, inset 0 1px 0 #ffffff14, inset 0 -1px 0 #00000080",
      }}
    >
      <div
        className="relative h-[200px] overflow-hidden rounded-xl border sm:h-[300px]"
        style={{
          borderColor: edge,
          background: "radial-gradient(120% 80% at 50% 0%, #0d1117 0%, #06080c 100%)",
          boxShadow: "inset 0 2px 18px #000000cc",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** 1 / 2 / 5 × 10ⁿ — the only intervals a price axis is allowed to use. */
function niceStep(raw: number) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const n = raw / mag;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag;
}
