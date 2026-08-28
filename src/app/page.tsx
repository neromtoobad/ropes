"use client";

/**
 * The landing: what the game is, proof it's live, one way in.
 * The game itself lives at /play — this page just has to make you want it.
 */
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { TableState } from "@/lib/state";
import { HowItWorks, SiteNav, useClimberTheme, type LeaderRow, usd } from "./shared";

export default function Landing() {
  useClimberTheme();
  const [state, setState] = useState<TableState | null>(null);
  const [top, setTop] = useState<LeaderRow[] | null>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/state").then((r) => r.json()).then(setState).catch(() => {});
      fetch("/api/leaderboard").then((r) => r.json()).then((j) => setTop(j.rows?.slice(0, 3) ?? [])).catch(() => {});
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-4xl px-4 py-6">
      <header className="flex items-center justify-between">
        <span className="text-[9px] font-black tracking-[0.35em] text-[var(--dim)]">
          SOMNIA × DREAMDEX
        </span>
        <SiteNav />
      </header>

      {/* the pitch */}
      <section className="mt-10 flex flex-col items-center text-center">
        <Image src="/logo-full.png" alt="THE CLIMB" width={300} height={300} priority className="h-44 w-auto sm:h-56" />
        <h1 className="display mt-6 text-4xl leading-tight tracking-[0.06em] sm:text-6xl">
          CLIMB THE CANDLE
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--dim)] sm:text-base">
          A prediction market you can feel. Bet UP or DOWN on a real Bitcoin 1-minute market —
          and watch your climber live it. Right side: your stack multiplies and rides on.
          Wrong side: you fall. Bail any second and keep what the market pays.
        </p>
        <Link
          href="/play"
          className="chamfer mt-8 bg-[var(--gold)] px-10 py-4 text-base font-black tracking-[0.15em] text-black transition hover:brightness-110"
          style={{ boxShadow: "0 0 60px -12px var(--gold)" }}
        >
          ENTER THE WALL →
        </Link>
        <p className="mt-2 text-[10px] font-bold tracking-[0.2em] text-[var(--dim)]">
          FREE SEAT ON THE HOUSE — OR FUND A BANKROLL AND PLAY FOR REAL
        </p>
      </section>

      {/* proof of life: the market is running right now */}
      <section className="mt-12 grid grid-cols-3 gap-3 text-center">
        {[
          {
            label: "BTC RIGHT NOW",
            value: state?.btc.price
              ? state.btc.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
              : "—",
            c: state?.btc.price && state?.btc.strike && state.btc.price >= state.btc.strike ? "var(--up)" : "var(--down)",
          },
          { label: "NEXT BELL", value: state?.round ? `0:${String(Math.floor(state.round.secondsLeft)).padStart(2, "0")}` : "—", c: "var(--text)" },
          { label: "ROUNDS PLAYED", value: state?.round ? String(state.round.index) : "—", c: "var(--gold)" },
        ].map((s) => (
          <div key={s.label} className="chamfer-sm border border-[var(--edge)] px-3 py-4" style={{ background: "var(--panel)" }}>
            <p className="text-[9px] font-black tracking-[0.25em] text-[var(--dim)]">{s.label}</p>
            <p className="display tabular mt-1 text-2xl leading-none sm:text-3xl" style={{ color: s.c }}>
              {s.value}
            </p>
          </div>
        ))}
      </section>

      {/* the rules */}
      <section className="mt-10">
        <h2 className="mb-2 text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">HOW IT WORKS</h2>
        <HowItWorks />
      </section>

      {/* the board's top three — real names, real money */}
      {top && top.length > 0 && (
        <section className="mt-8">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">TOP CLIMBERS</h2>
            <Link href="/leaders" className="text-[10px] font-bold tracking-[0.2em] text-[var(--gold)] underline decoration-dotted">
              FULL BOARD →
            </Link>
          </div>
          <div className="space-y-1">
            {top.map((r, i) => (
              <div key={r.name} className="chamfer-sm flex items-center justify-between border border-[var(--edge)] px-4 py-2.5" style={{ background: "var(--panel)" }}>
                <span className="flex items-center gap-3">
                  <span className={`display tabular w-6 text-lg ${i === 0 ? "glow-gold" : "text-[var(--dim)]"}`}>{i + 1}</span>
                  <span className="font-bold">{r.name}</span>
                  <span className="text-sm">{r.badges.join(" ")}</span>
                </span>
                <span className="display tabular text-lg" style={{ color: r.net >= 0 ? "var(--up)" : "var(--down)" }}>
                  {usd(r.net)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-12 border-t border-[var(--edge)] pt-4 text-center text-[10px] leading-relaxed tracking-wide text-[var(--dim)]">
        EVERY ROUND IS A REAL DREAMDEX EVENT CONTRACT ON SOMNIA TESTNET · NO HOUSE EDGE ·
        ELIMINATIONS LAND ON-CHAIN IN THE SETTLEMENT BLOCK
      </footer>
    </main>
  );
}
