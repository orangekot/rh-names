/**
 * Read path: always public RPC (never wallet-injected eth_call).
 * Write path: BrowserProvider + ensureChain for Robinhood 4663.
 */

import { CHAIN } from "./chain.js";

let _readProvider = null;

export function getReadProvider(ethers, cfg = CHAIN) {
  if (!_readProvider) {
    _readProvider = new ethers.JsonRpcProvider(cfg.rpcUrl, cfg.chainId, {
      staticNetwork: true,
    });
  }
  return _readProvider;
}

export function resetReadProvider() {
  _readProvider = null;
}

export async function ensureChain(cfg = CHAIN) {
  if (!window.ethereum) throw new Error("No injected wallet (MetaMask / Brave)");
  const id = await window.ethereum.request({ method: "eth_chainId" });
  if (id.toLowerCase() === cfg.chainIdHex.toLowerCase()) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: cfg.chainIdHex }],
    });
  } catch (e) {
    if (e.code === 4902 || /unrecognized chain/i.test(String(e.message || ""))) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: cfg.chainIdHex,
            chainName: cfg.chainName,
            rpcUrls: [cfg.rpcUrl],
            nativeCurrency: cfg.nativeCurrency,
          },
        ],
      });
    } else {
      throw e;
    }
  }
  const after = await window.ethereum.request({ method: "eth_chainId" });
  if (after.toLowerCase() !== cfg.chainIdHex.toLowerCase()) {
    throw new Error(
      `Wallet still on chain ${after}; switch manually to Robinhood Mainnet (${cfg.chainId})`
    );
  }
}

export async function connectWallet(ethers, cfg = CHAIN) {
  await ensureChain(cfg);
  const browserProvider = new ethers.BrowserProvider(window.ethereum, cfg.chainId);
  await browserProvider.send("eth_requestAccounts", []);
  const signer = await browserProvider.getSigner();
  const account = await signer.getAddress();
  return { browserProvider, signer, account };
}
