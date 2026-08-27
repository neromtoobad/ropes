"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { TableState } from "@/lib/state";

/**
 * THE CLIMB.
 *
 * The wall replaces the chart. A climber's height is what their position is
 * worth as a multiple of what they paid — so everyone starts level at the
 * break-even ledge and separates from there, and a contrarian entry climbs
 * faster because that is literally what the payout does. No speed is invented.
 *
 * The mapping was measured on four live rounds, not guessed (see CLIMB.md):
 * a log scale through tanh, so a doubling and a halving are equal distances and
 * a position entered near certainty cannot send a climber off the top.
 */

/** Measured on real rounds. 1.0 left small climbs invisible; 2.6 clipped the
 *  dramatic ones. 1.8 is the last gain before the good rounds start pinning. */
const CURVE_GAIN = 1.8;

/** Below this a climber is scrabbling at the floor rather than climbing. */
const HANGING = 0.1;

export function heightFor(entry: number | null, live: number | null) {
  if (!entry || !live || entry <= 0 || live <= 0) return 0.5;
  return 0.5 + 0.5 * Math.tanh(CURVE_GAIN * Math.log(live / entry));
}

type Pose = "climb" | "slip" | "leap" | "fall" | "cheer";

/** Which climber art each seat wears. Cut from the Higgsfield pose sheets. */
const CAST = ["green", "red", "gold", "blue", "violet", "orange", "teal", "pink"] as const;

export function Cliff({
  seats,
  price,
  secondsLeft,
  myRunId,
  falling,
  leaping,
  btc,
}: {
  seats: TableState["seats"];
  price: TableState["price"];
  secondsLeft: number;
  myRunId: string | null;
  /** Names the bell just eliminated — they let go of the wall. */
  falling: string[];
  /** Names that just bailed. They leap clear rather than fall. */
  leaping: string[];
  /** BTC against the line, shown on the wall now the chart is gone. */
  btc: TableState["btc"];
}) {
  // Direction of travel decides the pose, so the previous height has to persist
  // across renders. A climber that is rising climbs; one that is losing ground
  // slips; near the floor it hangs on.
  const previous = useRef<Map<string, number>>(new Map());
  const [, force] = useState(0);
  useEffect(() => {
    // Repaint on a timer so a climber keeps animating even when the poll
    // returns an identical price — a still sprite reads as a broken game.
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const climbers = seats.map((seat, i) => {
    const live = seat.pick === "UP" ? price.up : seat.pick === "DOWN" ? price.down : null;
    const height = seat.inRound ? heightFor(seat.fillPrice, live) : 0.5;
    // What the position is actually worth, as a multiple of what was paid.
    // The wall's height is a log-squashed VIEW of this; it is not the number.
    const multiple = seat.inRound && seat.fillPrice && live ? live / seat.fillPrice : null;
    const was = previous.current.get(seat.runId) ?? height;
    previous.current.set(seat.runId, height);

    const rising = height > was + 0.004;
    const sinking = height < was - 0.004;
    const dead = falling.includes(seat.name);
    const bailed = leaping.includes(seat.name);

    // A bail beats everything else: it is the one pose the player chose.
    const pose: Pose = bailed
      ? "leap"
      : dead
        ? "fall"
        : height > 0.93
          ? "cheer"
          : height < HANGING || sinking
            ? "slip"
            : "climb";

    return {
      seat,
      height,
      multiple,
      pose,
      dead,
      bailed,
      rising,
      sinking,
      art: CAST[i % CAST.length],
      mine: seat.runId === myRunId,
    };
  });

  const urgent = secondsLeft > 0 && secondsLeft < 10;

  return (
    <div
      className="relative overflow-hidden rounded-2xl border"
      style={{
        height: 520,
        borderColor: urgent ? "#3d1220" : "var(--edge)",
        background:
          "linear-gradient(180deg, #171528 0%, #100e1c 45%, #0a0812 100%)",
        boxShadow: "inset 0 2px 24px #000000cc",
      }}
    >
      {/* strata — gives the wall scale, and makes vertical motion legible */}
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="pointer-events-none absolute inset-x-0"
          style={{
            bottom: `${(i + 1) * 10}%`,
            height: 1,
            background: "#ffffff",
            opacity: i === 4 ? 0 : 0.03,
          }}
        />
      ))}

      {/* the break-even ledge. everyone starts here; above is profit */}
      <div className="pointer-events-none absolute inset-x-0" style={{ bottom: "50%" }}>
        <div
          className="h-[2px] w-full"
          style={{
            background:
              "repeating-linear-gradient(90deg, var(--gold) 0 10px, transparent 10px 20px)",
            opacity: 0.7,
            boxShadow: "0 0 14px var(--gold-glow)",
          }}
        />
        <span className="absolute left-3 -top-4 text-[9px] font-black tracking-[0.25em] glow-gold">
          BREAK EVEN
        </span>
      </div>

      {climbers.map(({ seat, height, multiple, pose, dead, bailed, art, mine }, i) => {
        const lane = climbers.length === 1 ? 50 : 8 + (i * 84) / Math.max(climbers.length - 1, 1);
        return (
          <div
            key={seat.runId}
            className="absolute flex flex-col items-center"
            style={{
              left: `${lane}%`,
              // 3..73% rather than the full wall: a climber at the very top
              // would push its own name label out through the frame.
              bottom: bailed ? "115%" : dead ? "-22%" : `${3 + height * 70}%`,
              transform: bailed ? "translateX(-50%) translateX(70px)" : "translateX(-50%)",
              opacity: bailed ? 0 : 1,
              // A bail leaves fast and upward; a fall is slower and downward.
              // If they share a curve the two outcomes read identically.
              transition: bailed
                ? "bottom 700ms cubic-bezier(0.2, 0.9, 0.3, 1), transform 700ms ease-out, opacity 700ms ease-in 300ms"
                : "bottom 900ms cubic-bezier(0.33, 0.9, 0.4, 1)",
              zIndex: mine ? 20 : 10,
            }}
          >
            <div
              className="tabular mb-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-black"
              style={{
                background: mine ? "var(--gold)" : "#00000099",
                color: mine ? "#000" : "var(--text)",
              }}
            >
              {seat.name} {multiple !== null ? `${multiple.toFixed(2)}×` : ""}
            </div>
            <Image
              src={`/climbers/${art}/${pose}.png`}
              alt=""
              width={64}
              height={96}
              className="h-[76px] w-auto sm:h-[104px]"
              style={{
                filter: mine ? "drop-shadow(0 0 14px var(--gold-glow))" : "none",
                transform: pose === "slip" ? "scaleX(-1)" : undefined,
              }}
              priority
              unoptimized
            />
          </div>
        );
      })}

      {climbers.length === 0 && (
        // Sits high on the wall: centred, it lands exactly on the break-even
        // line and the two strings overprint each other.
        <div className="absolute inset-x-0 top-[22%] text-center text-[10px] tracking-[0.3em] text-[var(--dim)]">
          NOBODY ON THE WALL
        </div>
      )}

      {/* BTC against the line. The chart no longer sits below the wall, so the
          number that decides everyone's fate has to be on the wall itself. */}
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

      {/* time, draining */}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-[#ffffff0a]">
        <div
          className="h-full transition-[width] duration-1000 ease-linear"
          style={{
            width: `${Math.max(0, Math.min(100, (secondsLeft / 60) * 100))}%`,
            background: urgent ? "var(--down)" : "var(--gold)",
            boxShadow: `0 0 16px ${urgent ? "var(--down)" : "var(--gold)"}`,
          }}
        />
      </div>
    </div>
  );
}
