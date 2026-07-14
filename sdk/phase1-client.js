/** Read/write helpers bound to RH Phase-1 live contracts. */

import {
  PHASE1_BASE_ABI,
  PHASE1_CTRL_ABI,
  PHASE1_ENS_ABI,
  PHASE1_ORACLE_ABI,
  PHASE1_RESOLVER_ABI,
  PHASE1_REVERSE_ABI,
} from "./abis.js";
import { COMMON_TEXT_KEYS, PHASE1 } from "./chain.js";
import { getReadProvider } from "./provider.js";

export function labelTokenId(ethers, name) {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes(name)));
}

export function ensNode(ethers, name, tld = "rh") {
  return ethers.namehash(`${name}.${tld}`);
}

export function fmtTs(u) {
  const n = BigInt(u);
  if (n === 0n) return "— (never / expired)";
  const d = new Date(Number(n) * 1000);
  if (Number.isNaN(d.getTime())) return String(n);
  // Keep ISO for scripts / logs.
  return d.toISOString().replace(".000Z", "Z") + ` (unix ${n})`;
}

/** User-facing timestamp: local date + relative remaining/ago. */
export function fmtTsHuman(u, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const n = BigInt(u);
  if (n === 0n) return "not set / expired";
  const sec = Number(n);
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return String(n);
  const local = d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const delta = sec - nowSec;
  if (Math.abs(delta) < 60) return `${local} (now)`;
  const abs = Math.abs(delta);
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  let rel;
  if (days > 0) rel = `${days}d ${hours}h`;
  else if (hours > 0) rel = `${hours}h ${mins}m`;
  else rel = `${mins}m`;
  return delta > 0 ? `${local} (in ${rel})` : `${local} (${rel} ago)`;
}

function isZeroAddr(a) {
  return !a || /^0x0{40}$/i.test(String(a));
}

/**
 * Compact user-facing lookup summary (no node/tokenId/controller dumps).
 * Registration timestamp is not stored on-chain in Phase-1 — only expiry is.
 */
export function formatLookupSummary(r, { ethers, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const label = r?.name ? `${r.name}.rh` : "(unknown)";
  if (r?.avail) {
    return (
      `${label}\n` +
      `Status: Available to register\n` +
      (r.valid === false ? `Note: label failed controller validation\n` : "") +
      `Owner: —`
    );
  }
  const owner =
    (!isZeroAddr(r?.nftOwner) && r.nftOwner) ||
    (!isZeroAddr(r?.regOwner) && r.regOwner) ||
    "—";
  const lines = [
    label,
    "Status: Registered",
    `Owner: ${owner}`,
    `Expires: ${fmtTsHuman(r?.exp ?? 0n, { nowSec })}`,
  ];
  if (!isZeroAddr(r?.addr)) lines.push(`Points to: ${r.addr}`);
  return lines.join("\n");
}

/** Compact profile panel summary (texts only + human ownership). */
export function formatProfileSummary(r, texts = {}, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const label = r?.name ? `${r.name}.rh` : "(unknown)";
  const owner =
    (!isZeroAddr(r?.nftOwner) && r.nftOwner) ||
    (!isZeroAddr(r?.regOwner) && r.regOwner) ||
    "—";
  const pick = (k) => {
    const v = texts[k];
    if (v == null || v === "") return "(empty)";
    return v;
  };
  return [
    label,
    `Owner: ${owner}`,
    `Expires: ${fmtTsHuman(r?.exp ?? 0n, { nowSec })}`,
    `Website: ${pick("url")}`,
    `Avatar: ${pick("avatar")}`,
    `Bio: ${pick("description")}`,
    `Twitter: ${pick("com.twitter")}`,
    `GitHub: ${pick("com.github")}`,
    `Email: ${pick("email")}`,
  ].join("\n");
}

export function makeReadContracts(ethers, cfg = PHASE1) {
  const r = getReadProvider(ethers, cfg);
  return {
    ens: new ethers.Contract(cfg.registry, PHASE1_ENS_ABI, r),
    base: new ethers.Contract(cfg.baseRegistrar, PHASE1_BASE_ABI, r),
    controller: new ethers.Contract(cfg.controller, PHASE1_CTRL_ABI, r),
    oracle: new ethers.Contract(cfg.oracle, PHASE1_ORACLE_ABI, r),
    resolver: new ethers.Contract(cfg.addrResolver, PHASE1_RESOLVER_ABI, r),
    reverse: new ethers.Contract(cfg.reverseRegistrar, PHASE1_REVERSE_ABI, r),
    provider: r,
  };
}

export function makeWriteContracts(ethers, signer, cfg = PHASE1) {
  if (!signer) throw new Error("Connect wallet first");
  return {
    controller: new ethers.Contract(cfg.controller, PHASE1_CTRL_ABI, signer),
    reverse: new ethers.Contract(cfg.reverseRegistrar, PHASE1_REVERSE_ABI, signer),
    resolver: new ethers.Contract(cfg.addrResolver, PHASE1_RESOLVER_ABI, signer),
  };
}

export async function loadStackInfo(ethers, cfg = PHASE1) {
  const { ens: _ens, base, controller, reverse, provider } = makeReadContracts(ethers, cfg);
  const network = await provider.getNetwork();
  const [baseEns, baseNode, ctrlOk, minAge, maxAge, minDur, defRes, ensCode, ctrlCode] =
    await Promise.all([
      base.ens(),
      base.baseNode(),
      base.controllers(cfg.controller),
      controller.minCommitmentAge(),
      controller.maxCommitmentAge(),
      controller.MIN_REGISTRATION_DURATION(),
      reverse.defaultResolver(),
      provider.getCode(cfg.registry),
      provider.getCode(cfg.controller),
    ]);
  return {
    network,
    baseEns,
    baseNode,
    ctrlOk,
    minAge: Number(minAge),
    maxAge: Number(maxAge),
    minDur: Number(minDur),
    defRes,
    ensCode,
    ctrlCode,
  };
}

export async function loadOraclePrices(ethers, cfg = PHASE1) {
  const { oracle } = makeReadContracts(ethers, cfg);
  const [p3, p4, p5] = await Promise.all([oracle.price3(), oracle.price4(), oracle.price5Plus()]);
  return { p3, p4, p5 };
}

export async function resolveName(ethers, name, cfg = PHASE1) {
  const { ens, base, controller } = makeReadContracts(ethers, cfg);
  const node = ensNode(ethers, name, cfg.tld);
  const tokenId = labelTokenId(ethers, name);
  const [avail, regOwner, res, exp, nftOwner, valid] = await Promise.all([
    controller.available(name),
    ens.owner(node),
    ens.resolver(node),
    base.nameExpires(tokenId),
    base.ownerOf(tokenId).catch(() => ethers.ZeroAddress),
    controller.valid(name),
  ]);
  let addr = ethers.ZeroAddress;
  const texts = {};
  if (res && res !== ethers.ZeroAddress) {
    const r = new ethers.Contract(res, PHASE1_RESOLVER_ABI, getReadProvider(ethers, cfg));
    try {
      addr = await r.addr(node);
    } catch (_) {
      /* old/minimal resolver */
    }
    for (const key of COMMON_TEXT_KEYS) {
      try {
        texts[key] = await r.text(node, key);
      } catch (_) {
        texts[key] = null;
      }
    }
  }
  return { name, node, tokenId, avail, regOwner, res, exp, nftOwner, valid, addr, texts };
}

export function avatarPreviewUrl(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("ipfs://")) {
    return "https://ipfs.io/ipfs/" + s.slice("ipfs://".length).replace(/^ipfs\//, "");
  }
  return null;
}
