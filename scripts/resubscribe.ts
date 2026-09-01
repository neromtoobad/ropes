/**
 * Re-create the reactivity subscription that lets the chain settle the game.
 *
 *   npx tsx scripts/resubscribe.ts            # dry run: shows what would be sent
 *   npx tsx scripts/resubscribe.ts --send     # sends it, prints the id, stores it in .env
 *
 * WHY THIS EXISTS. The precompile only calls a handler while the subscription's
 * owner holds the funding minimum (32 STT). When the house wallet ran dry the
 * callbacks stopped, and the id of the original subscription was never written
 * down anywhere — it had to be dug out of the explorer. This script fixes both:
 * it re-subscribes with the exact parameters of the subscription that was
 * PROVEN live in phase 3 (same emitter, same MarketFinalized topic, same
 * handler and selector), and it records the id in .env as
 * REACTIVITY_SUBSCRIPTION_ID so the next person can just read it.
 *
 * ONE-NONCE RULE: this sends from the house wallet. Stop the executor first.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { toFunctionSelector, parseEther } from "viem";
import { exchange, HOUSE } from "../src/lib/chain";
import { createReactivity, DEFAULT_SUBSCRIPTION_OPTIONS } from "@somnia-chain/markets-sdk/reactivity";

const REGISTRY = process.env.REGISTRY as `0x${string}`;
/** The settlement module that actually emitted MarketFinalized for our proven
 *  subscription (decoded from its SubscriptionCreated receipt) — not the
 *  address the docs name. Trust the receipt. */
const EMITTER = "0xbf4a49e0dfd092e5fbe8e5761064c49533e6ed23" as const;
/** MarketFinalized(...,uint256[] payoutNumerators) as DEPLOYED. The SDK's ABI
 *  implies a different topic that matches nothing, silently. */
const MARKET_FINALIZED = "0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178" as const;
const FUNDING_MIN = parseEther("32");

async function main() {
  const send = process.argv.includes("--send");
  if (!REGISTRY) throw new Error("REGISTRY is not set in .env");
  const pub = exchange.client.getViemClient();
  const bal = await pub.getBalance({ address: HOUSE });
  console.log(`house    ${HOUSE}`);
  console.log(`balance  ${(Number(bal) / 1e18).toFixed(4)} STT   (subscription owner must hold ≥ 32)`);
  console.log(`handler  ${REGISTRY}  selector ${toFunctionSelector("onEvent(address,bytes32[],bytes)")}`);
  console.log(`emitter  ${EMITTER}\ntopic0   ${MARKET_FINALIZED}\n`);
  if (bal < FUNDING_MIN) {
    console.log("STOP: below the 32 STT funding minimum — the precompile will not honour a new subscription either. Top up first.");
    process.exit(2);
  }
  if (!send) { console.log("dry run only. Re-run with --send (with the executor STOPPED) to subscribe."); return; }

  const reactivity = createReactivity(exchange.client);
  const tx = await reactivity.subscribe({
    handlerContractAddress: REGISTRY,
    filter: { emitter: EMITTER, eventTopics: [MARKET_FINALIZED] },
    options: DEFAULT_SUBSCRIPTION_OPTIONS,
  });
  if (tx instanceof Error) throw tx;
  console.log(`subscribe tx ${tx}`);
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  const log = receipt.logs.find((l) => l.address.toLowerCase() === "0x0000000000000000000000000000000000000100");
  if (!log?.topics[1]) throw new Error("no SubscriptionCreated log in the receipt — check the explorer");
  const id = BigInt(log.topics[1]);
  console.log(`subscriptionId ${id} (0x${id.toString(16)})  block ${receipt.blockNumber}`);

  const env = readFileSync(".env", "utf8").replace(/^REACTIVITY_SUBSCRIPTION_ID=.*\n?/m, "");
  writeFileSync(".env", `${env.trimEnd()}\nREACTIVITY_SUBSCRIPTION_ID=${id}\n`);
  console.log("recorded in .env as REACTIVITY_SUBSCRIPTION_ID");
}
main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
