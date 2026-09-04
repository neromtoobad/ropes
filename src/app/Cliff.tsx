"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { TableState } from "@/lib/state";
import { useSmoothed } from "./useSmoothed";

/**
 * ROPES — solo.
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

/**
 * Screen-space height is the pure log of the multiple.
 *
 * The old tanh curve (measured for per-round motion near 1×) SATURATED on
 * cumulative multiples: at 3× a 10% move slid the wall fifteen times less
 * than at 1× — the game went visually still exactly when the stakes were
 * highest. Log mapping makes equal RELATIVE moves equal screen distance at
 * every altitude: a 1% tick is always ~6px, a double is always most of a
 * screen, whether it is your first round or your fifth.
 */
export function heightOfMultiple(m: number) {
  return Math.log(Math.max(m, 0.05));
}

/** % of viewport height per ln-unit. 120 ⇒ a +10% move ≈ 12% of the wall. */
const SPREAD = 120;

/** The ledges carved into the wall, as multiples of the seat price. */
const MILESTONES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5, 8, 12, 20];

/** Below this the climber is barely holding on. */
const HANGING = 0.35;

type Pose = "climb" | "slip" | "leap" | "fall" | "cheer";

export const CAST = [
  { id: "green", code: "VRD-01", label: "VERDANT" },
  { id: "red", code: "CRM-02", label: "CRIMSON" },
  { id: "gold", code: "AUR-03", label: "AURUM" },
  { id: "blue", code: "AZR-04", label: "AZURE" },
  { id: "violet", code: "VLT-05", label: "VESPER" },
  { id: "orange", code: "EMB-06", label: "EMBER" },
  { id: "teal", code: "TDL-07", label: "TIDAL" },
  { id: "pink", code: "NEO-08", label: "NEON" },
] as const;
export type ClimberId = (typeof CAST)[number]["id"];

/** Who has a cut 6-frame climb cycle in public/climbers/<id>/cycle/. */
const CYCLE_READY = new Set<ClimberId>([
  "green", "red", "gold", "blue", "violet", "orange", "teal", "pink",
]);

export function Cliff({
  seats,
  price,
  secondsLeft,
  intervalSec,
  myRunId,
  falling,
  leaping,
  bells,
  btc,
  record,
  climber,
  onMilestone,
}: {
  seats: TableState["seats"];
  price: TableState["price"];
  secondsLeft: number;
  /** The window's full length, so the drain bar empties over the real round. */
  intervalSec: number;
  myRunId: string | null;
  /** Run ids mid-death-fall / mid-bail-leap. Ids, not names — names collide. */
  falling: string[];
  leaping: string[];
  /** The last settled windows, oldest → newest — the wall's own memory. */
  bells: TableState["bells"];
  btc: TableState["btc"];
  record: TableState["wallRecord"];
  /** Which of the eight climbers the player chose in the rail. */
  climber: ClimberId;
  /** Fired when the climber crosses a milestone ledge going UP. */
  onMilestone?: (multiple: number) => void;
}) {
  // YOUR run or nobody. The old `?? seats[0]` fallback put a stranger's climber
  // — their name, their altitude, their money — on the wall of anyone who had
  // not joined yet, which reads as your own session and is not.
  const seat = seats.find((s) => s.runId === myRunId) ?? null;

  // The live mark: the tag, the altitude readout and BAIL all say this.
  const multiple = useSmoothed(liveMultipleOf(seat, price), 340, 3);
  // The camera anchors to the SETTLED stack, not the live mark. When it
  // chased the live value, a DOWN bettor watching BTC fall saw the ledges
  // slide down ("climbing") while the body dropped — two motions saying
  // opposite things. During the ride the only thing that moves the climber
  // is bitcoin itself; the bell glides the anchor to the new altitude.
  const anchorTarget = seat && seat.buyIn > 0 ? seat.stack / seat.buyIn : 1;
  const anchor = useSmoothed(anchorTarget, 340, 3);
  const meH = heightOfMultiple(anchor);

  // BTC's last move, held for a beat so a tick reads as motion, not a blink.
  // The feed repeats the same number across polls (see the chart gotcha), so
  // direction only updates on an actual change.
  const btcRef = useRef<{ last: number | null; dir: number; at: number }>({
    last: null,
    dir: 0,
    at: 0,
  });
  if (btc.price !== null) {
    const b = btcRef.current;
    if (b.last !== null && btc.price !== b.last) {
      b.dir = Math.sign(btc.price - b.last);
      b.at = Date.now();
    }
    b.last = btc.price;
  }
  const btcDir = Date.now() - btcRef.current.at < 3000 ? btcRef.current.dir : 0;

  // Every BTC tick lands in the body: a reach up on an up-tick, a sag on a
  // down-tick — RAW, never inverted. The character IS bitcoin; a DOWN bettor
  // wants to watch their climber dive. A nudge is cosmetic lean, never
  // altitude — the tag and BAIL don't move.
  const [nudge, setNudge] = useState(0);
  useEffect(() => {
    if (btc.price === null || btcRef.current.dir === 0) return;
    setNudge(-btcRef.current.dir * 12);
    const t = setTimeout(() => setNudge(0), 380);
    return () => clearTimeout(t);
    // Keyed on the price on purpose: a repeated value is not a tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btc.price]);

  /**
   * In-round, the climber's position on screen IS bitcoin against the line:
   * center = the strike, above = UP winning, below = DOWN winning. A DOWN
   * bettor cheers the dive. Money never leaves the numbers — tag, altitude
   * and BAIL keep the honest mark — but the BODY belongs to BTC.
   *
   * The cumulative altitude (ledges, records) is the camera's anchor; the
   * bell settles the round and the anchor glides to the new height.
   */
  const OFFSET_PER_POINT = 1.1; // % of wall per BTC point off the strike
  const MAX_OFFSET = 34;
  const rawOffset =
    seat?.inRound && btc.price !== null && btc.strike !== null
      ? Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, (btc.price - btc.strike) * OFFSET_PER_POINT))
      : 0;
  const offset = useSmoothed(rawOffset, 300, 200);

  // Direction of travel, in screen truth: the BTC offset while it moves, the
  // anchor glide while it settles, the last tick when both are quiet.
  const glideUp = heightOfMultiple(anchorTarget) > meH + 0.0015;
  const glideDown = heightOfMultiple(anchorTarget) < meH - 0.0015;
  const offUp = rawOffset > offset + 0.4;
  const offDown = rawOffset < offset - 0.4;
  const rising = offUp || (!offDown && glideUp) || (!offDown && !glideDown && btcDir > 0);
  const sinking = offDown || (!offUp && glideDown) || (!offUp && !glideUp && btcDir < 0);

  // Milestone crossings, upward only. The chime belongs to gains.
  const lastMult = useRef(anchor);
  useEffect(() => {
    const was = lastMult.current;
    lastMult.current = anchor;
    if (!seat) return;
    for (const m of MILESTONES) {
      if (m > 1 && was < m && anchor >= m) onMilestone?.(m);
    }
  }, [anchor, seat, onMilestone]);

  const dead = seat ? falling.includes(seat.runId) : false;
  const bailed = seat ? leaping.includes(seat.runId) : false;
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

  // How the hands work the rope. Off the rope entirely when falling or leaping.
  const grip =
    dead || bailed
      ? ""
      : hanging
        ? "hanging"
        : rising
          ? "climbing"
          : sinking
            ? "sliding"
            : "dangling";

  const art = climber;
  const cast = CAST.find((c) => c.id === climber) ?? CAST[0];

  // On the rope = showing a cycle frame (the rope is baked into them).
  // Off the rope (falling, leaping) = the pose sprites, which have none.
  const hasCycle = CYCLE_READY.has(art);
  const onRope = hasCycle && !dead && !bailed;
  const [frame, setFrame] = useState(0);
  const cycleActive = onRope && !hanging && (rising || sinking);
  useEffect(() => {
    if (!cycleActive) return;
    // Rising plays the cycle forward, sinking plays it backward (hand under
    // hand). The slide is slower — losing ground drags.
    const ms = rising ? 130 : 190;
    const id = setInterval(() => setFrame((f) => (f + (rising ? 1 : 5)) % 6), ms);
    return () => clearInterval(id);
  }, [cycleActive, rising]);
  useEffect(() => {
    if (!hasCycle) return;
    for (let i = 0; i < 6; i++) {
      const im = new window.Image();
      im.src = `/climbers/${art}/cycle/${i}.webp`;
    }
  }, [hasCycle, art]);
  const finale = secondsLeft > 0 && secondsLeft <= 5 && (seat?.inRound ?? false);
  const urgent = secondsLeft > 0 && secondsLeft < 10;

  /** A wall feature at height h, in viewport terms. The camera does the work. */
  const bottomOf = (h: number) => 50 + (h - meH) * SPREAD;
  const visible = (b: number) => b > -10 && b < 112;

  const myBest = seat?.best ?? null;
  const bestBeaten = myBest !== null && multiple > myBest;

  // How deep into space the run has climbed: 0 at break-even, 1 at 12×.
  const spaceT = Math.max(0, Math.min(1, Math.log(Math.max(anchor, 1)) / Math.log(12)));

  // On lg the wall fills its wrapper EXACTLY — the height floor lives on the
  // wrapper in play/page.tsx. A min-height here made the wall taller than its
  // flex slot on short viewports, sliding it under the phase strip with the
  // nameplate floating on top.
  return (
    <div
      className="ticks relative h-[min(520px,52dvh)] min-h-[300px] overflow-hidden rounded-2xl border lg:h-full lg:min-h-0"
      style={{
        borderColor: urgent ? "#3d1220" : "var(--edge)",
        background:
          hanging && !dead
            ? "linear-gradient(180deg, #251029 0%, #150b1a 50%, #0b0814 100%)"
            : "linear-gradient(180deg, #1c1738 0%, #131028 45%, #0b0917 100%)",
        boxShadow: "inset 0 2px 24px #000000cc",
        transition: "background 900ms",
      }}
    >
      {/* the sky: two star layers parallaxing with altitude (near moves
          faster than far — depth you can feel every time you climb) and
          nebulas breathing in the corners. This is what makes the wall a
          PLACE instead of a panel.

          And the sky REACTS to altitude: spaceT runs 0 at break-even to 1
          at 12× — the higher the run, the deeper into space it climbs.
          The wall darkens toward void, stars sharpen, nebulas bloom, and
          the neon ground fades away far below. Altitude you can feel. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg, #040210 0%, #0b0426 60%, #0d0620 100%)",
            opacity: spaceT * 0.8,
          }}
        />
        <div
          className="stars-far absolute inset-0"
          style={{
            backgroundPositionY: `${meH * SPREAD * 1.6}px`,
            opacity: 0.55 + 0.45 * spaceT,
          }}
        />
        <div
          className="stars-near absolute inset-0"
          style={{
            backgroundPositionY: `${meH * SPREAD * 3.4}px`,
            opacity: 0.6 + 0.4 * spaceT,
          }}
        />
        <div className="absolute inset-0" style={{ opacity: 0.7 + 0.3 * spaceT }}>
          <div className="nebula absolute inset-0" />
        </div>
        <div
          className="grid-floor absolute inset-x-[-15%] bottom-0 h-[42%]"
          style={{ opacity: 1 - spaceT * 0.85 }}
        />
      </div>

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
              style={{ bottom: `${b}%` }}
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
              {/* The BTC readout owns the top-right corner; a ledge label that
                  drifts up there would print straight through it. */}
              {b < 78 && (
                <span
                  className={`tabular absolute right-3 -top-4 text-[9px] font-black tracking-[0.2em] ${
                    isEven ? "glow-gold" : "text-[var(--dim)]"
                  }`}
                  style={{ opacity: isEven ? 1 : 0.75 }}
                >
                  {isEven ? "BREAK EVEN" : `${m}×`}
                </span>
              )}
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

        {/* the rope above: THE ACTUAL ROPE. A tile cut from this character's
            own frames (scripts/ropealign.ts) repeats from above the summit
            down into the grip — same pixels, same twist, and the frames are
            re-centered on the rope so the strand never jumps sideways. It
            tucks into the sprite so the join hides behind the body. */}
        {seat && !dead && !bailed && (
          <div
            className="pointer-events-none absolute left-1/2 z-10 w-[8px] -translate-x-1/2"
            style={{
              top: "-5%",
              bottom: `calc(${50 + offset}% + 82px)`,
              backgroundImage: `url(/climbers/${art}/rope.webp)`,
              backgroundRepeat: "repeat-y",
              backgroundSize: "100% auto",
            }}
          />
        )}

        {/* the climber — pinned to the middle while the world moves. The rope
            lives INSIDE the cycle frames now: every character carries their
            own strand, so there is no separate background rope to disagree
            with the grip. */}
        {seat && (
          <div
            className="absolute left-1/2 flex flex-col items-center"
            style={{
              bottom: bailed ? "118%" : dead ? "-30%" : `calc(${50 + offset}% - 58px)`,
              transform: bailed
                ? "translateX(-50%) translateX(90px)"
                : `translateX(-50%) translateY(${dead ? 0 : nudge}px)`,
              opacity: bailed ? 0 : 1,
              transition: bailed
                ? "bottom 700ms cubic-bezier(0.2, 0.9, 0.3, 1), transform 700ms ease-out, opacity 700ms ease-in 300ms"
                : dead
                  ? "bottom 1100ms cubic-bezier(0.5, 0, 0.9, 0.4)"
                  : "transform 380ms cubic-bezier(0.34, 1.3, 0.5, 1)",
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
              src={onRope ? `/climbers/${art}/cycle/${frame}.webp` : `/climbers/${art}/${pose}.webp`}
              alt=""
              width={96}
              height={onRope ? 300 : 140}
              priority
              unoptimized
              // Cycle frames carry their own rope above and below the figure,
              // so they render taller to keep the CHARACTER the same size.
              // While moving, the frames ARE the animation; holding still
              // gets the dangle sway, barely-alive gets the scrabble.
              className={`w-auto ${onRope ? "h-[180px] sm:h-[225px]" : "h-[110px] sm:h-[140px]"} ${
                cycleActive ? "" : onRope ? (hanging ? "hanging" : "dangling") : grip
              }`}
              style={{
                filter: "drop-shadow(0 0 16px var(--gold-glow))",
                transform: !onRope && pose === "slip" ? "scaleX(-1)" : undefined,
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
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center">
          <Image
            src={`/climbers/${art}/cheer.webp`}
            alt=""
            width={96}
            height={140}
            priority
            unoptimized
            className="h-[110px] w-auto opacity-60 sm:h-[130px]"
            style={{ filter: "grayscale(0.4)" }}
          />
          <span className="mt-2 text-[10px] font-black tracking-[0.3em] text-[var(--dim)]">
            THE WALL IS WAITING — TAKE A SEAT
          </span>
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
            ${btc.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <p
            className="tabular text-[10px] font-black tracking-widest"
            style={{ color: btc.price >= btc.strike ? "var(--up)" : "var(--down)" }}
          >
            {btc.price >= btc.strike ? "▲ +$" : "▼ −$"}
            {Math.abs(btc.price - btc.strike).toFixed(2)}
          </p>
          <p className="tabular mt-0.5 text-[9px] font-bold tracking-widest text-[var(--dim)]">
            TO BEAT ${btc.strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
      )}

      {/* the wall remembers: how the last windows closed, oldest fading out
          on the left, the newest bell at full strength on the right */}
      {bells.length > 0 && (
        <div className="absolute inset-x-0 top-2 z-10 hidden justify-center gap-[5px] sm:flex">
          {bells.map((b, i) => (
            <span
              key={b.index}
              title={`RND ${b.index}${
                b.closedBy != null
                  ? ` · closed ${b.closedBy >= 0 ? "+$" : "−$"}${Math.abs(b.closedBy).toFixed(2)}`
                  : ""
              }${b.voided ? " · VOID — push" : ""}`}
              className="text-[10px] font-black leading-none"
              style={{
                color: b.voided ? "var(--dim)" : b.winner === "UP" ? "var(--up)" : "var(--down)",
                opacity: 0.4 + (0.6 * (i + 1)) / bells.length,
              }}
            >
              {b.voided ? "○" : b.winner === "UP" ? "▲" : "▼"}
            </span>
          ))}
        </div>
      )}

      {/* the nameplate — a character, not a cursor */}
      {seat && (
        <div className="pointer-events-none absolute bottom-5 left-4 z-10">
          <p className="text-[9px] font-black tracking-[0.35em] text-[var(--dim)]">{cast.code}</p>
          <p className="plate-name display text-3xl leading-none tracking-[0.06em] sm:text-5xl" style={{ color: "#eeecf5", textShadow: "0 0 34px #00000088" }}>
            {cast.label}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="hatch inline-block h-[8px] w-16" />
            <span className="text-[10px] font-black tracking-[0.25em] text-[var(--accent)]">
              {seat.name.toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* altitude, top-left: the stat panel carries this on desktop */}
      {seat && (
        <div className="pointer-events-none absolute left-4 top-3 lg:hidden">
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
            width: `${Math.max(0, Math.min(100, (secondsLeft / intervalSec) * 100))}%`,
            background: secondsLeft < 10 ? "var(--down)" : "var(--gold)",
            boxShadow: `0 0 16px ${secondsLeft < 10 ? "var(--down)" : "var(--gold)"}`,
          }}
        />
      </div>
    </div>
  );
}
