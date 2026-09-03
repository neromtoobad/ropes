"use client";

/**
 * Shared between the game (/play), the wallet, the leaderboard and the
 * landing page: the player identity hook, the money formatters, the ledger
 * types, and the panels that render a player's money story.
 */
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { shareRunCard } from "./share";
import type { ClimberId } from "./Cliff";

export const usd = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, "0");

/** Paint the world in the chosen climber's colours. Reads localStorage so
 *  every page (landing, wallet, board) wears the theme, not just the game. */
export function useClimberTheme(override?: string) {
  useEffect(() => {
    const id = override ?? localStorage.getItem("lc.climber") ?? "green";
    document.documentElement.dataset.climber = id;
  }, [override]);
}

/** Identity is a local key + a name. The ledger knows the rest. */
export function usePlayerKey() {
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

export type LedgerData = {
  id: string | null;
  name: string | null;
  /** The bankroll — null until the player exists. */
  bank: {
    balance: number;
    address: string | null;
    withdrawPending: boolean;
    deposited: number;
    withdrawn: number;
    seatsBought: number;
    winnings: number;
  } | null;
  flows: { kind: string; amount: number; tx: string | null; at: string }[];
  totals: { staked: number; returned: number; aliveStack: number; won: number; net: number; games: number } | null;
  badges: { id: string; icon: string; label: string; hint: string }[];
  runs: {
    id: string;
    status: string;
    buyIn: number;
    stack: number;
    multiple: number;
    rounds: number;
    net: number;
    paid: boolean;
    payoutTx: string | null;
    perRound: { round: number; side: string; outcome: string | null; after: number; net: number }[];
  }[];
  series: number[] | null;
};

export type LeaderRow = {
  id: string;
  name: string;
  games: number;
  net: number;
  best: number;
  longest: number;
  badges: string[];
  alive: boolean;
};

/** Does this look like a ledger, or like an error wearing one's clothes? */
function isLedger(j: unknown): j is LedgerData {
  if (!j || typeof j !== "object") return false;
  const l = j as Partial<LedgerData>;
  return Array.isArray(l.runs) && Array.isArray(l.flows) && Array.isArray(l.badges);
}

export function useLedger(playerKey: string | null, refreshKey?: unknown) {
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  useEffect(() => {
    if (!playerKey) return;
    let dead = false;
    fetch("/api/ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerKey }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        // A failed request must NEVER become the ledger. Consumers index into
        // runs/flows/badges, so one 500 storing `{error: "..."}` here took the
        // whole page down with "cannot read properties of undefined". Keep the
        // last good ledger instead — a blip should be invisible to the player.
        if (dead || !isLedger(j)) return;
        setLedger(j);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [playerKey, refreshKey]);
  return ledger;
}

/* ─────────────────────────── site chrome ─────────────────────────── */

/** The site's nav: every section one tap away, current one lit. */
export function SiteNav() {
  const path = usePathname();
  const tabs = [
    { href: "/play", label: "CLIMB" },
    { href: "/leaders", label: "LEADERS" },
    { href: "/wallet", label: "WALLET" },
  ];
  return (
    <nav className="flex items-center gap-1" aria-label="sections">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={`gametab ${path === t.href ? "active" : ""}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Header for the non-game pages: mark, title, nav. */
export function PageHeader({ title }: { title: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <Link href="/" className="flex items-center gap-3">
        <Image src="/mark.webp" alt="" width={64} height={32} priority className="h-9 w-auto" />
        <div>
          <h1 className="display whitespace-nowrap text-base leading-none tracking-[0.2em] sm:text-lg">
            ROPES
          </h1>
          <p className="mt-0.5 text-[9px] font-bold tracking-[0.3em] text-[var(--dim)]">{title}</p>
        </div>
      </Link>
      <SiteNav />
    </header>
  );
}

/* ────────────────────────── the rules card ───────────────────────── */

/** The rules, exactly, before anyone spends anything. Four lines, no lore. */
export function HowItWorks() {
  const steps = [
    { n: "1", t: "FUND YOUR BANKROLL", d: "deposit tUSDC once — or play free on the house" },
    { n: "2", t: "BET UP OR DOWN", d: "whole stack rides each 1-min window · the countdown shows when bets close" },
    { n: "3", t: "THE BELL", d: "right side: stack multiplies, auto-rides on. wrong: you're out" },
    { n: "4", t: "BAIL & WITHDRAW", d: "bail anytime — winnings credit your bankroll, withdraw whenever" },
  ];
  return (
    <div className="mb-3 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
      {steps.map((s) => (
        <div key={s.n} className="chamfer-sm border border-[var(--edge)] px-2.5 py-2" style={{ background: "var(--panel)" }}>
          <p className="text-[10px] font-black tracking-[0.2em] text-[var(--gold)]">
            {s.n} · {s.t}
          </p>
          <p className="mt-0.5 text-[9px] font-bold leading-relaxed tracking-wide text-[var(--dim)]">
            {s.d.toUpperCase()}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── share · ledger · leaders ─────────────────── */

export function ShareButton({
  run,
  climber,
  name,
}: {
  run: LedgerData["runs"][number];
  climber: ClimberId;
  name: string;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <button
      onClick={async () => {
        const how = await shareRunCard({
          name,
          climber,
          multiple: run.multiple,
          rounds: run.rounds,
          status: run.status,
        });
        setMsg(how === "copied" ? "COPIED — PASTE ANYWHERE" : "SAVED");
        setTimeout(() => setMsg(null), 2200);
      }}
      className="chamfer-sm border border-[var(--gold)] px-3 py-1.5 text-[10px] font-black tracking-[0.15em] text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-black"
    >
      {msg ?? "SHARE CARD"}
    </button>
  );
}

export function LedgerPanel({ ledger, climber }: { ledger: LedgerData | null; climber: ClimberId }) {
  if (!ledger?.totals) {
    return (
      <p className="mt-8 text-center text-[11px] font-bold tracking-[0.3em] text-[var(--dim)]">
        NO RUNS YET — TAKE A SEAT AND THE LEDGER STARTS WRITING
      </p>
    );
  }
  const t = ledger.totals;
  const netC = t.net >= 0 ? "var(--up)" : "var(--down)";
  return (
    <section className="mt-6">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "NET GAIN, ALL TIME", value: usd(t.net), c: netC, big: true },
          { label: "TOTAL STAKED", value: t.staked.toFixed(2), c: "var(--text)" },
          { label: "BACK + ON THE WALL", value: (t.returned + t.aliveStack).toFixed(2), c: "var(--text)" },
        ].map((s) => (
          <div key={s.label} className="chamfer-sm border border-[var(--edge)] p-3" style={{ background: "var(--panel)" }}>
            <p className="text-[9px] font-black tracking-[0.25em] text-[var(--dim)]">{s.label}</p>
            <p className={`display tabular mt-1 leading-none ${s.big ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"}`} style={{ color: s.c, textShadow: s.big ? `0 0 30px ${s.c}55` : "none" }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {ledger.badges.map((b) => (
          <span key={b.id} title={b.hint} className="chamfer-sm border border-[var(--gold)] bg-[#241c07] px-2.5 py-1 text-[10px] font-black tracking-[0.12em] text-[var(--gold)]">
            {b.icon} {b.label}
          </span>
        ))}
        {ledger.badges.length === 0 && (
          <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--dim)]">NO BADGES YET — WIN A ROUND FOR FIRST BLOOD</span>
        )}
      </div>

      <div className="mt-4 space-y-1.5">
        {ledger.runs.map((r) => (
          <div key={r.id} className="chamfer-sm border border-[var(--edge)] px-4 py-2.5" style={{ background: "var(--panel)" }}>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-bold">
                <span style={{ color: r.status === "alive" ? "var(--gold)" : r.status === "eliminated" ? "var(--down)" : "var(--up)" }}>
                  {r.status === "alive" ? "▲ ON THE WALL" : r.status === "eliminated" ? "☠ FELL" : "◆ BANKED"}
                </span>
                <span className="tabular text-[11px] text-[var(--dim)]">
                  {r.rounds}R · {r.multiple.toFixed(2)}×
                </span>
                {r.paid ? (
                  <span className="border border-[var(--gold)] px-1.5 py-0.5 text-[9px] font-black tracking-[0.15em] text-[var(--gold)]">
                    PAID SEAT
                  </span>
                ) : (
                  <span
                    className="border border-[var(--edge)] px-1.5 py-0.5 text-[9px] font-black tracking-[0.15em] text-[var(--dim)]"
                    title="free seat on the house bankroll — winnings count for the board, not for withdrawal"
                  >
                    HOUSE MONEY
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular text-sm font-black" style={{ color: r.net >= 0 ? "var(--up)" : "var(--down)" }}>
                  {usd(r.net)}
                </span>
                {r.payoutTx && (
                  <a href={`https://shannon-explorer.somnia.network/tx/${r.payoutTx}`} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-[var(--gold)] underline decoration-dotted">
                    PAID ↗
                  </a>
                )}
                {r.status !== "alive" && <ShareButton run={r} climber={climber} name={ledger.name ?? "climber"} />}
              </span>
            </div>
            {r.perRound.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {r.perRound.map((p) => (
                  <span key={p.round} className="tabular border border-[var(--edge)] px-1.5 py-0.5 text-[10px] font-bold" style={{ color: p.net >= 0 ? "var(--up)" : "var(--down)" }}>
                    {p.side === "UP" ? "▲" : "▼"} {usd(p.net)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function LeadersPanel({ rows, myId }: { rows: LeaderRow[] | null; myId: string | null }) {
  if (!rows) {
    return <p className="mt-8 text-center text-[11px] font-bold tracking-[0.3em] text-[var(--dim)]">FETCHING THE BOARD…</p>;
  }
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">ALL CLIMBERS · BY NET GAIN</h2>
        <span className="hidden text-[9px] font-bold tracking-[0.2em] text-[var(--dim)] sm:inline">LIVE FROM THE LEDGER</span>
      </div>
      <div className="space-y-1">
        {rows.map((r, i) => {
          const isMe = myId !== null && r.id === myId;
          return (
            <div
              key={r.id}
              className="chamfer-sm flex items-center justify-between border px-4 py-2.5"
              style={{
                background: "var(--panel)",
                borderColor: isMe ? "var(--gold)" : "var(--edge)",
                boxShadow: isMe ? "0 0 24px -12px var(--gold)" : "none",
              }}
            >
              <span className="flex items-center gap-3">
                <span className={`display tabular w-8 text-lg ${i === 0 ? "glow-gold" : "text-[var(--dim)]"}`}>
                  {i + 1}
                </span>
                <span className="font-bold">
                  {r.name}
                  {r.alive && <span className="ml-2 text-[9px] font-black tracking-[0.2em] text-[var(--gold)]">● ON THE WALL</span>}
                </span>
                <span className="text-sm">{r.badges.join(" ")}</span>
              </span>
              <span className="flex items-baseline gap-4">
                <span className="tabular hidden text-[10px] font-bold text-[var(--dim)] sm:inline">
                  {r.games} GAME{r.games === 1 ? "" : "S"} · BEST {r.best.toFixed(2)}× · {r.longest}R
                </span>
                <span className="display tabular text-lg" style={{ color: r.net >= 0 ? "var(--up)" : "var(--down)" }}>
                  {usd(r.net)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
