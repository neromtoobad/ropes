/**
 * Tables — the thing that makes LAST CANDLE a game rather than a venue.
 *
 * The market's clock is infinite: a new BTC window opens every minute forever.
 * Left alone that produces a place to trade, not a tournament — nobody ever
 * wins, because "last one standing" needs a field to be last in, and an
 * always-open table never resolves to one.
 *
 * A table fixes that. It fills, SEALS, and then its roster is frozen until one
 * player remains. That player is the champion and takes the pot. Meanwhile the
 * next table is already accepting arrivals, so sealing costs nobody a wait —
 * exactly how a battle-royale queue works.
 */
import { db } from "../lib/db";
import { ONE, fmtUsd } from "../lib/chain";
import * as registry from "../lib/registry";

/** What a seat costs. */
export const SEAT_PRICE = 10n * ONE;
/** Held back from every seat into the pot. You play with the rest. */
export const POT_CUT = 2n * ONE;
/** The stack a run actually starts with, and the basis for its multiple. */
export const STARTING_STACK = SEAT_PRICE - POT_CUT;

export const MAX_SEATS = 8;
/** Below this a table is not a battle royale, so it waits. */
export const MIN_SEATS = 2;
/** How long a table stays open to arrivals before it seals. */
export const FILL_WINDOW_MS = 2 * 60_000;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** The table currently accepting players, created if there isn't one. */
export async function fillingTable() {
  const open = await db.table.findFirst({ where: { status: "filling" } });
  if (open) return open;

  const last = await db.table.findFirst({ orderBy: { index: "desc" } });
  // A table that died with nobody left carries its pot forward rather than
  // stranding it — the money came from players, it goes back to players.
  const orphaned = await db.table.findMany({
    where: { status: "finished", championRunId: null, pot: { gt: 0n } },
  });
  const carried = orphaned.reduce((n, t) => n + t.pot, 0n);
  if (carried > 0n) {
    await db.table.updateMany({
      where: { id: { in: orphaned.map((t) => t.id) } },
      data: { pot: 0n },
    });
  }

  const table = await db.table.create({
    data: {
      index: (last?.index ?? 0) + 1,
      sealsAt: new Date(Date.now() + FILL_WINDOW_MS),
      pot: carried,
    },
  });
  log(`TABLE ${table.index} open${carried > 0n ? `  (carrying ${fmtUsd(carried)} pot)` : ""}`);
  return table;
}

/**
 * Seal the filling table when it is full, or when its window expires with
 * enough players. A short table just keeps waiting — starting a "battle royale"
 * with one person in it is worse than making them wait for a second.
 */
export async function sealIfReady() {
  const table = await db.table.findFirst({ where: { status: "filling" } });
  if (!table) return null;

  const seated = await db.run.count({ where: { tableId: table.id } });
  const full = seated >= MAX_SEATS;
  const expired = table.sealsAt.getTime() <= Date.now();

  if (!full && !(expired && seated >= MIN_SEATS)) {
    // Not ready. Keep the countdown honest rather than showing a stale one.
    if (expired) {
      await db.table.update({
        where: { id: table.id },
        data: { sealsAt: new Date(Date.now() + FILL_WINDOW_MS) },
      });
    }
    return null;
  }

  const sealed = await db.table.update({
    where: { id: table.id },
    data: { status: "sealed", sealedAt: new Date() },
  });
  log(`TABLE ${sealed.index} SEALED  ${seated} players  pot ${fmtUsd(sealed.pot)}`);
  return sealed;
}

/**
 * Resolve any sealed table that has run out of opponents.
 *
 * One survivor is a champion: the run ends there, takes the pot, and goes on
 * the record. Zero survivors means the whole table went out together — nobody
 * takes the pot, and it carries into the next table.
 */
export async function crownChampions() {
  const sealed = await db.table.findMany({ where: { status: "sealed" } });

  for (const table of sealed) {
    const alive = await db.run.findMany({
      where: { tableId: table.id, status: "alive" },
      include: { player: true },
    });

    if (alive.length > 1) continue;

    if (alive.length === 1) {
      const champ = alive[0];
      const finalStack = champ.stack + table.pot;
      await db.run.update({
        where: { id: champ.id },
        data: {
          status: "banked",
          isChampion: true,
          stack: finalStack,
          finalMultiple: Number(finalStack) / Number(champ.buyIn),
        },
      });
      await db.table.update({
        where: { id: table.id },
        data: { status: "finished", finishedAt: new Date(), championRunId: champ.id, pot: 0n },
      });
      // The public log should show a champion, not a quiet exit.
      if (registry.enabled) await registry.bankRun(champ.id, finalStack);
      log(
        `TABLE ${table.index} — 👑 ${champ.player.displayName} LAST STANDING  ` +
          `${fmtUsd(champ.stack)} + ${fmtUsd(table.pot)} pot = ${fmtUsd(finalStack)}`,
      );
    } else {
      await db.table.update({
        where: { id: table.id },
        data: { status: "finished", finishedAt: new Date() },
      });
      log(`TABLE ${table.index} — wiped out, nobody left. pot ${fmtUsd(table.pot)} carries forward`);
    }
  }
}

/** Everything the tick loop needs, in the order it needs it. */
export async function manageTables() {
  await crownChampions();
  await fillingTable();
  await sealIfReady();
}
