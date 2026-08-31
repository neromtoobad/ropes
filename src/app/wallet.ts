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

export const hasWallet = () =>
  typeof window !== "undefined" && Boolean((window as { ethereum?: Eip1193 }).ethereum);

/**
 * Is there a wallet in this browser? Asked continuously, not once.
 *
 * Extensions inject `window.ethereum` at unpredictable times — MetaMask
 * frequently lands AFTER first paint, and more so when several wallets race
 * to inject. A one-shot check on mount therefore reports "no wallet
 * detected" forever to someone who is staring at their MetaMask fox, and the
 * connect button never appears.
 *
 * So: re-check on both events wallets actually fire (the legacy
 * `ethereum#initialized` and the EIP-6963 announcement, which we also
 * request), and poll briefly as a backstop for wallets that fire neither.
 */
export function useHasWallet() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (hasWallet()) {
      setReady(true);
      return;
    }
    let done = false;
    const check = () => {
      if (done || !hasWallet()) return;
      done = true;
      setReady(true);
    };
    window.addEventListener("ethereum#initialized", check);
    window.addEventListener("eip6963:announceProvider", check);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const poll = setInterval(check, 250);
    const giveUp = setTimeout(() => clearInterval(poll), 8000);
    return () => {
      done = true;
      clearInterval(poll);
      clearTimeout(giveUp);
      window.removeEventListener("ethereum#initialized", check);
      window.removeEventListener("eip6963:announceProvider", check);
    };
  }, []);
  return ready;
}

const eth = () => (window as unknown as { ethereum: Eip1193 }).ethereum;

const publicClient = () => createPublicClient({ chain: CHAIN, transport: http() });

/** Connect and land on Somnia Shannon, adding the chain if the wallet lacks it. */
export async function connect(): Promise<Address> {
  const provider = eth();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
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
  const wallet = createWalletClient({ account, chain: CHAIN, transport: custom(eth()) });
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

/** The player's tUSDC balance, for the "can you even afford a seat" check. */
export async function collateralBalance(account: Address, collateral: Address): Promise<bigint> {
  return publicClient().readContract({
    address: collateral,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
}
