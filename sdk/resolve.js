/**
 * Minimal forward / reverse resolution helpers for RH Phase-1 ENS.
 * Safe to copy into wallets, dApps, or explorers (ethers v6).
 *
 * Prefer the public Robinhood RPC for all reads — do not route eth_call
 * through wallet-injected RPCs on custom L2s when they return empty reverts.
 */
import { PHASE1 } from "./chain.js";
import { PHASE1_ENS_ABI, PHASE1_RESOLVER_ABI, PHASE1_REVERSE_ABI } from "./abis.js";
import { getReadProvider } from "./provider.js";

function normalizeName(nameOrLabel, tld = "rh") {
  let s = String(nameOrLabel || "").trim().toLowerCase();
  if (s.endsWith(`.${tld}`)) s = s.slice(0, -(tld.length + 1));
  if (!s) throw new Error("empty name");
  return `${s}.${tld}`;
}

/**
 * Resolve label.rh → address (null if unset / no resolver).
 * @param {import("ethers").Ethers} ethers
 * @param {string} nameOrLabel e.g. "alice" or "alice.rh"
 * @param {object} [cfg] PHASE1-like config
 */
export async function resolveRhAddress(ethers, nameOrLabel, cfg = PHASE1) {
  const provider = getReadProvider(ethers, cfg);
  const full = normalizeName(nameOrLabel, cfg.tld || "rh");
  const node = ethers.namehash(full);
  const ens = new ethers.Contract(cfg.registry, PHASE1_ENS_ABI, provider);
  const resolverAddr = await ens.resolver(node);
  if (!resolverAddr || /^0x0{40}$/i.test(resolverAddr)) return null;
  const resolver = new ethers.Contract(resolverAddr, PHASE1_RESOLVER_ABI, provider);
  const addr = await resolver.addr(node);
  if (!addr || /^0x0{40}$/i.test(addr)) return null;
  return addr;
}

/**
 * Reverse: address → primary name string (e.g. "alice.rh") or null.
 * @param {import("ethers").Ethers} ethers
 * @param {string} address
 * @param {object} [cfg]
 */
export async function reverseRhName(ethers, address, cfg = PHASE1) {
  const provider = getReadProvider(ethers, cfg);
  const ens = new ethers.Contract(cfg.registry, PHASE1_ENS_ABI, provider);
  const reverse = new ethers.Contract(cfg.reverseRegistrar, PHASE1_REVERSE_ABI, provider);
  const revNode = await reverse.node(address);
  const resolverAddr = await ens.resolver(revNode);
  if (!resolverAddr || /^0x0{40}$/i.test(resolverAddr)) return null;
  const resolver = new ethers.Contract(resolverAddr, PHASE1_RESOLVER_ABI, provider);
  const name = await resolver.name(revNode);
  return name && String(name).trim() ? String(name) : null;
}

/**
 * Read a text record for name.rh.
 */
export async function resolveRhText(ethers, nameOrLabel, key, cfg = PHASE1) {
  const provider = getReadProvider(ethers, cfg);
  const full = normalizeName(nameOrLabel, cfg.tld || "rh");
  const node = ethers.namehash(full);
  const ens = new ethers.Contract(cfg.registry, PHASE1_ENS_ABI, provider);
  const resolverAddr = await ens.resolver(node);
  if (!resolverAddr || /^0x0{40}$/i.test(resolverAddr)) return "";
  const resolver = new ethers.Contract(resolverAddr, PHASE1_RESOLVER_ABI, provider);
  try {
    return (await resolver.text(node, key)) || "";
  } catch {
    return "";
  }
}
