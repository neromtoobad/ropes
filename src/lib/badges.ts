/**
 * Badges — computed, never stored. The ledger already remembers everything a
 * badge could honor, so awarding them is a pure function of a player's runs.
 * No migration, no backfill, no way for a badge to disagree with the record.
 */
import { toUsd } from "./chain";

type Pos = {
  outcome: string | null;
  priceRaw: bigint;
  stackAfter: bigint | null;
  round: { index: number };
};
type RunWithPositions = {
  status: string;
  buyIn: bigint;
  stack: bigint;
  finalMultiple: number | null;
  roundsSurvived: number;
  payoutTx: string | null;
  positions: Pos[];
};

export type Badge = { id: string; icon: string; label: string; hint: string };

export const BADGES: Badge[] = [
  { id: "first-blood", icon: "🩸", label: "FIRST BLOOD", hint: "win a round" },
  { id: "survivor", icon: "🛡", label: "SURVIVOR", hint: "survive 3 rounds in one run" },
  { id: "high-climber", icon: "⛰", label: "HIGH CLIMBER", hint: "reach 5× in a run" },
  { id: "perfect-read", icon: "🎯", label: "PERFECT READ", hint: "win from an entry under 0.25" },
  { id: "diamond-hands", icon: "💎", label: "DIAMOND HANDS", hint: "recover from under 0.4× to above 1×" },
  { id: "cashed-out", icon: "💸", label: "CASHED OUT", hint: "take a real on-chain payout" },
];

export function computeBadges(runs: RunWithPositions[]): Badge[] {
  const earned = new Set<string>();

  for (const r of runs) {
    const buyIn = toUsd(r.buyIn);
    const won = r.positions.filter((p) => p.outcome === "won");
    if (won.length) earned.add("first-blood");
    if (r.roundsSurvived >= 3) earned.add("survivor");

    const peak = Math.max(
      r.finalMultiple ?? 0,
      toUsd(r.stack) / buyIn,
      ...r.positions.map((p) => (p.stackAfter !== null ? toUsd(p.stackAfter) / buyIn : 0)),
    );
    if (peak >= 5) earned.add("high-climber");

    if (won.some((p) => toUsd(p.priceRaw) < 0.25)) earned.add("perfect-read");

    // Diamond hands: the run dipped under 0.4× at some bell and still ended
    // (or currently stands) above 1×.
    const ordered = [...r.positions].sort((a, b) => a.round.index - b.round.index);
    const dipAt = ordered.findIndex(
      (p) => p.stackAfter !== null && toUsd(p.stackAfter) / buyIn < 0.4,
    );
    if (dipAt >= 0) {
      const recovered =
        ordered.slice(dipAt + 1).some((p) => p.stackAfter !== null && toUsd(p.stackAfter) / buyIn > 1) ||
        (r.status !== "eliminated" && toUsd(r.stack) / buyIn > 1);
      if (recovered) earned.add("diamond-hands");
    }

    if (r.payoutTx && r.payoutTx.startsWith("0x")) earned.add("cashed-out");
  }

  return BADGES.filter((b) => earned.has(b.id));
}
