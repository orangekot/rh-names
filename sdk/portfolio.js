/**
 * Discover names owned by a wallet + aggregate registration stats.
 * Prefers eth_getLogs on controller NameRegistered events (works without
 * localStorage / cookies). Falls back to Blockscout token NFT txs.
 */

import { PHASE1 } from "./chain.js";
import { PHASE1_BASE_ABI } from "./abis.js";
import { getReadProvider } from "./provider.js";
import { labelTokenId } from "./phase1-client.js";

/** Canonical NameRegistered(string,bytes32,address,uint256,uint256,uint256) topic0 */
export const NAME_REGISTERED_TOPIC0 =
  "0x69e37f151eb98a09618ddaa80c8cfaf1ce5996867c489f45b555b412271ebf27";

function controllerAddresses(cfg = PHASE1) {
  const list = [cfg.controller];
  const leg = cfg.legacy || {};
  for (const k of ["controllerV1", "controllerV2", "controllerV3a"]) {
    if (leg[k]) list.push(leg[k]);
  }
  const seen = new Set();
  return list.filter((a) => {
    const k = String(a).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Decode non-indexed fields of NameRegistered from log data. */
export function decodeNameRegisteredData(ethers, data) {
  try {
    const [name, baseCost, premium, expires] = ethers.AbiCoder.defaultAbiCoder().decode(
      ["string", "uint256", "uint256", "uint256"],
      data
    );
    return {
      name: String(name),
      baseCost,
      premium,
      expires,
    };
  } catch (_) {
    // Manual fallback for odd encoder edge cases
    const bytes = ethers.getBytes(data);
    if (bytes.length < 160) return null;
    const view = (o) => {
      let n = 0n;
      for (let i = 0; i < 32; i++) n = (n << 8n) | BigInt(bytes[o + i]);
      return n;
    };
    const off = Number(view(0));
    const baseCost = view(32);
    const premium = view(64);
    const expires = view(96);
    if (off + 32 > bytes.length) return null;
    const strlen = Number(view(off));
    const start = off + 32;
    if (start + strlen > bytes.length) return null;
    const name = new TextDecoder().decode(bytes.subarray(start, start + strlen));
    return { name, baseCost, premium, expires };
  }
}

/**
 * Labels ever registered to `owner` (any controller generation).
 * Does NOT prove current ownership — call verifyOwnedLabels next.
 */
export async function fetchRegistrationLabelsForOwner(ethers, owner, cfg = PHASE1) {
  if (!owner || !ethers.isAddress(owner)) return [];
  const provider = getReadProvider(ethers, cfg);
  const ownerTopic = ethers.zeroPadValue(ethers.getAddress(owner), 32);
  const address = controllerAddresses(cfg);
  let logs = [];
  try {
    logs = await provider.getLogs({
      address,
      fromBlock: 0,
      toBlock: "latest",
      topics: [NAME_REGISTERED_TOPIC0, null, ownerTopic],
    });
  } catch (_) {
    logs = [];
    for (const a of address) {
      try {
        const part = await provider.getLogs({
          address: a,
          fromBlock: 0,
          toBlock: "latest",
          topics: [NAME_REGISTERED_TOPIC0, null, ownerTopic],
        });
        logs.push(...part);
      } catch (_) {
        /* ignore */
      }
    }
  }
  if (!logs.length) {
    try {
      return await fetchLabelsFromBlockscoutNftTx(ethers, owner, cfg);
    } catch (_) {
      return [];
    }
  }
  const names = [];
  for (const log of logs) {
    try {
      const d = decodeNameRegisteredData(ethers, log.data);
      if (d?.name) names.push(String(d.name).toLowerCase());
    } catch (_) {}
  }
  return [...new Set(names)];
}

/** Blockscout explorer token NFT history → decode register calldata labels. */
export async function fetchLabelsFromBlockscoutNftTx(ethers, owner, cfg = PHASE1) {
  const base = cfg.blockscoutApi || "https://robinhoodchain.blockscout.com/api";
  const url =
    `${base}?module=account&action=tokennfttx` +
    `&address=${ethers.getAddress(owner)}` +
    `&contractaddress=${ethers.getAddress(cfg.baseRegistrar)}` +
    `&page=1&offset=100&sort=desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`blockscout HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== "1" || !Array.isArray(json.result)) return [];
  const me = ethers.getAddress(owner).toLowerCase();
  const held = new Map();
  const rows = [...json.result].reverse();
  for (const tx of rows) {
    const tid = String(tx.tokenID);
    const to = String(tx.to || "").toLowerCase();
    const from = String(tx.from || "").toLowerCase();
    if (to === me) held.set(tid, tx);
    if (from === me) held.delete(tid);
  }
  const names = [];
  const iface = new ethers.Interface([
    "function register(string,address,uint256,bytes32,address)",
  ]);
  for (const tx of held.values()) {
    const input = tx.input || "";
    if (!input || input === "0x" || input.length < 10) continue;
    try {
      const parsed = iface.parseTransaction({ data: input });
      if (parsed?.args?.[0]) names.push(String(parsed.args[0]).toLowerCase());
    } catch (_) {
      /* non-register transfer */
    }
  }
  return [...new Set(names)];
}

/** Keep only labels whose BaseRegistrar ownerOf is still `owner`. */
export async function verifyOwnedLabels(ethers, labels, owner, cfg = PHASE1) {
  if (!owner || !labels?.length) return [];
  const provider = getReadProvider(ethers, cfg);
  const base = new ethers.Contract(cfg.baseRegistrar, PHASE1_BASE_ABI, provider);
  const me = ethers.getAddress(owner).toLowerCase();
  const out = [];
  await Promise.all(
    labels.map(async (label) => {
      try {
        const id = labelTokenId(ethers, label);
        const o = await base.ownerOf(id);
        if (o && o.toLowerCase() === me) out.push(label);
      } catch (_) {
        /* expired / burned / never minted */
      }
    })
  );
  return out.sort();
}

/**
 * Full portfolio discovery for My names (no localStorage required).
 * Returns { labels, source, error? }
 */
export async function discoverOwnedLabels(ethers, owner, cfg = PHASE1) {
  try {
    const regs = await fetchRegistrationLabelsForOwner(ethers, owner, cfg);
    const verified = await verifyOwnedLabels(ethers, regs, owner, cfg);
    return { labels: verified, source: "chain", error: null };
  } catch (e) {
    return { labels: [], source: "error", error: e };
  }
}

const STATS_CACHE_KEY = "rh-reg-stats-v1";
const STATS_TTL_MS = 5 * 60 * 1000;

/**
 * Count NameRegistered logs across all controller generations.
 * Best lightweight approach for static GH Pages (no indexer server).
 */
export async function countTotalRegistrations(ethers, cfg = PHASE1) {
  try {
    const raw = sessionStorage.getItem(STATS_CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && Date.now() - c.at < STATS_TTL_MS && typeof c.total === "number") {
        return { total: c.total, cached: true, source: c.source || "rpc" };
      }
    }
  } catch (_) {}

  const provider = getReadProvider(ethers, cfg);
  const address = controllerAddresses(cfg);
  let logs = [];
  try {
    logs = await provider.getLogs({
      address,
      fromBlock: 0,
      toBlock: "latest",
      topics: [NAME_REGISTERED_TOPIC0],
    });
  } catch (_) {
    for (const a of address) {
      try {
        const part = await provider.getLogs({
          address: a,
          fromBlock: 0,
          toBlock: "latest",
          topics: [NAME_REGISTERED_TOPIC0],
        });
        logs.push(...part);
      } catch (_) {}
    }
  }
  const total = logs.length;
  try {
    sessionStorage.setItem(
      STATS_CACHE_KEY,
      JSON.stringify({ total, at: Date.now(), source: "rpc" })
    );
  } catch (_) {}
  return { total, cached: false, source: "rpc" };
}
