"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TableState } from "@/lib/state";
import { Chart, usePriceSeries } from "./Chart";
import { useSound, useHeartbeat } from "./sound";

const POLL_MS = 750;

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

export default function Table() {
  const playerKey = usePlayerKey();
  const [state, setState] = useState<TableState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [bell, setBell] = useState<TableState["lastResult"]>(null);
  const [auto, setAuto] = useState(false);
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
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-6">
      <Header state={state} urgent={urgent} sound={sound} />

      <Chart points={points} strike={state?.btc.strike ?? null} price={state?.btc.price ?? null} />

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

      <Seats state={state} runId={runId} bellIndex={bell?.index ?? null} killed={bell?.killed ?? []} />

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
      <Footnote state={state} />
    </main>
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
    <header className="mb-6 flex items-end justify-between border-b border-[var(--edge)] pb-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-black tracking-[0.2em]">LAST CANDLE</h1>
          <button
            onClick={sound.toggle}
            aria-label={sound.on ? "mute" : "unmute"}
            className="rounded border border-[var(--edge)] px-2 py-1 text-xs text-[var(--dim)] hover:text-[var(--gold)]"
          >
            {sound.on ? "🔊" : "🔇"}
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--dim)]">
          {state?.round ? `round ${state.round.index} · BTC 1m` : "waiting for a window…"}
          {state?.locked && <span className="ml-2 text-[var(--gold)]">● LOCKED</span>}
        </p>
      </div>
      <div className="text-right">
        <div
          className={`tabular text-5xl font-black leading-none ${urgent ? "text-[var(--gold)]" : ""}`}
        >
          0:{String(secs).padStart(2, "0")}
        </div>
        <p className="mt-1 text-xs text-[var(--dim)]">
          {alive} {alive === 1 ? "player" : "players"} alive
          {state?.btc.strike && state?.btc.price !== null && (
            <span className="tabular ml-2">
              to beat {state.btc.strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          )}
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
      <div className="mt-4 mb-2 flex items-baseline justify-between text-[11px] tracking-widest text-[var(--dim)]">
        <span>
          {state.locked ? "THIS ROUND IS LOCKED — WATCH IT PLAY OUT" : "PICK YOUR SIDE"}
        </span>
        <span className="tabular">
          {(state.crowd.liveStake.up + state.crowd.liveStake.down).toFixed(2)} IN PLAY
        </span>
      </div>
    <div className="grid grid-cols-2 gap-3">
      {(["UP", "DOWN"] as const).map((side) => {
        const price = side === "UP" ? state.price.up : state.price.down;
        const pays = side === "UP" ? state.pays.up : state.pays.down;
        const capped = side === "UP" ? state.capped.up : state.capped.down;
        const crowd = side === "UP" ? state.crowd.up : state.crowd.down;
        const stake = side === "UP" ? state.crowd.liveStake.up : state.crowd.liveStake.down;
        const calls = side === "UP" ? state.crowd.nextCall.up : state.crowd.nextCall.down;
        const picked = me?.pick === side;
        const color = side === "UP" ? "var(--up)" : "var(--down)";
        return (
          <button
            key={side}
            disabled={!canPick || capped}
            onClick={() => onPick(side)}
            className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed ${
              picked ? "border-current" : "border-[var(--edge)]"
            } ${canPick && !capped ? "hover:border-current" : "opacity-70"}`}
            style={{ color, background: "var(--panel)" }}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold tracking-widest">{side}</span>
              <span className="tabular text-xs text-[var(--dim)]">
                {stake > 0 ? `${stake.toFixed(2)} staked` : `${crowd} in`}
              </span>
            </div>
            <div className="tabular mt-2 text-3xl font-black">
              {pays ? `${pays.toFixed(2)}×` : "—"}
            </div>
            <div className="mt-1 text-xs text-[var(--dim)]">
              {capped
                ? "above 90% — not worth the risk"
                : price
                  ? `costs ${price.toFixed(3)} per contract`
                  : "no quotes yet"}
            </div>
            {calls > 0 && (
              <div className="tabular mt-1 text-[11px] text-[var(--dim)] opacity-80">
                {calls} calling this next round
              </div>
            )}
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
}: {
  state: TableState | null;
  runId: string | null;
  bellIndex: number | null;
  killed: string[];
}) {
  const seats = state?.seats ?? [];
  return (
    <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {seats.map((s) => {
        const dying = bellIndex !== null && killed.includes(s.name);
        const mine = s.runId === runId;
        return (
          <div
            key={s.runId}
            className={`rounded-lg border p-3 ${dying ? "dying" : ""} ${
              mine ? "border-[var(--gold)]" : "border-[var(--edge)]"
            }`}
            style={{ background: "var(--panel)" }}
          >
            <div className="flex items-center justify-between">
              <span className="truncate text-sm font-semibold">{s.name}</span>
              {s.pick && (
                <span
                  className="text-[10px] font-bold tracking-wider"
                  style={{ color: s.pick === "UP" ? "var(--up)" : "var(--down)" }}
                >
                  {s.pick}
                </span>
              )}
            </div>
            <div className="tabular mt-1 text-xl font-bold">{s.stack.toFixed(2)}</div>
            <div className="tabular text-[11px] text-[var(--dim)]">
              {s.multiple.toFixed(2)}× · {s.rounds}R
              {s.inRound && s.fillPrice ? ` · in @ ${s.fillPrice.toFixed(3)}` : s.pick ? " · waiting" : ""}
            </div>
          </div>
        );
      })}
      {seats.length === 0 && (
        <p className="col-span-full py-8 text-center text-sm text-[var(--dim)]">
          the table is empty. take a seat.
        </p>
      )}
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
  return (
    <div className="bell pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/95">
      <div className="text-center">
        <p className="text-sm tracking-[0.3em] text-[var(--dim)]">ROUND {result.index}</p>
        <p
          className="text-7xl font-black tracking-tight"
          style={{ color: result.voided ? "var(--gold)" : result.winner === "UP" ? "var(--up)" : "var(--down)" }}
        >
          {result.voided ? "VOID" : result.winner}
        </p>
        {result.killed.length > 0 && (
          <p className="mt-3 text-lg font-bold text-[var(--down)]">
            ☠ {result.killed.join("  ☠ ")}
          </p>
        )}
        {result.survived.length > 0 && (
          <p className="tabular mt-2 text-sm text-[var(--up)]">
            {result.survived.map((s) => `${s.name} ${s.from.toFixed(2)}→${s.to.toFixed(2)}`).join("   ")}
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
        <h2 className="text-xs tracking-[0.2em] text-[var(--dim)]">THE FEED</h2>
        {record && (
          <p className="tabular text-xs text-[var(--gold)]">
            longest run · {record.name} · {record.rounds}R · {record.multiple.toFixed(2)}×
          </p>
        )}
      </div>
      <div className="space-y-1">
        {feed.slice(0, 6).map((f, i) => (
          <div
            key={i}
            className="flex items-baseline justify-between rounded-md border border-[var(--edge)] px-3 py-2 text-sm"
            style={{ background: "var(--panel)" }}
          >
            <span>
              <span style={{ color: f.kind === "died" ? "var(--down)" : "var(--gold)" }}>
                {f.kind === "died" ? "☠" : "💰"}
              </span>{" "}
              <span className="font-semibold">{f.name}</span>
              <span className="ml-2 text-xs text-[var(--dim)]">
                {f.kind === "died" ? `out on round ${f.round}` : `banked on round ${f.round}`}
              </span>
            </span>
            <span className="tabular text-xs text-[var(--dim)]">
              {f.rounds}R · {f.multiple.toFixed(2)}×
              {f.missedBy !== null && (
                <span className="ml-2 text-[var(--down)]">missed by ${f.missedBy.toFixed(2)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
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
