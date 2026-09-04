"use client";

/**
 * The wallet: your bankroll's home. Deposit once, play forever, withdraw
 * whenever. Everything here is a flag or a read — the executor moves the
 * actual money (one-nonce rule).
 */
import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { TableState } from "@/lib/state";
import { useWallets, useAccount, chooseWallet, walletRank, connect, paySeat, collateralBalance, signDeposit, mintTestUsdc, gasBalance, FAUCET_TUSDC } from "../wallet";
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
  const [addr, setAddr] = useAccount();
  const [minted, setMinted] = useState<number | null>(null);
  const found = useWallets();
  const walletReady = found.length > 0;
  const [picked, setPicked] = useState<string | null>(null);
  // A request the wallet never surfaced looks identical to a dead button —
  // say so rather than spinning forever.
  const [hint, setHint] = useState<string | null>(null);
  const active =
    found.find((w) => w.id === picked) ??
    [...found].sort((a, b) => walletRank(a.name) - walletRank(b.name))[0];
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("lc.climber");
    if (saved && CAST.some((c) => c.id === saved)) setClimber(saved as ClimberId);
    fetch("/api/state").then((r) => r.json()).then(setState).catch(() => {});
    // A pending withdrawal resolves within a tick or two — keep the page live.
    const id = setInterval(() => setRefresh((n) => n + 1), 4000);
    return () => clearInterval(id);
  }, []);

  const bank = ledger?.bank ?? null;

  /** Connect on its own, so "connect wallet" is a thing you can SEE and do —
   *  the deposit buttons connect implicitly, which left players who just
   *  wanted to link a wallet with nothing to click. */
  const connectWallet = async () => {
    if (busy) return;
    setBusy("connect");
    setErr(null);
    setHint(null);
    const slow = setTimeout(
      () => setHint("STILL WAITING — OPEN YOUR WALLET EXTENSION, THE REQUEST MAY BE QUEUED THERE"),
      6000,
    );
    try {
      setAddr(await connect());
      setHint(null);
    } catch (e) {
      setErr(String(e).replace("Error: ", "").slice(0, 160));
      setHint(null);
    }
    clearTimeout(slow);
    setBusy(null);
  };

  const deposit = async (amount: bigint) => {
    if (!state?.pay || !playerKey || busy) return;
    setBusy(`deposit-${amount}`);
    setErr(null);
    try {
      const a = addr ?? (await connect());
      setAddr(a);
      const units = amount * 1_000_000n;
      const bal = await collateralBalance(a, state.pay.collateral as Address);
      if (bal < units) throw new Error(`not enough tUSDC — you hold ${(Number(bal) / 1e6).toFixed(2)}. tap GET TEST tUSDC first, it is free`);
      const tx = await paySeat(a, state.pay.collateral as Address, state.pay.house as Address, units);
      const signature = await signDeposit(a, tx, playerKey);
      const r = await fetch("/api/deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerKey, txHash: tx, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setRefresh((n) => n + 1);
    } catch (e) {
      setErr(String(e).replace("Error: ", "").slice(0, 160));
    }
    setBusy(null);
  };

  /**
   * Claim test collateral. TestUSDC mints to whoever calls it, so this is the
   * player's own wallet doing the minting — the house funds nothing and there
   * is no queue. Gas is the one thing we cannot supply, so an empty tank is
   * named plainly rather than left to the wallet's own popup.
   */
  const claimTestUsdc = async () => {
    if (!state?.pay || busy) return;
    setBusy("faucet");
    setErr(null);
    try {
      const a = addr ?? (await connect());
      setAddr(a);
      if ((await gasBalance(a)) === 0n) {
        throw new Error("this wallet has no STT for gas — get some from the Somnia testnet hub first");
      }
      await mintTestUsdc(a, state.pay.collateral as Address);
      setMinted(Number(FAUCET_TUSDC) / 1e6);
      setTimeout(() => setMinted(null), 6000);
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
            {walletReady && !addr && (
              <button
                onClick={connectWallet}
                disabled={busy !== null}
                className="chamfer-sm border border-[var(--gold)] px-4 py-2.5 text-xs font-black tracking-[0.12em] text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-black disabled:opacity-40"
              >
                {busy === "connect" ? "CONNECTING…" : `CONNECT ${active?.name.toUpperCase() ?? "WALLET"}`}
              </button>
            )}
            {addr && (
              <span className="tabular text-[10px] font-bold tracking-[0.2em] text-[var(--dim)]">
                CONNECTED {short(addr)}
              </span>
            )}
            {walletReady && (
              <button
                onClick={claimTestUsdc}
                disabled={busy !== null}
                className="chamfer-sm border border-[var(--up)] px-4 py-2.5 text-xs font-black tracking-[0.12em] text-[var(--up)] transition hover:bg-[var(--up)] hover:text-black disabled:opacity-40"
              >
                {busy === "faucet" ? "MINTING…" : "GET TEST tUSDC · FREE"}
              </button>
            )}
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
              <span className="max-w-sm text-[10px] font-bold leading-relaxed tracking-[0.15em] text-[var(--dim)]">
                NO WALLET IN THIS BROWSER. OPEN THIS PAGE IN THE BROWSER — OR CHROME PROFILE —
                WHERE YOURS LIVES, OR{" "}
                <a
                  href="https://metamask.io/download/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted hover:text-[var(--gold)]"
                >
                  INSTALL METAMASK
                </a>
                . ON A PHONE, OPEN IT INSIDE YOUR WALLET&apos;S OWN BROWSER. FREE PLAY WORKS EITHER WAY.
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
        {found.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] font-black tracking-[0.25em] text-[var(--dim)]">USE</span>
            {found.map((w) => {
              const isActive = active?.id === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => {
                    setPicked(w.id);
                    chooseWallet(w.id);
                  }}
                  className="chamfer-sm border px-2.5 py-1 text-[10px] font-black tracking-[0.12em] transition"
                  style={{
                    borderColor: isActive ? "var(--gold)" : "var(--edge)",
                    color: isActive ? "var(--gold)" : "var(--dim)",
                    background: isActive ? "#241c07" : "transparent",
                  }}
                >
                  {w.name.toUpperCase()}
                </button>
              );
            })}
          </div>
        )}
        {walletReady && (
          <p className="mt-2 text-[9px] font-bold leading-relaxed tracking-[0.2em] text-[var(--dim)]">
            DETECTED: {found.map((w) => w.name).join(" · ")}
            <br />
            ANY EVM WALLET WORKS ON SOMNIA SHANNON —{" "}
            {[
              ["METAMASK", "https://metamask.io/download/"],
              ["RABBY", "https://rabby.io/"],
              ["OKX", "https://web3.okx.com/download"],
            ].map(([label, href], i) => (
              <span key={label}>
                {i > 0 ? " · " : ""}
                <a href={href} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-[var(--gold)]">
                  {label}
                </a>
              </span>
            ))}
          </p>
        )}
        {hint && <p className="mt-2 text-[10px] font-bold tracking-[0.15em] text-[var(--gold)]">{hint}</p>}
        {minted !== null && (
          <p className="mt-3 text-sm font-bold text-[var(--up)]">
            MINTED {minted.toLocaleString()} tUSDC TO YOUR WALLET — NOW DEPOSIT WHAT YOU WANT TO PLAY WITH.
          </p>
        )}
        {walletReady && (
          <p className="mt-3 max-w-2xl text-[10px] font-bold leading-relaxed tracking-[0.15em] text-[var(--dim)]">
            TEST tUSDC IS FREE AND UNLIMITED — IT IS THE COLLATERAL EVERY ROUND TRADES AGAINST. YOU
            STILL NEED A LITTLE STT FOR GAS (ABOUT 0.0005 PER TRANSACTION), WHICH ONLY SOMNIA CAN
            ISSUE — GET IT FROM THE{" "}
            <a
              href="https://testnet.somnia.network"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted hover:text-[var(--gold)]"
            >
              SOMNIA TESTNET HUB
            </a>
            . NO WALLET AND NO STT? THE FREE SEAT PLAYS THE SAME REAL MARKETS ON THE HOUSE.
          </p>
        )}
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
