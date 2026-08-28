"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { TableState } from "@/lib/state";
import type { Address } from "viem";
import { Cliff, liveMultipleOf, CAST, type ClimberId } from "../Cliff";
import { useSound, useHeartbeat } from "../sound";
import { hasWallet, connect, paySeat, collateralBalance } from "../wallet";
import { useSmoothed } from "../useSmoothed";
import {
  usd, short, pad, usePlayerKey, useLedger, useClimberTheme, SiteNav, HowItWorks, ShareButton,
  type LedgerData,
} from "../shared";

const SEAT = 10_000_000n; // 10 tUSDC, 6 decimals

const POLL_MS = 750;

/** What the bell meant for the viewer's own money. */
type BellVerdict =
  | { kind: "won"; from: number; to: number }
  | { kind: "lost" }
  | { kind: "push" }
  | null;

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

export default function Game() {
  const playerKey = usePlayerKey();
  const [state, setState] = useState<TableState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [bell, setBell] = useState<TableState["lastResult"]>(null);
  const [leaping, setLeaping] = useState<string[]>([]);
  const [passed, setPassed] = useState<string | null>(null);
  const [optimisticPick, setOptimisticPick] = useState<"UP" | "DOWN" | null>(null);
  const [busy, setBusy] = useState(false);
  const [bailing, setBailing] = useState(false);
  // Which of the eight climbers you are. Cosmetic, local, and yours.
  const [climber, setClimber] = useState<ClimberId>("green");
  const lastBellIndex = useRef<number | null>(null);

  useEffect(() => {
    setRunId(localStorage.getItem("lc.runId"));
    const saved = localStorage.getItem("lc.climber");
    if (saved && CAST.some((c) => c.id === saved)) setClimber(saved as ClimberId);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const next: TableState = await res.json();
        if (!alive) return;
        setState(next);

        const idx = next.lastResult?.index ?? null;
        if (idx !== null && lastBellIndex.current !== null && idx !== lastBellIndex.current) {
          setBell(next.lastResult);
          setTimeout(() => setBell(null), 3400);
          // A bell consumes every pick — showing the old one as "YOUR BET"
          // would claim a stake that is not on the table.
          setOptimisticPick(null);
        }
        lastBellIndex.current = idx;
      } catch {
        /* keep the last good frame rather than blanking the wall */
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

  const [seatFlash, setSeatFlash] = useState<null | "paid" | "free">(null);

  const join = async (depositTx?: string) => {
    if (!playerKey || !name.trim() || busy) return;
    setBusy(true);
    const r = await post("/api/join", { playerKey, name: name.trim(), depositTx });
    setBusy(false);
    if (r?.runId) {
      localStorage.setItem("lc.runId", r.runId);
      setRunId(r.runId);
      // The moment the money moves, say so — and say whose money it was.
      setSeatFlash(r.paid ? "paid" : "free");
      setTimeout(() => setSeatFlash(null), 2800);
    }
  };

  // The player's own wallet — used to pay for the seat and receive payouts.
  // Play stays custodial either way; a missing wallet just means free play.
  const [walletReady, setWalletReady] = useState(false);
  const [addr, setAddr] = useState<Address | null>(null);
  const [paying, setPaying] = useState(false);
  useEffect(() => setWalletReady(hasWallet()), []);

  const connectWallet = async () => {
    sound.arm();
    try {
      setAddr(await connect());
      setErr(null);
    } catch (e) {
      setErr(String(e).replace("Error: ", "").slice(0, 160));
    }
  };

  const buySeat = async () => {
    if (!state?.pay || !addr || !name.trim() || paying || busy) return;
    sound.arm();
    setPaying(true);
    setErr(null);
    try {
      const bal = await collateralBalance(addr, state.pay.collateral as Address);
      if (bal < SEAT) throw new Error("not enough tUSDC — a seat costs 10");
      const tx = await paySeat(addr, state.pay.collateral as Address, state.pay.house as Address, SEAT);
      await join(tx);
    } catch (e) {
      setErr(String(e).replace("Error: ", "").slice(0, 160));
    }
    setPaying(false);
  };

  const sound = useSound();
  const me = state?.seats.find((s) => s.runId === runId) ?? null;
  const secs = state?.round?.secondsLeft ?? 0;
  const urgent = secs > 0 && secs < 15;

  useHeartbeat(secs, Boolean(me?.inRound));
  // The chosen climber's colours paint the whole site.
  useClimberTheme(climber);

  // Sticky: the poll that delivers the bell also removes a dead seat, so the
  // name must survive past the seat or the verdict can't find its owner.
  const nameRef = useRef<string | null>(null);
  if (me?.name) nameRef.current = me.name;

  // The bell, made personal: did YOUR money win, lose, or carry?
  const myName = nameRef.current;
  const mine: BellVerdict = !bell || !myName
    ? null
    : bell.voided
      ? { kind: "push" }
      : bell.killed.includes(myName)
        ? { kind: "lost" }
        : (() => {
            const s = bell.survived.find((x) => x.name === myName);
            return s ? { kind: "won" as const, from: s.from, to: s.to } : null;
          })();
  useEffect(() => {
    if (!bell) return;
    const mine = nameRef.current;
    if (bell.voided) sound.play("push");
    else if (mine && bell.killed.includes(mine)) sound.play("death");
    else if (mine && bell.survived.some((s) => s.name === mine)) sound.play("win");
    else sound.play("toll");
  }, [bell, sound]);

  const pickClimber = (id: ClimberId) => {
    sound.arm();
    sound.play("click");
    setClimber(id);
    localStorage.setItem("lc.climber", id);
  };

  // The ledger backs the money bar, the sparkline and YOUR LAST RUN.
  // It refreshes on every bell (each bell can change it).
  const ledger = useLedger(playerKey, `${bell?.index ?? 0}-${runId}`);

  return (
    <main className={`relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-3 lg:h-screen lg:max-h-screen lg:overflow-hidden ${bell ? "shake" : ""}`}>
      {secs > 0 && secs < 10 && <div className="danger" />}

      <TopBar state={state} urgent={urgent} sound={sound} me={me} />

      <div className="shrink-0"><MoneyBar me={me} price={state?.price ?? { up: null, down: null }} ledger={ledger} /></div>

      {seatFlash && (
        <div className="pointer-events-none fixed inset-x-0 top-[20%] z-40 text-center">
          <p className="display text-3xl sm:text-4xl" style={{ color: seatFlash === "paid" ? "var(--down)" : "var(--gold)", textShadow: `0 0 40px ${seatFlash === "paid" ? "var(--down-glow)" : "var(--gold-glow)"}` }}>
            {seatFlash === "paid" ? "SEAT −10.00" : "SEAT STAKED · 10.00"}
          </p>
          <p className="mt-1 text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">
            {seatFlash === "paid"
              ? "PAID FROM YOUR WALLET — THE MOST YOU CAN EVER LOSE"
              : "ON THE HOUSE — THE MOST A SEAT CAN EVER LOSE"}
          </p>
        </div>
      )}

      {/* The HUD: roster rail · the wall · the stat block. One viewport,
          no scroll — the wall flexes to fill whatever height is left. */}
      <div className="mt-2 grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[72px_minmax(0,1fr)_240px]">
        <div className="lg:min-h-0 lg:overflow-y-auto">
          <Rail climber={climber} onPick={pickClimber} lockedIn={Boolean(me)} />
        </div>

        <div className="flex min-w-0 flex-col lg:min-h-0">
          <div className="lg:min-h-0 lg:flex-1">
          <Cliff
            seats={state?.seats ?? []}
            price={state?.price ?? { up: null, down: null }}
            secondsLeft={secs}
            myRunId={runId}
            falling={bell?.killed ?? []}
            leaping={leaping}
            btc={state?.btc ?? { price: null, strike: null, oracleQuestionId: null }}
            record={state?.wallRecord ?? null}
            climber={climber}
            onMilestone={(m) => {
              sound.play("win");
              setPassed(`${m}×`);
              setTimeout(() => setPassed(null), 2000);
            }}
          />
          </div>

          {me && state?.round && <PhaseStrip state={state} me={me} />}

          {/* One control, matched to the moment. Never several at once. */}
          <div className="mt-2 shrink-0">
            {!runId || !me ? (
              <Join
                name={name}
                setName={setName}
                busy={busy}
                paying={paying}
                addr={addr}
                walletReady={walletReady}
                bank={ledger?.bank ?? null}
                onJoin={() => { sound.arm(); join(); }}
                onConnect={connectWallet}
                onBuy={buySeat}
                onPlayFree={() => setAddr(null)}
              />
            ) : me.inRound ? (
              <BailBar
                me={me}
                price={state?.price ?? { up: null, down: null }}
                pending={bailing}
                onBank={async () => {
                  if (bailing) return;
                  setBailing(true);
                  if (me) setLeaping((n) => [...n, me.name]);
                  sound.play("win");
                  const r = await post("/api/bank", { runId });
                  if (r?.ok) localStorage.removeItem("lc.runId");
                  else setBailing(false);
                  setTimeout(() => setLeaping((n) => n.filter((x) => x !== me?.name)), 1400);
                }}
              />
            ) : state?.round ? (
              <Sides
                state={state}
                me={me}
                optimistic={optimisticPick}
                onPick={async (side) => {
                  if (busy) return;
                  sound.arm();
                  sound.play("click");
                  setOptimisticPick(side);
                  if (runId) {
                    setBusy(true);
                    const r = await post("/api/pick", { runId, side });
                    setBusy(false);
                    if (!r) setOptimisticPick(null);
                  }
                }}
              />
            ) : null}
            {err && <p className="mt-2 text-sm text-[var(--down)]">{err}</p>}
          </div>
        </div>

        <StatPanel state={state} me={me} climber={climber} series={ledger?.series ?? null} />
      </div>

      {passed && (
        <div className="pointer-events-none fixed inset-x-0 top-[28%] z-40 text-center">
          <span className="display text-3xl glow-gold sm:text-4xl">LEDGE {passed}</span>
        </div>
      )}

      <div id="runs" className="lg:hidden">
        <Feed state={state} />
        {!me && <LastRun ledger={ledger} climber={climber} />}
      </div>
      {bell && <Bell result={bell} mine={mine} />}
      <div className="lg:hidden"><Footnote state={state} /></div>
    </main>
  );
}

/* ───────────────────────────── top bar ───────────────────────────── */

function TopBar({
  state,
  urgent,
  sound,
  me,
}: {
  state: TableState | null;
  urgent: boolean;
  sound: ReturnType<typeof useSound>;
  me: TableState["seats"][number] | null;
}) {
  const secs = Math.floor(state?.round?.secondsLeft ?? 0);
  const t = state?.table;
  const roping = t?.status === "filling" && t.seated > 0;
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex items-center gap-3">
        <Image src="/mark.png" alt="" width={26} height={40} priority className="h-9 w-auto" />
        <div>
          <h1 className="display whitespace-nowrap text-base leading-none tracking-[0.2em] sm:text-lg">THE CLIMB</h1>
          <p className="mt-0.5 text-[9px] font-bold tracking-[0.3em] text-[var(--dim)]">
            {roping
              ? `ROPING UP · 0:${String(Math.max(0, Math.round(t!.sealsIn))).padStart(2, "0")}`
              : me
                ? "ON THE WALL"
                : "BTC · 1 MINUTE"}
          </p>
        </div>
      </div>

      <div className="order-3 flex w-full items-center justify-center gap-1 sm:order-none sm:w-auto">
        <SiteNav />
        <button
          onClick={sound.toggle}
          aria-label={sound.on ? "Mute sound" : "Unmute sound"}
          aria-pressed={sound.on}
          className="gametab flex items-center"
        >
          <SpeakerIcon on={sound.on} />
        </button>
      </div>

      <div className="text-right">
        <div className={`display tabular outline-num text-5xl leading-[0.85] sm:text-7xl ${urgent ? "clock-urgent" : ""}`}>
          {String(secs).padStart(2, "0")}
        </div>
        <p className="mt-0.5 text-[9px] font-bold tracking-[0.3em] text-[var(--dim)]">TO THE BELL</p>
      </div>
    </header>
  );
}

/* ─────────────────────────── roster rail ─────────────────────────── */

/**
 * The selection rail from every mech garage: eight climbers, one outlined.
 * Purely cosmetic — the market does not care what you look like — but choosing
 * a body is half of what makes a game feel like one.
 */
function Rail({
  climber,
  onPick,
  lockedIn,
}: {
  climber: ClimberId;
  onPick: (id: ClimberId) => void;
  lockedIn: boolean;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
      <p className="hidden text-[8px] font-black tracking-[0.3em] text-[var(--dim)] lg:block">
        CLIMBER
      </p>
      {CAST.map((c) => (
        <button
          key={c.id}
          onClick={() => onPick(c.id)}
          disabled={lockedIn && climber !== c.id}
          title={`${c.code} ${c.label}`}
          aria-pressed={climber === c.id}
          className={`slot chamfer-sm h-[56px] w-[56px] shrink-0 lg:h-[60px] lg:w-full ${climber === c.id ? "sel" : ""} disabled:cursor-not-allowed disabled:opacity-35`}
        >
          <Image
            src={`/climbers/${c.id}/climb.png`}
            alt={c.label}
            width={40}
            height={56}
            unoptimized
            className="h-[44px] w-auto"
          />
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────── stat panel ──────────────────────────── */

function Stat({ label, value, frac }: { label: string; value: string; frac: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] font-black tracking-[0.25em] text-[var(--dim)]">{label}</span>
        <span className="tabular text-[11px] font-bold">{value}</span>
      </div>
      <div className="statbar mt-1">
        <div style={{ width: `${Math.max(2, Math.min(100, frac * 100))}%` }} />
      </div>
    </div>
  );
}

/** The RPG stat block: altitude as the level numeral, then the bars. */
function Sparkline({ series }: { series: number[] }) {
  const w = 200;
  const h = 42;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(max - min, 0.01);
  const pts = series.map((v, i) => [
    (i / Math.max(series.length - 1, 1)) * (w - 8) + 4,
    h - 6 - ((v - min) / span) * (h - 12),
  ]);
  const d = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = series[series.length - 1] >= series[0];
  const c = up ? "var(--up)" : "var(--down)";
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[42px] w-full" aria-hidden="true">
      <polyline points={d} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" opacity="0.9" />
      <circle cx={lx} cy={ly} r="3" fill={c} />
    </svg>
  );
}

function StatPanel({
  state,
  me,
  climber,
  series,
}: {
  state: TableState | null;
  me: TableState["seats"][number] | null;
  climber: ClimberId;
  series: number[] | null;
}) {
  const cast = CAST.find((c) => c.id === climber) ?? CAST[0];
  const smoothMult = useSmoothed(liveMultipleOf(me, state?.price ?? { up: null, down: null }), 340, 3);
  const mult = me ? smoothMult : null;
  const record = state?.wallRecord?.multiple ?? null;
  const best = me?.best ?? null;
  // One scale for every bar, so they are comparable at a glance.
  const scale = Math.max(record ?? 0, best ?? 0, mult ?? 0, 2);
  const btc = state?.btc;

  return (
    <aside className="ticks chamfer-sm hidden flex-col gap-4 border p-4 lg:flex lg:h-full lg:min-h-0 lg:overflow-y-auto"
      style={{ borderColor: "var(--edge)", background: "linear-gradient(180deg, var(--panel-2), var(--panel))" }}>
      <div>
        <p className="text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">{cast.code}</p>
        <p className="display text-lg tracking-[0.08em]">{cast.label}</p>
        <span className="hatch mt-1 block h-[6px] w-full" />
      </div>

      <div className="border border-[var(--edge)] px-3 py-2">
        <p className="text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">ALTITUDE</p>
        <p className="display tabular text-5xl leading-none glow-gold">
          {mult !== null ? mult.toFixed(2) : "—"}
          {mult !== null && <span className="text-2xl opacity-70">×</span>}
        </p>
        {series && series.length >= 2 && (
          <div className="mt-1.5 border-t border-[var(--edge)] pt-1">
            <p className="text-[8px] font-black tracking-[0.3em] text-[var(--dim)]">THIS RUN, BELL BY BELL</p>
            <Sparkline series={series} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Stat label="CURRENT" value={mult !== null ? `${mult.toFixed(2)}×` : "—"} frac={(mult ?? 0) / scale} />
        <Stat label="YOUR BEST" value={best !== null ? `${best.toFixed(2)}×` : "—"} frac={(best ?? 0) / scale} />
        <Stat label="RECORD" value={record !== null ? `${record.toFixed(2)}×` : "—"} frac={(record ?? 0) / scale} />
        <Stat
          label="ROUNDS"
          value={me ? `${me.rounds}` : "—"}
          frac={me && state?.record ? Math.min(1, me.rounds / Math.max(state.record.rounds, 1)) : 0}
        />
      </div>

      {btc?.price != null && btc.strike != null && (
        <div className="mt-auto border-t border-[var(--edge)] pt-3">
          <p className="text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">BTC vs THE LINE</p>
          <p className="tabular mt-1 text-lg font-bold"
            style={{ color: btc.price >= btc.strike ? "var(--up)" : "var(--down)" }}>
            {btc.price >= btc.strike ? "▲ +" : "▼ "}
            {(btc.price - btc.strike).toFixed(2)}
          </p>
          <p className="tabular text-[10px] text-[var(--dim)]">
            TO BEAT {btc.strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
      )}

      {/* the feed lives HERE on desktop, so the page never scrolls */}
      {state?.feed && state.feed.length > 0 && (
        <div className="border-t border-[var(--edge)] pt-2">
          <p className="text-[8px] font-black tracking-[0.3em] text-[var(--dim)]">LATEST BELLS</p>
          <div className="mt-1.5 space-y-1">
            {state.feed.slice(0, 3).map((f, i) => (
              <div key={`${f.name}-${f.round}-${i}`} className="flex items-center justify-between text-[10px] font-bold">
                <span className="flex items-center gap-1.5 truncate">
                  <span style={{ color: f.kind === "died" ? "var(--down)" : f.kind === "swept" ? "var(--dim)" : "var(--gold)" }}>
                    {f.kind === "died" ? "☠" : f.kind === "swept" ? "⌁" : "◆"}
                  </span>
                  <span className="truncate">{f.name}</span>
                </span>
                <span className="tabular text-[var(--dim)]">{f.multiple.toFixed(2)}×</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {state?.btc.oracleQuestionId && (
        <a
          className="text-[8px] font-bold tracking-[0.2em] text-[var(--dim)] underline decoration-dotted hover:text-[var(--gold)]"
          href={`https://prd.oracle.somnia.host/questions/${state.btc.oracleQuestionId}?view=graph`}
          target="_blank"
          rel="noreferrer"
        >
          PROVABLY FAIR — SETTLEMENT SOURCES ↗
        </a>
      )}
    </aside>
  );
}

/* ─────────────────────────── phase strip ─────────────────────────── */

/**
 * The round as a ritual: BET → ENTER → RIDE → BELL, with the viewer's own
 * run highlighted on the step it is at and a countdown for what's next.
 * One glance answers "what is happening and when is my moment".
 */
function PhaseStrip({ state, me }: { state: TableState; me: TableState["seats"][number] }) {
  const r = state.round!;
  const secs = Math.floor(r.secondsLeft);
  const betsIn = Math.floor(r.betsCloseIn);
  const phase = me.inRound ? 2 : me.pick ? 1 : 0;

  const steps = [
    {
      label: "BET",
      detail:
        phase === 0
          ? betsIn > 0
            ? `OPEN · 0:${pad(betsIn)}`
            : `NEXT · 0:${pad(secs)}`
          : "PLACED",
    },
    {
      label: "ENTER",
      detail:
        phase === 1 ? (betsIn > 0 ? "FILLING…" : `OPENS 0:${pad(secs)}`) : phase > 1 ? "FILLED" : "·",
    },
    { label: "RIDE", detail: phase === 2 ? `LIVE · 0:${pad(secs)}` : "·" },
    { label: "BELL", detail: `RND ${r.index}` },
  ];

  return (
    <div className="mt-3 grid grid-cols-4 gap-1.5" aria-label="round phases">
      {steps.map((s, i) => {
        const active = i === phase;
        const done = i < phase;
        return (
          <div
            key={s.label}
            className="chamfer-sm border px-2 py-1.5 text-center"
            style={{
              borderColor: active ? "var(--gold)" : "var(--edge)",
              background: active ? "#241c07" : "var(--panel)",
              opacity: done ? 0.55 : 1,
              boxShadow: active ? "0 0 24px -12px var(--gold)" : "none",
            }}
          >
            <p
              className="text-[10px] font-black tracking-[0.25em]"
              style={{ color: active ? "var(--gold)" : done ? "var(--up)" : "var(--dim)" }}
            >
              {done ? "✓ " : `${i + 1} `}
              {s.label}
            </p>
            <p className="tabular mt-0.5 text-[9px] font-bold tracking-[0.15em] text-[var(--dim)]">
              {s.detail}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── action bar ──────────────────────────── */

function BailBar({
  me,
  price,
  pending,
  onBank,
}: {
  me: TableState["seats"][number];
  price: TableState["price"];
  pending: boolean;
  onBank: () => void;
}) {
  const liveMult = useSmoothed(liveMultipleOf(me, price), 340, 3);
  const keep = liveMult * me.buyIn;
  const sideC = me.pick === "UP" ? "var(--up)" : "var(--down)";
  return (
    <>
      {/* the bet slip — what's riding, at what price */}
      <div className="mb-2 flex items-baseline justify-between text-[10px] font-bold tracking-[0.25em]">
        <span style={{ color: sideC }}>
          YOUR BET: {me.pick === "UP" ? "▲ UP" : "▼ DOWN"}
          {me.fillPrice ? ` · FILLED @ ${me.fillPrice.toFixed(3)}` : ""}
        </span>
        <span className="tabular text-[var(--dim)]">STAKE {me.costInRound.toFixed(2)}</span>
      </div>
    <button
      onClick={onBank}
      disabled={pending}
      className="chamfer flex w-full items-center justify-between border px-5 py-4 text-left transition disabled:opacity-70"
      style={{
        borderColor: "var(--gold)",
        background: "linear-gradient(90deg, #241c07, var(--panel))",
        boxShadow: "0 0 44px -18px var(--gold)",
      }}
    >
      <span>
        <span className="display text-2xl glow-gold sm:text-3xl">{pending ? "SELLING…" : "BAIL"}</span>
        <span className="ml-3 text-[11px] font-bold tracking-widest text-[var(--dim)]">
          {pending ? "ON THE BOOK — MONEY LANDS IN A MOMENT" : `KEEP ${keep.toFixed(2)}`}
        </span>
      </span>
      <span className="display tabular text-3xl glow-gold sm:text-4xl">{liveMult.toFixed(2)}×</span>
    </button>
    </>
  );
}

function Sides({
  state,
  me,
  onPick,
  optimistic,
}: {
  state: TableState;
  me: TableState["seats"][number] | null;
  onPick: (side: "UP" | "DOWN") => void;
  optimistic: "UP" | "DOWN" | null;
}) {
  const canPick = me && !me.inRound;
  const shownPick = optimistic ?? me?.pick ?? null;
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">
        <span className={state.locked || shownPick ? "glow-gold" : ""}>
          {state.table?.status === "filling"
            ? "ROPING UP"
            : state.locked
              ? "LOCKED — WATCH IT PLAY OUT"
              : shownPick
                ? `YOUR BET: ${shownPick === "UP" ? "▲ UP" : "▼ DOWN"} — WHOLE STACK, ${
                    (state.round?.betsCloseIn ?? 0) > 0 ? "ENTERING NOW" : "NEXT WINDOW"
                  }`
                : canPick
                  ? (state.round?.betsCloseIn ?? 0) > 0
                    ? `BETS OPEN — CLOSE IN 0:${pad(state.round!.betsCloseIn)}`
                    : `BETS CLOSED — NEXT WINDOW IN 0:${pad(state.round?.secondsLeft ?? 0)}`
                  : "NEXT ROUND"}
        </span>
        <span className="tabular">
          {state.round ? `ROUND ${state.round.index} · ` : ""}BELL 0:
          {pad(state.round?.secondsLeft ?? 0)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(["UP", "DOWN"] as const).map((side) => {
          const isUp = side === "UP";
          const price = isUp ? state.price.up : state.price.down;
          const pays = isUp ? state.pays.up : state.pays.down;
          const capped = isUp ? state.capped.up : state.capped.down;
          const picked = shownPick === side;
          const unpicked = shownPick !== null && !picked;
          const c = isUp ? "var(--up)" : "var(--down)";

          return (
            <button
              key={side}
              disabled={!canPick || capped}
              onClick={() => onPick(side)}
              className={`side ${isUp ? "side-up" : "side-down"} ${picked ? "picked" : ""} ${unpicked ? "unpicked" : ""} chamfer border p-4 text-left disabled:cursor-not-allowed sm:p-5`}
              style={{
                color: c,
                borderColor: picked ? c : "var(--edge)",
                background: `linear-gradient(180deg, ${isUp ? "#06170f" : "#1a0810"}, var(--panel))`,
                opacity: capped ? 0.45 : 1,
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="display whitespace-nowrap text-lg tracking-[0.12em] sm:text-2xl sm:tracking-[0.15em]">
                  {isUp ? "▲ UP" : "▼ DOWN"}
                </span>
                <span className="tabular hidden whitespace-nowrap text-[10px] font-bold text-[var(--dim)] min-[420px]:inline sm:text-[11px]">
                  PAYS IF RIGHT
                </span>
              </div>

              {pays ? (
                <div
                  className="display tabular mt-3 text-5xl leading-none sm:text-7xl"
                  style={{ textShadow: `0 0 44px ${c}55` }}
                >
                  {pays.toFixed(2)}
                  <span className="align-super text-2xl opacity-60">×</span>
                </div>
              ) : (
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

function Join({
  name,
  setName,
  busy,
  paying,
  addr,
  walletReady,
  bank,
  onJoin,
  onConnect,
  onBuy,
  onPlayFree,
}: {
  name: string;
  setName: (v: string) => void;
  busy: boolean;
  paying: boolean;
  addr: Address | null;
  walletReady: boolean;
  bank: LedgerData["bank"];
  onJoin: () => void;
  onConnect: () => void;
  onBuy: () => void;
  onPlayFree: () => void;
}) {
  // A funded bankroll seats with ONE click — the server debits it, no
  // wallet popup. That is the whole point of the bankroll.
  const funded = Boolean(bank && bank.balance >= 10);
  const primary = funded ? onJoin : addr ? onBuy : onJoin;
  return (
    <div>
      <HowItWorks />
      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && primary()}
          placeholder="your name"
          maxLength={12}
          className="min-w-0 flex-1 rounded-lg border border-[var(--edge)] bg-[var(--panel)] px-4 py-3 text-base outline-none focus:border-[var(--gold)]"
        />
        {funded ? (
          <button
            onClick={onJoin}
            disabled={!name.trim() || busy}
            className="chamfer-sm bg-[var(--gold)] px-6 py-3 text-sm font-black tracking-[0.1em] text-black disabled:opacity-40"
          >
            {busy ? "SEATING…" : `SIT · 10 FROM BANKROLL (${bank!.balance.toFixed(2)})`}
          </button>
        ) : addr ? (
          <button
            onClick={onBuy}
            disabled={!name.trim() || paying || busy}
            className="chamfer-sm bg-[var(--gold)] px-6 py-3 text-sm font-black tracking-[0.1em] text-black disabled:opacity-40"
          >
            {paying ? "PAYING…" : busy ? "SEATING…" : "DEPOSIT & SIT · 10 tUSDC"}
          </button>
        ) : (
          <button
            onClick={onJoin}
            disabled={!name.trim() || busy}
            className="chamfer-sm bg-[var(--gold)] px-6 py-3 text-sm font-black tracking-[0.1em] text-black disabled:opacity-40"
          >
            {busy ? "SEATING…" : "TAKE A SEAT · FREE"}
          </button>
        )}
        {walletReady && !addr && !funded && (
          <button
            onClick={onConnect}
            className="chamfer-sm border border-[var(--gold)] px-4 py-3 text-xs font-black tracking-[0.1em] text-[var(--gold)]"
          >
            CONNECT WALLET
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[10px] font-bold tracking-wider text-[var(--dim)]">
        {funded ? (
          <>
            YOUR BANKROLL COVERS THE SEAT — WINNINGS GO STRAIGHT BACK TO IT ·{" "}
            <a href="/wallet" className="underline decoration-dotted hover:text-[var(--gold)]">MANAGE IT</a>
          </>
        ) : addr ? (
          <>
            PAYING FROM <span className="tabular text-[var(--gold)]">{short(addr)}</span> — WINNINGS
            RETURN THERE ON-CHAIN ·{" "}
            <button onClick={onPlayFree} className="underline decoration-dotted hover:text-[var(--gold)]">
              PLAY FREE INSTEAD
            </button>
          </>
        ) : walletReady ? (
          "CONNECT TO PLAY WITH REAL TESTNET tUSDC — OR TAKE A FREE SEAT ON THE HOUSE BANKROLL"
        ) : (
          "NO WALLET DETECTED — PLAYING FREE ON THE HOUSE BANKROLL. EVERY TRADE IS STILL REAL AND ON-CHAIN."
        )}
      </p>
    </div>
  );
}

/* ────────────────────────── bell + feed ──────────────────────────── */

function Bell({
  result,
  mine,
}: {
  result: NonNullable<TableState["lastResult"]>;
  mine: BellVerdict;
}) {
  const c = result.voided ? "var(--gold)" : result.winner === "UP" ? "var(--up)" : "var(--down)";
  return (
    <div className="bell pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/92">
      <div className="text-center">
        <p className="text-xs font-bold tracking-[0.5em] text-[var(--dim)]">THE BELL</p>
        <p
          className="display mt-2 text-[3rem] leading-[0.85] tracking-tight sm:text-[6rem]"
          style={{ color: c, textShadow: `0 0 90px ${c}` }}
        >
          {result.voided ? "NO VERDICT" : result.winner === "UP" ? "▲ ABOVE THE LINE" : "▼ BELOW THE LINE"}
        </p>
        <p className="tabular mt-3 text-sm font-bold tracking-[0.2em] text-[var(--dim)]">
          {result.voided
            ? "THE ORACLE COULD NOT SETTLE — EVERYONE'S STACK CARRIES"
            : `BTC CLOSED ${
                result.closedBy !== null
                  ? `$${Math.abs(result.closedBy).toFixed(2)} ${result.closedBy >= 0 ? "OVER" : "UNDER"} THE LINE`
                  : result.winner === "UP" ? "OVER THE LINE" : "UNDER THE LINE"
              } — ${result.winner} RIDERS SURVIVE`}
        </p>
        {result.killed.length > 0 && (
          <p className="display mt-6 text-xl glow-down sm:text-3xl">
            {result.killed.map((n) => `☠ ${n}`).join("   ")}
          </p>
        )}
        {result.survived.length > 0 && (
          <p className="tabular mt-3 text-lg font-bold glow-up">
            {result.survived.map((s) => `${s.name} ${s.from.toFixed(2)} → ${s.to.toFixed(2)}`).join("   ")}
          </p>
        )}

        {/* the verdict — what this bell did to YOUR money, in dollars */}
        {mine?.kind === "won" && (
          <div className="mt-8">
            <p className="display text-3xl glow-up sm:text-5xl">
              {/* from/to are dollar stacks, straight from the ledger */}
              YOU WON +{(mine.to - mine.from).toFixed(2)}
            </p>
            <p className="mt-2 text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">
              STACK NOW {mine.to.toFixed(2)} — ALREADY RIDING THE NEXT ROUND · BAIL ANYTIME TO CASH OUT
            </p>
          </div>
        )}
        {mine?.kind === "lost" && (
          <div className="mt-8">
            <p className="display text-3xl glow-down sm:text-5xl">YOU LOST</p>
            <p className="mt-2 text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">
              RUN OVER — ONLY YOUR 10.00 SEAT WAS EVER AT RISK
            </p>
          </div>
        )}
        {mine?.kind === "push" && (
          <div className="mt-8">
            <p className="display text-3xl glow-gold sm:text-5xl">PUSH</p>
            <p className="mt-2 text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">
              THE ORACLE VOIDED THIS ROUND — NOBODY FALLS, YOUR STACK CARRIES
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Feed({ state }: { state: TableState | null }) {
  const feed = state?.feed ?? [];
  const record = state?.record;
  if (!feed.length && !record) return null;
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">PAST RUNS</h2>
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
            className="feed-row chamfer-sm flex items-center justify-between border border-[var(--edge)] px-4 py-2.5 text-sm"
            style={{ background: "var(--panel)", animationDelay: `${i * 45}ms` }}
          >
            <span className="flex items-center gap-2">
              <span
                className="text-lg"
                style={{ color: f.kind === "died" ? "var(--down)" : f.kind === "swept" ? "var(--dim)" : "var(--gold)" }}
              >
                {f.kind === "died" ? "☠" : f.kind === "swept" ? "⌁" : "◆"}
              </span>
              <span className="font-bold">{f.name}</span>
              <span className="text-[11px] tracking-wider text-[var(--dim)]">
                {f.kind === "died" ? "FELL AT THE BELL" : f.kind === "swept" ? "SWEPT" : "BAILED"}
              </span>
            </span>
            <span className="tabular text-[11px] font-bold text-[var(--dim)]">
              {f.rounds}R · {f.multiple.toFixed(2)}×
              {f.missedBy !== null && (
                <span className="ml-3 glow-down">MISSED BY ${f.missedBy.toFixed(2)}</span>
              )}
              {f.payoutTx && (
                <a
                  href={`https://shannon-explorer.somnia.network/tx/${f.payoutTx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-3 text-[var(--gold)] underline decoration-dotted underline-offset-2"
                >
                  PAID OUT ↗
                </a>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── the money bar ─────────────────────────── */

/**
 * The two numbers that make a player pick again, too big to miss:
 * what is riding right now, and what the game has paid them all time.
 */
function MoneyBar({
  me,
  price,
  ledger,
}: {
  me: TableState["seats"][number] | null;
  price: TableState["price"];
  ledger: LedgerData | null;
}) {
  const mult = useSmoothed(liveMultipleOf(me, price), 340, 3);
  const onWall = me ? mult * me.buyIn : null;
  const delta = me && onWall !== null ? onWall - me.buyIn : null;
  const upC = delta === null || delta >= 0 ? "var(--up)" : "var(--down)";
  const net = ledger?.totals?.net ?? null;
  const netC = net !== null && net < 0 ? "var(--down)" : "var(--up)";
  const bankBalance = ledger?.bank && ledger.bank.address ? ledger.bank.balance : null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-3">
      <div className="chamfer-sm flex items-baseline justify-between border px-4 py-2.5"
        style={{ borderColor: "var(--edge)", background: "linear-gradient(180deg, var(--panel-2), var(--panel))" }}>
        <div>
          <p className="whitespace-nowrap text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">ON THE WALL</p>
          <p className="display tabular text-3xl leading-none sm:text-4xl"
            style={onWall !== null ? { color: upC, textShadow: `0 0 34px ${upC}55` } : { color: "var(--dim)" }}>
            {onWall !== null ? onWall.toFixed(2) : "—"}
          </p>
        </div>
        {delta !== null && (
          <span className="tabular hidden whitespace-nowrap text-sm font-black min-[480px]:inline" style={{ color: upC }}>
            THIS RUN {usd(delta)}
          </span>
        )}
      </div>
      <div className="chamfer-sm flex items-baseline justify-between border px-4 py-2.5"
        style={{ borderColor: "var(--edge)", background: "linear-gradient(180deg, var(--panel-2), var(--panel))" }}>
        <div>
          <p className="text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">
            {bankBalance !== null ? "BANKROLL" : "WON ALL TIME"}
          </p>
          <p className="display tabular text-3xl leading-none sm:text-4xl"
            style={bankBalance !== null
              ? { color: "var(--gold)", textShadow: "0 0 34px var(--gold-glow)" }
              : net !== null ? { color: netC, textShadow: `0 0 34px ${netC}55` } : { color: "var(--dim)" }}>
            {bankBalance !== null ? bankBalance.toFixed(2) : net !== null ? usd(net) : "—"}
          </p>
        </div>
        <a href="/wallet" className="hidden text-[9px] font-bold tracking-[0.2em] text-[var(--dim)] underline decoration-dotted sm:inline">
          {bankBalance !== null && net !== null ? `ALL TIME ${usd(net)}` : "tUSDC"}
        </a>
      </div>
    </div>
  );
}

/* ─────────────────────── ledger · leaders · share ─────────────────────── */

/** After a run ends, its card waits under the join box — the trophy moment. */
function LastRun({ ledger, climber }: { ledger: LedgerData | null; climber: ClimberId }) {
  const last = ledger?.runs.find((r) => r.status !== "alive");
  if (!last) return null;
  const won = last.net >= 0;
  return (
    <section className="mt-4 flex items-center justify-between border border-[var(--edge)] px-4 py-3 chamfer-sm" style={{ background: "var(--panel)" }}>
      <span className="text-[11px] font-bold tracking-[0.2em] text-[var(--dim)]">
        YOUR LAST RUN ·{" "}
        <span className="tabular" style={{ color: won ? "var(--up)" : "var(--down)" }}>
          {last.multiple.toFixed(2)}× · {usd(last.net)}
        </span>{" "}
        · {last.rounds}R
      </span>
      <ShareButton run={last} climber={climber} name={ledger?.name ?? "climber"} />
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
