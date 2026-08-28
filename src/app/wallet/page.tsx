"use client";

/**
 * The wallet: your bankroll's home. Deposit once, play forever, withdraw
 * whenever. Everything here is a flag or a read — the executor moves the
 * actual money (one-nonce rule).
 */
import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { TableState } from "@/lib/state";
import { hasWallet, connect, paySeat, collateralBalance } from "../wallet";
import {
  PageHeader, LedgerPanel, usePlayerKey, useLedger, useClimberTheme, usd, short,
} from "../shared";
import { CAST, type ClimberId } from "../Cliff";

const DEPOSIT_CHOICES = [10n, 50n, 100n] as const;

export default function Wallet() {
  useClimberTheme();
  const playerKey = usePlayerKey();
  const [refresh, setRefresh] = useState(0);
  const ledger = useLedger(playerKey, refresh);
  const [climber, setClimber] = useState<ClimberId>("green");
  const [state, setState] = useState<TableState | null>(null);
  const [addr, setAddr] = useState<Address | null>(null);
  const [walletReady, setWalletReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setWalletReady(hasWallet());
    const saved = localStorage.getItem("lc.climber");
    if (saved && CAST.some((c) => c.id === saved)) setClimber(saved as ClimberId);
    fetch("/api/state").then((r) => r.json()).then(setState).catch(() => {});
    // A pending withdrawal resolves within a tick or two — keep the page live.
    const id = setInterval(() => setRefresh((n) => n + 1), 4000);
    return () => clearInterval(id);
  }, []);

  const bank = ledger?.bank ?? null;

  const deposit = async (amount: bigint) => {
    if (!state?.pay || !playerKey || busy) return;
    setBusy(`deposit-${amount}`);
    setErr(null);
    try {
      const a = addr ?? (await connect());
      setAddr(a);
      const units = amount * 1_000_000n;
      const bal = await collateralBalance(a, state.pay.collateral as Address);
      if (bal < units) throw new Error(`not enough tUSDC — you hold ${(Number(bal) / 1e6).toFixed(2)}`);
      const tx = await paySeat(a, state.pay.collateral as Address, state.pay.house as Address, units);
      const r = await fetch("/api/deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerKey, txHash: tx }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setRefresh((n) => n + 1);
    } catch (e) {
      setErr(String(e).replace("Error: ", "").slice(0, 160));
    }
    setBusy(null);
  };

  const withdraw = async () => {
    if (!playerKey || busy) return;
    setBusy("withdraw");
    setErr(null);
    const r = await fetch("/api/withdraw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerKey }),
    });
    const j = await r.json();
    if (!r.ok) setErr(j.error);
    setRefresh((n) => n + 1);
    setBusy(null);
  };

  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-4xl px-4 py-4">
      <PageHeader title="YOUR BANKROLL" />

      {/* the balance, huge — this is the number the page exists for */}
      <section className="mt-6 chamfer border border-[var(--edge)] p-5"
        style={{ background: "linear-gradient(180deg, var(--panel-2), var(--panel))" }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[9px] font-black tracking-[0.3em] text-[var(--dim)]">BANKROLL</p>
            <p className="display tabular mt-1 text-5xl leading-none glow-gold sm:text-6xl">
              {bank ? bank.balance.toFixed(2) : "0.00"}
              <span className="ml-2 text-lg opacity-60">tUSDC</span>
            </p>
            <p className="mt-2 text-[10px] font-bold tracking-[0.2em] text-[var(--dim)]">
              {bank?.address ? (
                <>WITHDRAWS TO <span className="tabular text-[var(--gold)]">{short(bank.address)}</span></>
              ) : (
                "DEPOSIT ONCE — SEATS DEBIT THIS, WINNINGS CREDIT IT, NO POPUPS BETWEEN"
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {walletReady &&
              DEPOSIT_CHOICES.map((n) => (
                <button
                  key={String(n)}
                  onClick={() => deposit(n)}
                  disabled={busy !== null}
                  className="chamfer-sm border border-[var(--gold)] px-4 py-2.5 text-xs font-black tracking-[0.12em] text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-black disabled:opacity-40"
                >
                  {busy === `deposit-${n}` ? "PAYING…" : `DEPOSIT ${n}`}
                </button>
              ))}
            {!walletReady && (
              <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--dim)]">
                NO WALLET EXTENSION DETECTED — FREE PLAY STILL WORKS ON /PLAY
              </span>
            )}
            {bank && bank.balance > 0 && bank.address && (
              <button
                onClick={withdraw}
                disabled={busy !== null || bank.withdrawPending}
                className="chamfer-sm bg-[var(--gold)] px-4 py-2.5 text-xs font-black tracking-[0.12em] text-black disabled:opacity-50"
              >
                {bank.withdrawPending ? "SENDING…" : `WITHDRAW ALL · ${bank.balance.toFixed(2)}`}
              </button>
            )}
          </div>
        </div>
        {err && <p className="mt-3 text-sm text-[var(--down)]">{err}</p>}
      </section>

      {/* in vs out, at a glance */}
      {bank && (
        <section className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "DEPOSITED", v: bank.deposited, c: "var(--text)" },
            { label: "SEATS BOUGHT", v: bank.seatsBought, c: "var(--text)" },
            { label: "WINNINGS", v: bank.winnings, c: "var(--up)" },
            { label: "WITHDRAWN", v: bank.withdrawn, c: "var(--gold)" },
          ].map((x) => (
            <div key={x.label} className="chamfer-sm border border-[var(--edge)] px-3 py-2.5" style={{ background: "var(--panel)" }}>
              <p className="text-[9px] font-black tracking-[0.25em] text-[var(--dim)]">{x.label}</p>
              <p className="display tabular mt-0.5 text-xl leading-none sm:text-2xl" style={{ color: x.c }}>
                {x.v.toFixed(2)}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* every movement of real money, newest first */}
      {ledger && ledger.flows.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">CASH FLOW</h2>
          <div className="space-y-1">
            {ledger.flows.map((f, i) => {
              const sign = f.kind === "deposit" || f.kind === "win" ? 1 : -1;
              const label = { deposit: "DEPOSIT", win: "RUN PAID OUT", seat: "SEAT", withdrawal: "WITHDRAWAL" }[f.kind] ?? f.kind;
              return (
                <div key={i} className="chamfer-sm flex items-center justify-between border border-[var(--edge)] px-4 py-2 text-sm" style={{ background: "var(--panel)" }}>
                  <span className="flex items-center gap-3">
                    <span className="text-[10px] font-black tracking-[0.2em] text-[var(--dim)]">{label}</span>
                    {f.tx && (
                      <a href={`https://shannon-explorer.somnia.network/tx/${f.tx}`} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-[var(--gold)] underline decoration-dotted">
                        TX ↗
                      </a>
                    )}
                  </span>
                  <span className="tabular font-black" style={{ color: sign > 0 ? "var(--up)" : "var(--dim)" }}>
                    {usd(sign * f.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* the game history underneath — same panel as ever */}
      <LedgerPanel ledger={ledger} climber={climber} />
    </main>
  );
}
