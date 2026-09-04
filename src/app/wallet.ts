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
  parseAbi,
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
 * A phone with no injected wallet — the single biggest way "connect" fails.
 *
 * Mobile browsers have no extensions, so Safari/Chrome on a phone injects
 * nothing and the site can only offer free play. Every major mobile wallet
 * ships its own in-app browser and a universal link that reopens the current
 * page inside it, where a provider IS injected and everything works. This is
 * the difference between a dead end and one tap.
 */
export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Universal links that reopen THIS page inside a wallet's own browser. */
export function walletDeepLinks(): { name: string; href: string }[] {
  if (typeof window === "undefined") return [];
  const url = window.location.href;
  const bare = url.replace(/^https?:\/\//, ""); // MetaMask wants host+path, no scheme
  return [
    { name: "MetaMask", href: `https://metamask.app.link/dapp/${bare}` },
    { name: "Coinbase Wallet", href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
    { name: "Trust", href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}` },
    { name: "Rainbow", href: `https://rnbwapp.com/dapp/${bare}` },
  ];
}

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

/**
 * Re-attach to a wallet that has ALREADY authorized this site.
 *
 * `addr` is component state, so every reload — and every hop between /play and
 * /wallet — used to forget the connection and show CONNECT again, which reads
 * as "my wallet disconnected itself" mid-session. The authorization never went
 * anywhere: an approved site gets its account back from `eth_accounts` with no
 * popup at all. This asks silently and stays null when the answer is empty, so
 * it can run on mount without ever prompting anyone.
 */
export async function restoreConnection(): Promise<Address | null> {
  const w = activeWallet();
  if (!w) return null;
  const accounts = (await w.provider
    .request({ method: "eth_accounts" })
    .catch(() => [])) as Address[];
  return accounts?.length ? accounts[0] : null;
}

/**
 * The connected account, restored on mount and kept in step with the wallet.
 *
 * A wallet can switch accounts or lock itself while the page is open; without
 * `accountsChanged` the UI would keep naming an address that is no longer the
 * one that would sign. `wallets().length` is a dep because EIP-6963 providers
 * announce asynchronously — on a cold load there is nothing to ask yet.
 */
export function useAccount(): [Address | null, (a: Address | null) => void] {
  const [addr, setAddr] = useState<Address | null>(null);
  const found = useWallets().length;

  useEffect(() => {
    let dead = false;
    void restoreConnection().then((a) => {
      if (!dead && a) setAddr(a);
    });

    const w = activeWallet();
    const provider = w?.provider as (Eip1193 & {
      on?: (e: string, cb: (v: unknown) => void) => void;
      removeListener?: (e: string, cb: (v: unknown) => void) => void;
    }) | undefined;
    const onAccounts = (v: unknown) => {
      const list = v as Address[];
      setAddr(list?.length ? list[0] : null);
    };
    provider?.on?.("accountsChanged", onAccounts);
    return () => {
      dead = true;
      provider?.removeListener?.("accountsChanged", onAccounts);
    };
  }, [found]);

  return [addr, setAddr];
}

/** Somnia Shannon as the wallet RPCs want it: chainId hex, 50312. */
const CHAIN_HEX = "0xc488";
const ADD_CHAIN_PARAMS = {
  chainId: CHAIN_HEX,
  chainName: CHAIN.name,
  nativeCurrency: CHAIN.nativeCurrency,
  rpcUrls: CHAIN.rpcUrls.default.http as unknown as string[],
  blockExplorerUrls: [CHAIN.blockExplorers.default.url],
};

/** EIP-1193 errors carry a numeric code; 4001 is "user rejected". */
function errCode(e: unknown): number | undefined {
  const c = (e as { code?: unknown })?.code;
  return typeof c === "number" ? c : undefined;
}

/**
 * Put the wallet on Somnia Shannon.
 *
 * The switch/add dance is EIP-3326 + EIP-3085 and the codes matter. The old
 * version called `wallet_addEthereumChain` on ANY switch failure, so declining
 * the switch immediately raised a SECOND prompt to add a chain the wallet
 * already had — two popups for one refusal, which reads as a broken button.
 * 4902 (and some wallets' 4901/-32603) is the only error that means "I don't
 * know this chain"; a rejection is final and says so.
 */
async function ensureChain(provider: Eip1193) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_HEX }],
    });
    return;
  } catch (e) {
    const code = errCode(e);
    if (code === 4001) throw new Error("you declined the switch to Somnia Shannon — the game needs that network");
    // Unknown chain: add it. Adding also switches on every wallet we have seen.
    try {
      await provider.request({ method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] });
    } catch (addErr) {
      if (errCode(addErr) === 4001) throw new Error("you declined adding Somnia Shannon — the game needs that network");
      throw new Error("could not add Somnia Shannon to this wallet. add it manually: chain 50312, rpc api.infra.testnet.somnia.network");
    }
  }
}

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
  let accounts = known as Address[];
  if (!accounts?.length) {
    try {
      accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
    } catch (e) {
      if (errCode(e) === 4001) throw new Error("you declined the connection request");
      // -32002: a previous request is still sitting unanswered in the wallet.
      if (errCode(e) === -32002) throw new Error("your wallet already has a connection request open — approve it there");
      throw e;
    }
  }
  if (!accounts?.length) throw new Error("no account authorized");
  await ensureChain(provider);
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

/**
 * TestUSDC's own faucet. `faucet(amount)` mints to msg.sender, so the PLAYER's
 * wallet calls it and the house pays nothing — no drip endpoint, no rate limit,
 * and no second writer racing the executor for the house wallet's nonce.
 *
 * 10,000 is the SDK's default and the largest round number the contract
 * accepts; 100,000 reverts. The call costs ~80k gas (~0.0005 STT), which is
 * the one thing we cannot hand out — see the STT note on the wallet page.
 */
const faucetAbi = parseAbi(["function faucet(uint256 amount)"]);
export const FAUCET_TUSDC = 10_000n * 1_000_000n;

export async function mintTestUsdc(account: Address, collateral: Address): Promise<`0x${string}`> {
  const w = activeWallet();
  if (!w) throw new Error("no wallet in this browser");
  const wallet = createWalletClient({ account, chain: CHAIN, transport: custom(w.provider) });
  const hash = await wallet.writeContract({
    address: collateral,
    abi: faucetAbi,
    functionName: "faucet",
    args: [FAUCET_TUSDC],
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error("faucet reverted");
  return hash;
}

/** Native STT, so an empty tank is named as such instead of surfacing as a
 *  wallet's own opaque "insufficient funds" popup. */
export async function gasBalance(account: Address): Promise<bigint> {
  return publicClient().getBalance({ address: account });
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
