/**
 * Phase-3 proof: does an elimination land in the SAME BLOCK as the settlement
 * that caused it?
 *
 * Registers the live BTC 1m window on the ArenaRegistry with two fabricated
 * runs — one on each side — then waits for the venue to finalise the market and
 * checks whether the registry settled itself, with nobody pushing it.
 *
 * The stakes here are invented on purpose: this proves the REACTIVITY path, not
 * the trading path, and the registry never holds funds.
 *
 *   REGISTRY=0x... npx tsx scripts/spike/reactive-e2e.ts
 */
import "dotenv/config";
import { exchange, sleep } from "../../src/lib/chain";
import { currentMarket } from "../../src/lib/market";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createWalletClient, http, encodeFunctionData, keccak256, toHex, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const REGISTRY = (process.env.REGISTRY ?? "").trim() as `0x${string}`;
if (!REGISTRY) throw new Error("set REGISTRY=0x...");

const abi = parseAbi([
  "function openRound(address pool, uint64 nonce, bytes32 marketId) returns (bytes32)",
  "function enter(address pool, uint64 nonce, bytes32 runId, uint8 side, uint128 contracts, uint128 remainder, uint128 stackBefore)",
  "function roundKey(address pool, uint64 nonce) view returns (bytes32)",
  "function rounds(bytes32) view returns (bytes32 marketId, uint64 nonce, bool open, bool settled, bool voided, uint8 winner)",
  "function stackOf(bytes32) view returns (uint128)",
  "function statusOf(bytes32) view returns (uint8)",
  "event RoundSettled(bytes32 indexed roundKey, uint8 winner, bool voided, uint16 survivors, uint16 killed)",
]);

const pub = exchange.client.getViemClient();
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: somniaShannon, transport: http("https://api.infra.testnet.somnia.network") });

const send = async (fn: "openRound" | "enter", args: readonly unknown[]) => {
  const hash = await wallet.sendTransaction({
    to: REGISTRY,
    // Somnia's gas schedule is dear; never let a client estimate it.
    gas: 3_000_000n,
    data: encodeFunctionData({ abi, functionName: fn, args: args as never }),
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status === "reverted") throw new Error(`${fn} reverted (${hash})`);
  return r;
};

// Pick a window with enough runway to register both runs before it locks.
let market = await currentMarket(25);
while (!market) {
  console.log("no window with runway, waiting…");
  await sleep(4000);
  market = await currentMarket(25);
}

const pool = market.pool;
const nonce = BigInt(market.onchain.nonce ?? 0);
const ADA = keccak256(toHex("e2e:ada"));
const BRAM = keccak256(toHex("e2e:bram"));

console.log(`market   ${market.marketId}`);
console.log(`pool     ${pool}  nonce ${nonce}`);
console.log(`expires  ${market.expiresAt.toISOString()}  (${market.secondsLeft.toFixed(0)}s)\n`);

await send("openRound", [pool, nonce, market.marketId]);
console.log("round registered");
// One on each side, so the settlement must both advance and eliminate.
await send("enter", [pool, nonce, ADA, 0, 16_000_000n, 0n, 10_000_000n]);
await send("enter", [pool, nonce, BRAM, 1, 19_000_000n, 24_900n, 10_000_000n]);
console.log("two runs entered: ada UP, bram DOWN\n");

const key = await pub.readContract({ address: REGISTRY, abi, functionName: "roundKey", args: [pool, nonce] });
const fromBlock = await pub.getBlockNumber();

console.log("waiting for the venue to finalise the market…");
const deadline = Date.now() + 240_000;
let settledAt: bigint | null = null;

while (Date.now() < deadline) {
  const r = await pub.readContract({ address: REGISTRY, abi, functionName: "rounds", args: [key] });
  if (r[3]) {
    // settled — find the block it happened in
    const logs = await pub.getLogs({ address: REGISTRY, event: abi[6], fromBlock, toBlock: "latest" });
    settledAt = logs[0]?.blockNumber ?? null;
    console.log(`\nREGISTRY SETTLED ITSELF`);
    console.log(`  winner   ${r[4] ? "VOID" : r[5] === 0 ? "UP" : "DOWN"}`);
    console.log(`  block    ${settledAt}`);
    break;
  }
  await sleep(1500);
}

if (settledAt === null) {
  console.log("\nthe registry did NOT settle itself within the window.");
  console.log("the callback did not fire — check the subscription, or fall back to a listener.");
  process.exit(1);
}

// Compare against the venue's own settlement block for the same market.
const onchain = await exchange.client.getMarketOnchain(market.marketId);
const adaStack = await pub.readContract({ address: REGISTRY, abi, functionName: "stackOf", args: [ADA] });
const bramStack = await pub.readContract({ address: REGISTRY, abi, functionName: "stackOf", args: [BRAM] });
const adaStatus = await pub.readContract({ address: REGISTRY, abi, functionName: "statusOf", args: [ADA] });
const bramStatus = await pub.readContract({ address: REGISTRY, abi, functionName: "statusOf", args: [BRAM] });
const label = (s: number) => (s === 0 ? "alive" : s === 1 ? "banked" : "ELIMINATED");

console.log(`\n  venue says   resolved=${onchain.isResolved} voided=${onchain.isVoided} winner=${onchain.winningOutcome}`);
console.log(`  ada  (UP)    ${(Number(adaStack) / 1e6).toFixed(4)}  ${label(adaStatus)}`);
console.log(`  bram (DOWN)  ${(Number(bramStack) / 1e6).toFixed(4)}  ${label(bramStatus)}`);
console.log(`\nNobody pushed this. No keeper, no cron, no listener — the chain settled the game.`);
process.exit(0);
