"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { TableState } from "@/lib/state";

/**
 * THE CLIMB — solo.
 *
 * One climber, and the camera follows THEM: the character holds the middle of
 * the screen and the wall scrolls past. Nothing sells climbing like the world
 * moving under you — a fixed wall with a moving dot reads as a chart wearing a
 * costume, which is exactly what this replaced.
 *
 * Height is the run's CUMULATIVE multiple (free cash plus the live-marked
 * position, over the seat price), pushed through the same measured tanh curve
 * as ever, so a doubling and a halving are equal distances of wall.
 *
 * The wall itself is annotated with milestone ledges at fixed multiples.
 * Because the camera moves and they don't, you climb PAST them — each one is a
 * discrete, chime-worthy event, which is what a lone climber has instead of
 * overtaking.
 */

/** Measured on real rounds — see CLIMB.md. Do not retune by eye. */
const CURVE_GAIN = 1.8;

/**
 * The run's live cumulative multiple: free cash plus the position marked to the
 * live book, over the seat price. THE number — the wall, the bail bar and the
 * altitude readout must all say the same thing, so they all call this.
 */
export function liveMultipleOf(
  seat: TableState["seats"][number] | null | undefined,
  price: TableState["price"],
) {
  if (!seat || seat.buyIn <= 0) return 1;
  const live = seat.pick === "UP" ? price.up : seat.pick === "DOWN" ? price.down : null;
  const positionLive =
    seat.inRound && seat.fillPrice && live
      ? seat.costInRound * (live / seat.fillPrice)
      : seat.costInRound;
  return (seat.stack - seat.costInRound + positionLive) / seat.buyIn;
}

export function heightOfMultiple(m: number) {
  if (m <= 0) return 0;
  return 0.5 + 0.5 * Math.tanh(CURVE_GAIN * Math.log(m));
}

/** % of viewport height per unit of curve-space. Bigger = faster-feeling wall. */
const SPREAD = 190;

/** The ledges carved into the wall, as multiples of the seat price. */
const MILESTONES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5, 8, 12, 20];

/** Below this the climber is barely holding on. */
const HANGING = 0.35;

type Pose = "climb" | "slip" | "leap" | "fall" | "cheer";

const CAST = ["green", "red", "gold", "blue", "violet", "orange", "teal", "pink"] as const;

export function Cliff({
  seats,
  price,
  secondsLeft,
  myRunId,
  falling,
  leaping,
  btc,
  record,
  onMilestone,
}: {
  seats: TableState["seats"];
  price: TableState["price"];
  secondsLeft: number;
  myRunId: string | null;
  falling: string[];
  leaping: string[];
  btc: TableState["btc"];
  record: TableState["wallRecord"];
  /** Fired when the climber crosses a milestone ledge going UP. */
  onMilestone?: (multiple: number) => void;
}) {
  // The climber: the viewer's run, or whoever is on the wall when spectating.
  const seat = seats.find((s) => s.runId === myRunId) ?? seats[0] ?? null;

  const multiple = liveMultipleOf(seat, price);
  const meH = heightOfMultiple(multiple);

  // Direction of travel picks the pose; a repaint timer keeps it alive between
  // identical polls.
  const prev = useRef(meH);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const rising = meH > prev.current + 0.002;
  const sinking = meH < prev.current - 0.002;
  useEffect(() => {
    prev.current = meH;
  });

  // Milestone crossings, upward only. The chime belongs to gains.
  const lastMult = useRef(multiple);
  useEffect(() => {
    const was = lastMult.current;
    lastMult.current = multiple;
    if (!seat?.inRound) return;
    for (const m of MILESTONES) {
      if (m > 1 && was < m && multiple >= m) onMilestone?.(m);
    }
  }, [multiple, seat?.inRound, onMilestone]);

  const dead = seat ? falling.includes(seat.name) : false;
  const bailed = seat ? leaping.includes(seat.name) : false;
  const hanging = multiple < HANGING && (seat?.inRound ?? false);

  const pose: Pose = bailed
    ? "leap"
    : dead
      ? "fall"
      : hanging || sinking
        ? "slip"
        : rising
          ? "climb"
          : "climb";

  const art = CAST[0];
  const finale = secondsLeft > 0 && secondsLeft <= 5 && (seat?.inRound ?? false);
  const urgent = secondsLeft > 0 && secondsLeft < 10;

  /** A wall feature at height h, in viewport terms. The camera does the work. */
  const bottomOf = (h: number) => 50 + (h - meH) * SPREAD;
  const visible = (b: number) => b > -10 && b < 112;

  const myBest = seat?.best ?? null;
  const bestBeaten = myBest !== null && multiple > myBest;

  return (
    <div
      className="relative overflow-hidden rounded-2xl border"
      style={{
        height: 520,
        borderColor: urgent ? "#3d1220" : "var(--edge)",
        background:
          hanging && !dead
            ? "linear-gradient(180deg, #1c0f1c 0%, #120a14 50%, #0a0812 100%)"
            : "linear-gradient(180deg, #171528 0%, #100e1c 45%, #0a0812 100%)",
        boxShadow: "inset 0 2px 24px #000000cc",
        transition: "background 900ms",
      }}
    >
      {/* the stage: everything that zooms in the finale */}
      <div
        className="absolute inset-0"
        style={{
          transform: finale ? "scale(1.25)" : "scale(1)",
          transformOrigin: "50% 50%",
          transition: "transform 1600ms cubic-bezier(0.25, 0.8, 0.25, 1)",
        }}
      >
        {/* milestone ledges — fixed on the wall, so the camera slides them past */}
        {MILESTONES.map((m) => {
          const b = bottomOf(heightOfMultiple(m));
          if (!visible(b)) return null;
          const isEven = m === 1;
          return (
            <div
              key={m}
              className="pointer-events-none absolute inset-x-0"
              style={{ bottom: `${b}%`, transition: "bottom 900ms cubic-bezier(0.33, 0.9, 0.4, 1)" }}
            >
              <div
                className="h-[2px] w-full"
                style={{
                  background: isEven
                    ? "repeating-linear-gradient(90deg, var(--gold) 0 10px, transparent 10px 20px)"
                    : "repeating-linear-gradient(90deg, #ffffff 0 6px, transparent 6px 16px)",
                  opacity: isEven ? 0.7 : m > 1 ? 0.16 : 0.1,
                  boxShadow: isEven ? "0 0 14px var(--gold-glow)" : "none",
                }}
              />
              <span
                className={`tabular absolute right-3 -top-4 text-[9px] font-black tracking-[0.2em] ${
                  isEven ? "glow-gold" : "text-[var(--dim)]"
                }`}
                style={{ opacity: isEven ? 1 : 0.75 }}
              >
                {isEven ? "BREAK EVEN" : `${m}×`}
              </span>
            </div>
          );
        })}

        {/* the all-time record — a flag planted in the wall */}
        {record &&
          record.multiple > 1 &&
          visible(bottomOf(heightOfMultiple(record.multiple))) && (
            <div
              className="pointer-events-none absolute inset-x-0"
              style={{
                bottom: `${bottomOf(heightOfMultiple(record.multiple))}%`,
                transition: "bottom 900ms cubic-bezier(0.33, 0.9, 0.4, 1)",
              }}
            >
              <div
                className="h-px w-full"
                style={{
                  background:
                    "repeating-linear-gradient(90deg, var(--gold) 0 4px, transparent 4px 12px)",
                  opacity: 0.55,
                }}
              />
              <span className="absolute left-3 -top-4 text-[9px] font-black tracking-[0.2em] text-[var(--gold)] opacity-90">
                ⚑ {record.name.toUpperCase()} · {record.multiple.toFixed(2)}×
              </span>
            </div>
          )}

        {/* your own best — brightens the moment you pass it */}
        {myBest !== null && myBest > 1 && visible(bottomOf(heightOfMultiple(myBest))) && (
          <div
            className="pointer-events-none absolute inset-x-0"
            style={{
              bottom: `${bottomOf(heightOfMultiple(myBest))}%`,
              transition: "bottom 900ms cubic-bezier(0.33, 0.9, 0.4, 1)",
            }}
          >
            <div
              className="h-px w-full"
              style={{
                background:
                  "repeating-linear-gradient(90deg, var(--text) 0 4px, transparent 4px 12px)",
                opacity: bestBeaten ? 0.7 : 0.22,
                boxShadow: bestBeaten ? "0 0 12px var(--gold-glow)" : "none",
              }}
            />
            <span
              className="absolute left-3 -top-4 text-[9px] font-black tracking-[0.2em]"
              style={{ color: bestBeaten ? "var(--gold)" : "var(--dim)" }}
            >
              {bestBeaten ? "★ NEW BEST" : `YOUR BEST · ${myBest.toFixed(2)}×`}
            </span>
          </div>
        )}

        {/* the climber — pinned to the middle while the world moves */}
        {seat && (
          <div
            className="absolute left-1/2 flex flex-col items-center"
            style={{
              bottom: bailed ? "118%" : dead ? "-30%" : "calc(50% - 58px)",
              transform: bailed
                ? "translateX(-50%) translateX(90px)"
                : "translateX(-50%)",
              opacity: bailed ? 0 : 1,
              transition: bailed
                ? "bottom 700ms cubic-bezier(0.2, 0.9, 0.3, 1), transform 700ms ease-out, opacity 700ms ease-in 300ms"
                : dead
                  ? "bottom 1100ms cubic-bezier(0.5, 0, 0.9, 0.4)"
                  : "none",
              zIndex: 20,
            }}
          >
            <div
              className="tabular mb-1 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-black"
              style={{ background: "var(--gold)", color: "#000" }}
            >
              {seat.name} {multiple.toFixed(2)}×
            </div>
            <Image
              src={`/climbers/${art}/${pose}.png`}
              alt=""
              width={96}
              height={140}
              priority
              unoptimized
              className={`h-[110px] w-auto sm:h-[140px] ${hanging && !dead && !bailed ? "hanging" : ""}`}
              style={{
                filter: "drop-shadow(0 0 16px var(--gold-glow))",
                transform: pose === "slip" ? "scaleX(-1)" : undefined,
              }}
            />
            {seat.inRound && !dead && !bailed && (
              <span
                className="mt-1 text-[9px] font-black tracking-[0.25em]"
                style={{ color: hanging ? "var(--down)" : "var(--dim)" }}
              >
                {hanging ? "HANGING ON" : seat.pick === "UP" ? "▲ RIDING UP" : "▼ RIDING DOWN"}
              </span>
            )}
            {seat && !seat.inRound && !dead && !bailed && (
              <span className="mt-1 text-[9px] font-black tracking-[0.25em] text-[var(--dim)]">
                WAITING FOR THE ROUND
              </span>
            )}
          </div>
        )}
      </div>

      {!seat && (
        <div className="absolute inset-x-0 top-[22%] text-center text-[10px] tracking-[0.3em] text-[var(--dim)]">
          NOBODY ON THE WALL — TAKE A SEAT
        </div>
      )}

      {/* BTC against the line — the market that moves the wall */}
      {btc.price !== null && btc.strike !== null && (
        <div className="pointer-events-none absolute right-4 top-3 text-right">
          <p
            className="display tabular text-2xl leading-none sm:text-3xl"
            style={{
              color: btc.price >= btc.strike ? "var(--up)" : "var(--down)",
              textShadow: `0 0 36px ${btc.price >= btc.strike ? "var(--up-glow)" : "var(--down-glow)"}`,
            }}
          >
            {btc.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <p
            className="tabular text-[10px] font-black tracking-widest"
            style={{ color: btc.price >= btc.strike ? "var(--up)" : "var(--down)" }}
          >
            {btc.price >= btc.strike ? "▲ +" : "▼ "}
            {(btc.price - btc.strike).toFixed(2)}
          </p>
          <p className="tabular mt-0.5 text-[9px] font-bold tracking-widest text-[var(--dim)]">
            TO BEAT {btc.strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
      )}

      {/* altitude, top-left: how high the run has actually climbed */}
      {seat && (
        <div className="pointer-events-none absolute left-4 top-3">
          <p className="text-[9px] font-black tracking-[0.25em] text-[var(--dim)]">ALTITUDE</p>
          <p className="display tabular text-2xl leading-none glow-gold sm:text-3xl">
            {multiple.toFixed(2)}×
          </p>
        </div>
      )}

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
    </div>
  );
}
