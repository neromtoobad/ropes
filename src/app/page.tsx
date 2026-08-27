"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { TableState } from "@/lib/state";
import { Chart, usePriceSeries } from "./Chart";
import { useSound, useHeartbeat } from "./sound";

const POLL_MS = 750;

/** One identity colour per seat, so the table reads as a roster. */
const SEAT_COLOURS = ["#00e58a", "#ff2f52", "#ffc94d", "#4da3ff", "#c77dff", "#ff8f3f", "#3fe0d0", "#ff5fa2"];

/** Identity is a local key + a name. No wallet needed to sit down — the house
 *  executor holds the collateral, and every position is verifiable on-chain. */
function usePlayerKey() {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    let k = localStorage.getItem("lc.playerKey");
    if (!k) {
      k = `0x${crypto.randomUUID().replace(/-/g, "")}`;
      localStorage.setItem("lc.playerKey", k);
    }
    setKey(k);
  }, []);
  return key;
}

/** Lucide-style speaker, 1.75 stroke, inheriting colour from the button. */
function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      {on ? (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      ) : (
        <>
          <path d="M22 9l-6 6" />
          <path d="M16 9l6 6" />
        </>
      )}
    </svg>
  );
}

export default function Table() {
  const playerKey = usePlayerKey();
  const [state, setState] = useState<TableState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [bell, setBell] = useState<TableState["lastResult"]>(null);
  const [auto, setAuto] = useState(false);
  const [crown, setCrown] = useState<TableState["champion"]>(null);
  const lastCrown = useRef<number | null>(null);
  const lastBellIndex = useRef<number | null>(null);

  useEffect(() => {
    setRunId(localStorage.getItem("lc.runId"));
  }, []);

  // Poll. Simple beats elegant for eight players on one table.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const next: TableState = await res.json();
        if (!alive) return;
        setState(next);

        // Ring the bell once per newly settled round.
        const idx = next.lastResult?.index ?? null;
        if (idx !== null && lastBellIndex.current !== null && idx !== lastBellIndex.current) {
          setBell(next.lastResult);
          setTimeout(() => setBell(null), 2600);
        }
        lastBellIndex.current = idx;

        // A table resolving to one player is the whole point of the game, so it
        // gets its own moment rather than sharing the round bell.
        const ct = next.champion?.tableIndex ?? null;
        if (ct !== null && lastCrown.current !== null && ct !== lastCrown.current) {
          setCrown(next.champion);
          setTimeout(() => setCrown(null), 5000);
        }
        lastCrown.current = ct;
      } catch {
        /* keep the last good frame rather than blanking the table */
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const post = useCallback(async (path: string, body: unknown) => {
    setErr(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setErr(json.error ?? "something went wrong");
      return null;
    }
    return json;
  }, []);

  const join = async () => {
    if (!playerKey || !name.trim()) return;
    const r = await post("/api/join", { playerKey, name: name.trim() });
    if (r?.runId) {
      localStorage.setItem("lc.runId", r.runId);
      setRunId(r.runId);
    }
  };

  const points = usePriceSeries(state?.round?.index ?? null, state?.btc.price ?? null);
  const sound = useSound();

  const me = state?.seats.find((s) => s.runId === runId) ?? null;
  const secs = state?.round?.secondsLeft ?? 0;
  const urgent = secs > 0 && secs < 15;

  // The heart only beats while you actually have something at stake.
  useHeartbeat(secs, Boolean(me?.inRound));

  // The bell, scored to what it did to YOU: your run ending sounds nothing like
  // your stack multiplying, and a round you sat out is just a distant toll.
  const nameRef = useRef<string | null>(null);
  nameRef.current = me?.name ?? null;
  useEffect(() => {
    if (!bell) return;
    const mine = nameRef.current;
    if (bell.voided) sound.play("push");
    else if (mine && bell.killed.includes(mine)) sound.play("death");
    else if (mine && bell.survived.some((s) => s.name === mine)) sound.play("win");
    else sound.play("toll");
  }, [bell, sound]);

  return (
    <main className={`relative z-10 mx-auto min-h-screen max-w-5xl px-5 py-6 ${bell ? "shake" : ""}`}>
      {secs > 0 && secs < 10 && <div className="danger" />}
      <Header state={state} urgent={urgent} sound={sound} />

      <TableStrip state={state} />

      <Chart
        points={points}
        strike={state?.btc.strike ?? null}
        price={state?.btc.price ?? null}
        secondsLeft={secs}
        roundIndex={state?.round?.index ?? null}
      />

      {state?.round && (
        <Sides
          state={state}
          me={me}
          onPick={(side) => {
            // First gesture is what lets the AudioContext exist at all.
            sound.arm();
            sound.play("click");
            if (runId) post("/api/pick", { runId, side });
          }}
        />
      )}

      <Seats
        state={state}
        runId={runId}
        bellIndex={bell?.index ?? null}
        killed={bell?.killed ?? []}
        survived={(bell?.survived ?? []).map((s) => s.name)}
      />

      <div className="mt-6">
        {!runId || !me ? (
          <Join name={name} setName={setName} onJoin={() => { sound.arm(); join(); }} />
        ) : (
          <YourRun
            me={me}
            record={state?.record ?? null}
            auto={auto}
            onAuto={async () => {
              sound.play("click");
              const next = !auto;
              setAuto(next);
              if (runId) await post("/api/auto", { runId, on: next, side: me.pick });
            }}
            onBank={async () => {
              const r = await post("/api/bank", { runId });
              if (r?.ok) localStorage.removeItem("lc.runId");
            }}
          />
        )}
        {err && <p className="mt-3 text-sm text-[var(--down)]">{err}</p>}
      </div>

      <Feed state={state} />
      <Board state={state} />
      {bell && <Bell result={bell} />}
      {crown && <Crown champion={crown} />}
      <Footnote state={state} />
    </main>
  );
}

/**
 * The cohort strip. Without this the game reads as an open table anyone can
 * wander into; with it there is a fixed field, a shrinking count and a prize.
 */
function TableStrip({ state }: { state: TableState | null }) {
  const t = state?.table;
  if (!t) return null;
  const filling = t.status === "filling";
  const seal = Math.ceil(t.sealsIn);
  return (
    <div
      className="chamfer-sm mb-3 flex items-center justify-between border px-4 py-2.5"
      style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
    >
      <div className="flex items-baseline gap-3">
        <span className="display text-sm tracking-[0.15em]">TABLE {t.index}</span>
        {filling ? (
          <span className="text-[11px] font-bold tracking-widest text-[var(--dim)]">
            FILLING · {t.seated}/{t.maxSeats} SEATED · SEALS IN {Math.floor(seal / 60)}:
            {String(seal % 60).padStart(2, "0")}
          </span>
        ) : (
          <span className="text-[11px] font-bold tracking-widest glow-down">
            {t.alive} OF {t.seated} REMAINING
          </span>
        )}
      </div>
      <div className="text-right">
        <span className="text-[9px] font-bold tracking-[0.25em] text-[var(--dim)]">POT </span>
        <span className="display tabular text-lg glow-gold">{t.pot.toFixed(2)}</span>
      </div>
    </div>
  );
}

function Header({
  state,
  urgent,
  sound,
}: {
  state: TableState | null;
  urgent: boolean;
  sound: ReturnType<typeof useSound>;
}) {
  const secs = Math.floor(state?.round?.secondsLeft ?? 0);
  const alive = state?.seats.length ?? 0;
  return (
    <header className="mb-4 flex items-end justify-between">
      <div>
        <div className="flex items-center gap-3">
          <Image
            src="/mark.png"
            alt=""
            width={26}
            height={46}
            priority
            className="h-8 w-auto sm:h-11"
          />
          <h1 className="display text-base tracking-[0.2em] sm:text-xl sm:tracking-[0.28em]">LAST CANDLE</h1>
          <button
            onClick={sound.toggle}
            aria-label={sound.on ? "Mute sound" : "Unmute sound"}
            aria-pressed={sound.on}
            className="rounded border border-[var(--edge)] p-1.5 text-[var(--dim)] transition-colors duration-200 hover:text-[var(--gold)]"
          >
            <SpeakerIcon on={sound.on} />
          </button>
        </div>
        <p className="mt-1 flex items-center gap-2 text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">
          {state?.round ? "BATTLE ROYALE ON BITCOIN" : "WAITING FOR A WINDOW"}
          {state?.locked && <span className="glow-gold">● LOCKED</span>}
        </p>
      </div>

      <div className="text-right">
        {/* The clock is the loudest object on the page on purpose. */}
        <div className={`display tabular outline-num text-6xl leading-[0.85] sm:text-8xl ${urgent ? "clock-urgent" : ""}`}>
          {String(secs).padStart(2, "0")}
        </div>
        <p className="mt-1 text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">
          {alive} ALIVE
        </p>
      </div>
    </header>
  );
}

function Sides({
  state,
  me,
  onPick,
}: {
  state: TableState;
  me: TableState["seats"][number] | null;
  onPick: (side: "UP" | "DOWN") => void;
}) {
  const canPick = me && !me.inRound;
  return (
    <>
      <div className="mt-4 mb-2 flex items-baseline justify-between text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">
        <span className={state.locked ? "glow-gold" : ""}>
          {state.table?.status === "filling"
            ? "WAITING FOR THE TABLE TO SEAL"
            : state.locked
              ? "LOCKED — WATCH IT PLAY OUT"
              : canPick
                ? "PICK YOUR SIDE"
                : "NEXT ROUND"}
        </span>
        <span className="tabular">
          {(state.crowd.liveStake.up + state.crowd.liveStake.down).toFixed(2)} IN PLAY
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(["UP", "DOWN"] as const).map((side) => {
          const isUp = side === "UP";
          const price = isUp ? state.price.up : state.price.down;
          const pays = isUp ? state.pays.up : state.pays.down;
          const capped = isUp ? state.capped.up : state.capped.down;
          const stake = isUp ? state.crowd.liveStake.up : state.crowd.liveStake.down;
          const calls = isUp ? state.crowd.nextCall.up : state.crowd.nextCall.down;
          const picked = me?.pick === side;
          const c = isUp ? "var(--up)" : "var(--down)";

          return (
            <button
              key={side}
              disabled={!canPick || capped}
              onClick={() => onPick(side)}
              className={`side ${isUp ? "side-up" : "side-down"} ${picked ? "picked" : ""} chamfer border p-4 text-left disabled:cursor-not-allowed sm:p-5`}
              style={{
                color: c,
                borderColor: picked ? c : "var(--edge)",
                background: `linear-gradient(180deg, ${isUp ? "#06170f" : "#1a0810"}, var(--panel))`,
                opacity: capped ? 0.45 : 1,
              }}
            >
              <div className="flex items-baseline justify-between">
                <span className="display whitespace-nowrap text-lg tracking-[0.12em] sm:text-2xl sm:tracking-[0.15em]">
                  {isUp ? "▲ UP" : "▼ DOWN"}
                </span>
                <span className="tabular whitespace-nowrap text-[10px] font-bold text-[var(--dim)] sm:text-[11px]">
                  {stake > 0 ? `${stake.toFixed(2)} STAKED` : calls > 0 ? `${calls} CALLING` : "—"}
                </span>
              </div>

              {/* The payout is the whole proposition. Nothing else competes. */}
              {pays ? (
                <div
                  className="display tabular mt-3 text-5xl leading-none sm:text-7xl"
                  style={{ textShadow: `0 0 44px ${c}55` }}
                >
                  {pays.toFixed(2)}
                  <span className="align-super text-2xl opacity-60">×</span>
                </div>
              ) : (
                // An em dash at 72px in the display face renders as a solid bar
                // and reads as a broken graphic. Say what is actually happening.
                <div className="mt-3 flex h-[48px] items-center sm:h-[72px]">
                  <span className="text-sm font-semibold tracking-[0.2em] text-[var(--dim)]">
                    WAITING FOR THE BOOK
                  </span>
                </div>
              )}

              <div className="mt-2 text-[11px] font-bold tracking-wider text-[var(--dim)]">
                {capped
                  ? "ABOVE 90% — NOT WORTH THE RISK"
                  : price
                    ? `${price.toFixed(3)} PER CONTRACT`
                    : "THE BOOK IS EMPTY AT WINDOW OPEN"}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Seats({
  state,
  runId,
  bellIndex,
  killed,
  survived,
}: {
  state: TableState | null;
  runId: string | null;
  bellIndex: number | null;
  killed: string[];
  survived: string[];
}) {
  const seats = state?.seats ?? [];
  const topStack = Math.max(...seats.map((s) => s.stack), 0);
  if (!seats.length) {
    return (
      <p className="py-10 text-center text-sm tracking-widest text-[var(--dim)]">
        THE TABLE IS EMPTY — TAKE A SEAT
      </p>
    );
  }
  return (
    <section className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {seats.map((s, i) => {
        const dying = bellIndex !== null && killed.includes(s.name);
        const winning = bellIndex !== null && survived.includes(s.name);
        const mine = s.runId === runId;
        // Each seat gets its own identity colour, so the table reads as a
        // roster of players rather than four copies of the same card.
        const c = SEAT_COLOURS[i % SEAT_COLOURS.length];
        const side = s.pick === "UP" ? "var(--up)" : s.pick === "DOWN" ? "var(--down)" : "var(--dim)";
        // Relative stack — who is actually winning, without reading numbers.
        const share = topStack > 0 ? Math.max(6, (s.stack / topStack) * 100) : 0;
        return (
          <div
            key={s.runId}
            className={`chamfer-sm relative overflow-hidden border p-3 pb-4 ${dying ? "dying" : winning ? "winning" : "alive"}`}
            style={{
              background: "linear-gradient(180deg, var(--panel-2), var(--panel))",
              borderColor: mine ? "var(--gold)" : undefined,
            }}
          >
            {/* A side bar, so you read the table's split without reading words. */}
            <div className="absolute inset-y-0 left-0 w-1" style={{ background: c, boxShadow: `0 0 16px ${c}` }} />
            <div className="flex items-center justify-between pl-2">
              <span className="truncate text-sm font-bold">{s.name}</span>
              {s.pick && (
                <span className="text-[10px] font-black tracking-widest" style={{ color: side }}>
                  {s.pick}
                </span>
              )}
            </div>
            <div className="display tabular pl-2 text-2xl leading-tight sm:text-3xl">{s.stack.toFixed(2)}</div>
            <div className="tabular pl-2 text-[11px] font-bold text-[var(--dim)]">
              <span style={{ color: s.multiple >= 1 ? "var(--up)" : "var(--down)" }}>
                {s.multiple.toFixed(2)}×
              </span>
              {" · "}
              {s.rounds}R
              {s.inRound && s.fillPrice ? ` · @${s.fillPrice.toFixed(3)}` : s.pick ? " · …" : ""}
            </div>

            {/* Relative stack. Who is leading, read without numbers. */}
            <div className="mt-2 ml-2 h-1 overflow-hidden rounded-full bg-[#ffffff0d]">
              <div
                className="h-full transition-[width] duration-500"
                style={{ width: `${share}%`, background: c, boxShadow: `0 0 10px ${c}` }}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Join({
  name,
  setName,
  onJoin,
}: {
  name: string;
  setName: (v: string) => void;
  onJoin: () => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onJoin()}
        placeholder="your name"
        maxLength={12}
        className="flex-1 rounded-lg border border-[var(--edge)] bg-[var(--panel)] px-4 py-3 text-sm outline-none focus:border-[var(--gold)]"
      />
      <button
        onClick={onJoin}
        disabled={!name.trim()}
        className="rounded-lg bg-[var(--gold)] px-6 py-3 text-sm font-bold text-black disabled:opacity-40"
      >
        TAKE A SEAT · 10
      </button>
    </div>
  );
}

function YourRun({
  me,
  record,
  onBank,
  onAuto,
  auto,
}: {
  me: TableState["seats"][number];
  record: TableState["record"];
  onBank: () => void;
  onAuto: () => void;
  auto: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--gold)] p-4" style={{ background: "var(--panel)" }}>
      <div>
        <p className="text-xs text-[var(--dim)]">your stack</p>
        <p className="tabular text-3xl font-black">
          {me.stack.toFixed(2)}{" "}
          <span className="text-lg text-[var(--gold)]">{me.multiple.toFixed(2)}×</span>
          <span className="ml-2 text-sm text-[var(--dim)]">{me.rounds} survived</span>
        </p>
        <p className="mt-1 text-xs text-[var(--dim)]">
          {me.inRound && me.fillPrice
            ? `in this round on ${me.pick} at ${me.fillPrice.toFixed(3)}`
            : me.pick
              ? `${me.pick} — waiting for the book`
              : "pick a side"}
          {record && me.rounds > 0 && me.rounds < record.rounds && (
            <span className="ml-2 text-[var(--gold)]">
              {record.rounds - me.rounds} from the record
            </span>
          )}
          {record && me.rounds >= record.rounds && (
            <span className="ml-2 text-[var(--gold)]">longest run alive</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {me.pick && (
          <button
            onClick={onAuto}
            title="keep calling this side every round"
            className={`rounded-lg border px-3 py-3 text-xs font-bold ${
              auto ? "border-[var(--up)] text-[var(--up)]" : "border-[var(--edge)] text-[var(--dim)]"
            }`}
          >
            AUTO {auto ? "ON" : "OFF"}
          </button>
        )}
        <button
          onClick={onBank}
          className="rounded-lg border border-[var(--gold)] px-6 py-3 text-sm font-bold text-[var(--gold)]"
        >
          BANK {me.multiple.toFixed(2)}×
        </button>
      </div>
    </div>
  );
}

function Bell({ result }: { result: NonNullable<TableState["lastResult"]> }) {
  const c = result.voided ? "var(--gold)" : result.winner === "UP" ? "var(--up)" : "var(--down)";
  return (
    <div className="bell pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/92">
      <div className="text-center">
        <p className="text-xs font-bold tracking-[0.5em] text-[var(--dim)]">ROUND {result.index}</p>
        <p
          className="display mt-2 text-[4.5rem] leading-[0.8] tracking-tight sm:text-[9rem]"
          style={{ color: c, textShadow: `0 0 90px ${c}` }}
        >
          {result.voided ? "VOID" : result.winner}
        </p>

        {result.killed.length > 0 && (
          <p className="display mt-6 text-xl glow-down sm:text-3xl">
            {result.killed.map((n) => `☠ ${n}`).join("   ")}
          </p>
        )}
        {result.survived.length > 0 && (
          <p className="tabular mt-3 text-lg font-bold glow-up">
            {result.survived
              .map((s) => `${s.name} ${s.from.toFixed(2)} → ${s.to.toFixed(2)}`)
              .join("     ")}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The kill feed. A battle royale is defined by watching other people go out, and
 * a death reads completely differently when you can see it was $3.20 the wrong
 * way — the near miss is the most re-engaging thing on the screen.
 */
function Feed({ state }: { state: TableState | null }) {
  const feed = state?.feed ?? [];
  const record = state?.record;
  if (!feed.length && !record) return null;
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">THE FEED</h2>
        {record && (
          <p className="tabular text-[11px] font-bold glow-gold">
            LONGEST RUN · {record.name.toUpperCase()} · {record.rounds}R · {record.multiple.toFixed(2)}×
          </p>
        )}
      </div>
      <div className="space-y-1">
        {feed.slice(0, 6).map((f, i) => (
          <div
            key={`${f.name}-${f.round}-${i}`}
            className="feed-row flex items-center justify-between rounded-lg border border-[var(--edge)] px-4 py-2.5 text-sm"
            style={{ background: "var(--panel)", animationDelay: `${i * 45}ms` }}
          >
            <span className="flex items-center gap-2">
              <span
                className="text-lg"
                style={{
                  color:
                    f.kind === "died" ? "var(--down)" : f.kind === "swept" ? "var(--dim)" : "var(--gold)",
                }}
              >
                {f.kind === "died" ? "☠" : f.kind === "swept" ? "⌁" : "◆"}
              </span>
              <span className="font-bold">{f.name}</span>
              <span className="text-[11px] tracking-wider text-[var(--dim)]">
                {f.kind === "died"
                  ? `OUT ON ROUND ${f.round}`
                  : f.kind === "swept"
                    ? `SWEPT ON ROUND ${f.round}`
                    : `BANKED ON ROUND ${f.round}`}
              </span>
            </span>
            <span className="tabular text-[11px] font-bold text-[var(--dim)]">
              {f.rounds}R · {f.multiple.toFixed(2)}×
              {f.missedBy !== null && (
                <span className="ml-3 glow-down">MISSED BY ${f.missedBy.toFixed(2)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Last one standing. The end the infinite clock could never produce. */
function Crown({ champion }: { champion: NonNullable<TableState["champion"]> }) {
  return (
    <div className="bell pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/94">
      <div className="text-center">
        <p className="text-xs font-bold tracking-[0.5em] text-[var(--dim)]">
          TABLE {champion.tableIndex}
        </p>
        <p className="display mt-3 text-6xl leading-none glow-gold sm:text-8xl">LAST STANDING</p>
        <p className="display mt-6 text-4xl sm:text-6xl">{champion.name}</p>
        <p className="tabular mt-4 text-lg font-bold glow-gold">
          {champion.multiple.toFixed(2)}× · {champion.rounds} ROUNDS SURVIVED
        </p>
      </div>
    </div>
  );
}

function Board({ state }: { state: TableState | null }) {
  const board = state?.board ?? [];
  if (!board.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xs tracking-[0.2em] text-[var(--dim)]">FINISHED RUNS</h2>
      <div className="divide-y divide-[var(--edge)] rounded-lg border border-[var(--edge)]">
        {board.map((b, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
            <span>{b.name}</span>
            <span className="tabular" style={{ color: b.status === "banked" ? "var(--gold)" : "var(--dim)" }}>
              {b.rounds}R · {b.multiple.toFixed(2)}× {b.status === "banked" ? "banked" : "☠"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footnote({ state }: { state: TableState | null }) {
  return (
    <footer className="mt-10 border-t border-[var(--edge)] pt-4 text-[11px] leading-relaxed text-[var(--dim)]">
      Every round is a real dreamDEX event contract on Somnia testnet. Payouts come from a live
      order book, not a house line — there is no house edge, and you can never lose more than your
      seat. Prices shown are indicative: the book is thin at the start of a window, so your fill
      price is whatever the market gives you.{" "}
      {state?.btc.oracleQuestionId && (
        <a
          className="underline decoration-dotted underline-offset-2 hover:text-[var(--gold)]"
          href={`https://prd.oracle.somnia.host/questions/${state.btc.oracleQuestionId}?view=graph`}
          target="_blank"
          rel="noreferrer"
        >
          check this round&apos;s settlement sources
        </a>
      )}
    </footer>
  );
}
