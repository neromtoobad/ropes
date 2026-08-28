"use client";

/** The board: everyone who ever sat down, ranked by lifetime net gain. */
import { useEffect, useState } from "react";
import { LeadersPanel, PageHeader, usePlayerKey, useLedger, useClimberTheme, type LeaderRow } from "../shared";

export default function Leaders() {
  useClimberTheme();
  const playerKey = usePlayerKey();
  const ledger = useLedger(playerKey);
  const [rows, setRows] = useState<LeaderRow[] | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/leaderboard")
        .then((r) => r.json())
        .then((j) => setRows(j.rows))
        .catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-4xl px-4 py-4">
      <PageHeader title="THE BOARD" />
      <LeadersPanel rows={rows} myName={ledger?.name ?? null} />
    </main>
  );
}
