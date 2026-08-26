/**
 * The one place that talks to Somnia. Everything verified live on 26 aug —
 * see CLAUDE.md "verified config" before changing any of it.
 */
import "dotenv/config";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Testnet collateral is tUSDC at 6 decimals. Mainnet USDso is 18. Derive, never assume. */
export const DECIMALS = 6;
export const ONE = 10n ** BigInt(DECIMALS);
export const COLLATERAL = SOMNIA_TESTNET_ADDRESSES.collateral! as `0x${string}`;

/** The asset and cadence the game runs on. One market, one clock. */
export const ASSET = "BTC";
export const INTERVAL_SEC = 60;

const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!pk || pk === "0x") throw new Error("PRIVATE_KEY missing from .env");

/** The house executor wallet. Pooled — the database says whose money is whose. */
export const HOUSE = privateKeyToAccount(pk).address;

export const exchange = new SomniaMarkets({
  indexerUrl: process.env.INDEXER_URL ?? "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: process.env.WS_RPC_URL ?? "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
  privateKey: pk,
});

/**
 * Collateral balance of the house wallet.
 * There is no `client.getCollateralBalance` despite what the docs imply — read
 * the ERC-20 directly.
 */
export async function houseCollateral(): Promise<bigint> {
  return exchange.client.getViemClient().readContract({
    address: COLLATERAL,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [HOUSE],
  }) as Promise<bigint>;
}

/** Native STT, for the "am I about to burn gas on reverts" check. */
export async function houseGas(): Promise<bigint> {
  return exchange.client.getViemClient().getBalance({ address: HOUSE });
}

export const toUsd = (raw: bigint) => Number(raw) / Number(ONE);
export const fmtUsd = (raw: bigint) => toUsd(raw).toFixed(4);
export const fmtProb = (raw: bigint) => (Number(raw) / Number(ONE)).toFixed(3);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Snap a raw value down onto a grid step. Below one step this yields 0. */
export const snap = (v: bigint, step: bigint) => (v / step) * step;
