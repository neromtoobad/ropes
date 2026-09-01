"use client";

/**
 * The player's own wallet, in the browser. Used for exactly two things:
 * paying 10 tUSDC for a seat, and being the address the executor pays back.
 * No signatures during play — the 1-minute cadence is custodial by design.
 *
 * Plain viem over window.ethereum. No connector library: one chain, one
 * token, two calls.
 */
import { useEffect, useState } from "react";
import { depositMessage } from "@/lib/depositMessage";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  erc20Abi,
  type Address,
} from "viem";

const CHAIN = {
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
  blockExplorers: {
    default: { name: "Shannon Explorer", url: "https://shannon-explorer.somnia.network" },
  },
} as const;

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

type Eip6963 = {
  info: { uuid: string; name: string; rdns: string; icon: string };
  provider: Eip1193;
};

/**
 * Which wallet do we actually talk to?
 *
 * `window.ethereum` is a single slot that EVERY extension writes to, so with
 * more than one installed the last writer wins and clicking "connect" can
 * silently drive a wallet the player never meant to use — or one that answers
 * nothing at all, which is what "the popup never showed" looks like from the
 * outside. EIP-6963 fixes that: wallets announce themselves individually, so
 * we can name them, let the player choose, and hold a real reference instead
 * of hoping about a global.
 */
const announced = new Map<string, Eip6963>();

function collect() {
  if (typeof window === "undefined") return;
  window.addEventListener("eip6963:announceProvider", (e) => {
    const d = (e as CustomEvent<Eip6963>).detail;
    if (d?.info?.uuid) announced.set(d.info.uuid, d);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
collect();

export type WalletChoice = { id: string; name: string; provider: Eip1193 };

/** Every wallet in this browser: the ones that announced, plus the legacy
 *  global if it is something none of them claimed. */
export function wallets(): WalletChoice[] {
  const found: WalletChoice[] = [...announced.values()].map((a) => ({
    id: a.info.uuid,
    name: a.info.name,
    provider: a.provider,
  }));
  const legacy = typeof window !== "undefined"
    ? (window as { ethereum?: Eip1193 & { isMetaMask?: boolean } }).ethereum
    : undefined;
  if (legacy && !found.some((f) => f.provider === legacy)) {
    found.push({ id: "legacy", name: legacy.isMetaMask ? "MetaMask" : "Browser wallet", provider: legacy });
  }
  return found;
}

export const hasWallet = () => wallets().length > 0;

/**
 * Which wallet to reach for when the player has not said.
 *
 * Every EIP-1193 wallet works here — this only decides the DEFAULT guess.
 * Somnia Shannon is a custom EVM testnet the wallet has to add on the fly,
 * which the EVM-native wallets handle cleanly. Keplr and Phantom announce
 * themselves too but are Cosmos- and Solana-first, so they sort last rather
 * than being silently picked for an EVM chain they may refuse to add.
 */
const PREFERRED = [/metamask/i, /rabby/i, /okx/i, /coinbase/i, /brave/i, /trust/i, /zerion/i, /rainbow/i, /frame/i, /enkrypt/i, /taho/i];
const LAST_RESORT = [/keplr/i, /phantom/i, /leap/i, /xverse/i];

export function walletRank(name: string): number {
  const preferred = PREFERRED.findIndex((r) => r.test(name));
  if (preferred >= 0) return preferred;
  if (LAST_RESORT.some((r) => r.test(name))) return 100;
  return 50; // an EVM wallet we simply have not heard of — still fine
}

let chosen: string | null = null;
export function chooseWallet(id: string) {
  chosen = id;
}
export function activeWallet(): WalletChoice | null {
  const all = wallets();
  if (!all.length) return null;
  const picked = all.find((w) => w.id === chosen);
  if (picked) return picked;
  return [...all].sort((a, b) => walletRank(a.name) - walletRank(b.name))[0];
}

/**
 * Is there a wallet in this browser? Asked continuously, not once.
 *
 * Extensions inject at unpredictable times — MetaMask frequently lands AFTER
 * first paint, more so when several wallets race — so a one-shot check on
 * mount reports "no wallet detected" forever to someone staring at their own
 * MetaMask, and the connect button never appears. Re-check on the events
 * wallets fire, and poll briefly for the ones that fire neither.
 */
export function useWallets() {
  const [list, setList] = useState<WalletChoice[]>([]);
  useEffect(() => {
    const sync = () => {
      const next = wallets();
      setList((prev) =>
        prev.length === next.length && prev.every((p, i) => p.id === next[i].id) ? prev : next,
      );
    };
    sync();
    window.addEventListener("ethereum#initialized", sync);
    window.addEventListener("eip6963:announceProvider", sync);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const poll = setInterval(sync, 250);
    const giveUp = setTimeout(() => clearInterval(poll), 8000);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
      window.removeEventListener("ethereum#initialized", sync);
      window.removeEventListener("eip6963:announceProvider", sync);
    };
  }, []);
  return list;
}

export function useHasWallet() {
  return useWallets().length > 0;
}

/** Reads go straight to the RPC, never through the wallet — a wallet that is
 *  on the wrong chain would otherwise answer balance reads from it. */
const publicClient = () => createPublicClient({ chain: CHAIN, transport: http() });

/** Connect and land on Somnia Shannon, adding the chain if the wallet lacks it. */
export async function connect(): Promise<Address> {
  const w = activeWallet();
  if (!w) throw new Error("no wallet in this browser");
  const provider = w.provider;

  /* Ask SILENTLY first. A site the wallet has already approved answers
   * eth_accounts immediately and shows no popup at all — waiting on
   * eth_requestAccounts there looks exactly like a dead button and a popup
   * that never comes. */
  const known = (await provider
    .request({ method: "eth_accounts" })
    .catch(() => [])) as Address[];
  const accounts = known?.length
    ? known
    : ((await provider.request({ method: "eth_requestAccounts" })) as Address[]);
  if (!accounts?.length) throw new Error("no account authorized");
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xc488" }], // 50312
    });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0xc488",
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: CHAIN.rpcUrls.default.http,
          blockExplorerUrls: [CHAIN.blockExplorers.default.url],
        },
      ],
    });
  }
  return accounts[0];
}

/**
 * Pay for the seat: a plain ERC-20 transfer of 10 tUSDC to the house.
 * Resolves once the transfer is MINED — the server verifies the receipt, so
 * handing it an unmined hash would just bounce.
 */
export async function paySeat(
  account: Address,
  collateral: Address,
  house: Address,
  amount: bigint,
): Promise<`0x${string}`> {
  const w = activeWallet();
  if (!w) throw new Error("no wallet in this browser");
  const wallet = createWalletClient({ account, chain: CHAIN, transport: custom(w.provider) });
  const hash = await wallet.writeContract({
    address: collateral,
    abi: erc20Abi,
    functionName: "transfer",
    args: [house, amount],
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error("seat payment reverted");
  return hash;
}

/**
 * Prove the deposit is ours. The server only credits a transfer to a player
 * key when the wallet that SENT it signs for that key — otherwise anyone who
 * can read the explorer could claim any deposit. One popup, no gas.
 */
export async function signDeposit(account: Address, txHash: `0x${string}`, playerKey: string) {
  const w = activeWallet();
  if (!w) throw new Error("no wallet in this browser");
  const wallet = createWalletClient({ account, chain: CHAIN, transport: custom(w.provider) });
  return wallet.signMessage({ message: depositMessage(txHash, playerKey) });
}

/** The player's tUSDC balance, for the "can you even afford a seat" check. */
export async function collateralBalance(account: Address, collateral: Address): Promise<bigint> {
  return publicClient().readContract({
    address: collateral,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
}
