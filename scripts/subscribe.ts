/**
 * Point Somnia's reactivity precompile at the ArenaRegistry.
 *
 * After this runs, every BinarySettlement.MarketFinalized event calls
 * ArenaRegistry.onEvent in the SAME BLOCK — no keeper, no cron, no listener.
 *
 *   REGISTRY=0x... npx tsx scripts/subscribe.ts
 */
import "dotenv/config";
import { exchange, HOUSE } from "../src/lib/chain";
import { SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS, DEFAULT_SUBSCRIPTION_OPTIONS } from "@somnia-chain/markets-sdk/reactivity";
import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createWalletClient, http, toEventSelector, toFunctionSelector, encodeFunctionData, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const REGISTRY = (process.env.REGISTRY ?? "").trim() as `0x${string}`;
if (!REGISTRY) throw new Error("set REGISTRY=0x...");

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;

/** The event that finalises a market and carries the outcome in its payload. */
const TOPIC0 = toEventSelector("MarketFinalized(uint256,address,uint64,address,uint256,bool,uint256[])");
const HANDLER = toFunctionSelector("onEvent(address,bytes32[],bytes)");
const SETTLEMENT = SOMNIA_TESTNET_ADDRESSES.binarySettlement! as `0x${string}`;

const precompileAbi = [
  {
    type: "function",
    name: "subscribe",
    stateMutability: "payable",
    inputs: [
      {
        name: "subscriptionData",
        type: "tuple",
        components: [
          { name: "eventTopics", type: "bytes32[4]" },
          { name: "origin", type: "address" },
          { name: "caller", type: "address" },
          { name: "emitter", type: "address" },
          { name: "handlerContractAddress", type: "address" },
          { name: "handlerFunctionSelector", type: "bytes4" },
          { name: "priorityFeePerGas", type: "uint64" },
          { name: "maxFeePerGas", type: "uint64" },
          { name: "gasLimit", type: "uint64" },
          { name: "isGuaranteed", type: "bool" },
          { name: "isCoalesced", type: "bool" },
        ],
      },
    ],
    outputs: [{ name: "subscriptionId", type: "uint256" }],
  },
  {
    type: "event",
    name: "SubscriptionCreated",
    inputs: [{ name: "subscriptionId", type: "uint256", indexed: true }],
    anonymous: false,
  },
] as const;

const registryAbi = [
  { type: "function", name: "setSubscriptionId", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const pub = exchange.client.getViemClient();
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: somniaShannon, transport: http("https://api.infra.testnet.somnia.network") });

// Deploying with the wrong owner would leave the executor unable to write.
const code = await pub.getCode({ address: REGISTRY });
if (!code || code === "0x") throw new Error(`no contract at ${REGISTRY}`);
const owner = await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: "owner" });
console.log(`registry   ${REGISTRY}`);
console.log(`owner      ${owner}${owner.toLowerCase() === HOUSE.toLowerCase() ? "  (the executor)" : "  ** NOT the executor **"}`);
console.log(`emitter    ${SETTLEMENT}  BinarySettlement`);
console.log(`topic0     ${TOPIC0}`);
console.log(`handler    ${HANDLER}  onEvent(address,bytes32[],bytes)\n`);

const subscriptionData = {
  // Match on the event signature only; the handler filters by round itself.
  eventTopics: [TOPIC0, ZERO32, ZERO32, ZERO32] as readonly [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`],
  origin: ZERO_ADDR,
  caller: ZERO_ADDR,
  emitter: SETTLEMENT,
  handlerContractAddress: REGISTRY,
  handlerFunctionSelector: HANDLER,
  ...DEFAULT_SUBSCRIPTION_OPTIONS,
  isGuaranteed: false,
  isCoalesced: false,
};

const data = encodeFunctionData({ abi: precompileAbi, functionName: "subscribe", args: [subscriptionData] });

// Somnia's gas schedule is dear and the SDK never estimates — a foundry-sized
// estimate is what made the first two deploys run out of gas.
const hash = await wallet.sendTransaction({
  to: SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS,
  data,
  gas: 5_000_000n,
});
console.log("subscribe tx", hash);
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log("status      ", receipt.status);
if (receipt.status === "reverted") throw new Error("subscribe reverted");

let subId: bigint | null = null;
for (const log of receipt.logs) {
  try {
    const parsed = decodeEventLog({ abi: precompileAbi, data: log.data, topics: log.topics });
    if (parsed.eventName === "SubscriptionCreated") subId = (parsed.args as { subscriptionId: bigint }).subscriptionId;
  } catch { /* not ours */ }
}
console.log("subscription", subId?.toString() ?? "(not in logs)");

if (subId !== null) {
  const h2 = await wallet.sendTransaction({
    to: REGISTRY,
    data: encodeFunctionData({ abi: registryAbi, functionName: "setSubscriptionId", args: [subId] }),
    gas: 500_000n,
  });
  await pub.waitForTransactionReceipt({ hash: h2 });
  console.log("recorded on the registry:", h2);
}

console.log("\nLive. Every MarketFinalized now calls ArenaRegistry.onEvent in the same block.");
process.exit(0);
