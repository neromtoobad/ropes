/**
 * Phase-3 gate: can this wallet actually open an on-chain reactivity
 * subscription, and what does it cost to hold one?
 *
 * The claim in circulation is that a subscription owner must hold a minimum
 * native balance (32 SOM). Nothing in the precompile ABI exposes that as a
 * getter, so the only honest answer is to try it. This SIMULATES the write with
 * eth_call — a funding rule would reject it here, for free, before we send
 * anything.
 *
 *   npx tsx scripts/spike/reactivity.ts
 */
import "dotenv/config";
import { exchange, HOUSE } from "../../src/lib/chain";
import {
  SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS,
  DEFAULT_SUBSCRIPTION_OPTIONS,
} from "@somnia-chain/markets-sdk/reactivity";
import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { toFunctionSelector, encodeFunctionData } from "viem";

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;

const subscribeAbi = [
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
] as const;

const pub = exchange.client.getViemClient();

const gas = await pub.getBalance({ address: HOUSE });
const stt = Number(gas) / 1e18;
console.log(`wallet   ${HOUSE}`);
console.log(`balance  ${stt.toFixed(4)} STT`);
console.log(`claim    a subscription owner must hold 32 of the native token`);
console.log(`headroom ${(stt - 32).toFixed(4)} STT over that claim\n`);

// Subscribe to the module that settles every one of our rounds. The handler is
// a placeholder — we only want to know whether the precompile lets us in.
const data = {
  eventTopics: [ZERO32, ZERO32, ZERO32, ZERO32] as const,
  origin: ZERO_ADDR,
  caller: ZERO_ADDR,
  emitter: SOMNIA_TESTNET_ADDRESSES.binaryModule! as `0x${string}`,
  handlerContractAddress: HOUSE, // placeholder; a real handler lands in phase 3
  handlerFunctionSelector: toFunctionSelector("onEvent(address,bytes32[],bytes)"),
  priorityFeePerGas: DEFAULT_SUBSCRIPTION_OPTIONS.priorityFeePerGas,
  maxFeePerGas: DEFAULT_SUBSCRIPTION_OPTIONS.maxFeePerGas,
  gasLimit: DEFAULT_SUBSCRIPTION_OPTIONS.gasLimit,
  isGuaranteed: false,
  isCoalesced: false,
};

console.log(`precompile   ${SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS}`);
console.log(`emitter      ${data.emitter}  (BinaryMarketsModule)`);
console.log(`selector     ${data.handlerFunctionSelector}\n`);

try {
  const result = await pub.call({
    account: HOUSE,
    to: SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS,
    data: encodeFunctionData({ abi: subscribeAbi, functionName: "subscribe", args: [data] }),
  });
  console.log("SIMULATION PASSED — the precompile accepts a subscribe from this wallet.");
  console.log("returned:", result.data);
  console.log("\nVERDICT: phase 3 is funded. Proceed.");
} catch (err) {
  const msg = String(err);
  console.log("SIMULATION REVERTED\n");
  console.log(msg.slice(0, 900));
  const funding = /balance|fund|insufficient|minimum|stake/i.test(msg);
  console.log(
    `\nVERDICT: ${funding ? "looks like a FUNDING rule — phase 3 is at risk." : "not obviously a funding rule; likely the placeholder handler. Re-run in phase 3 with a real deployed handler."}`,
  );
}
process.exit(0);
