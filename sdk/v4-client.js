/** Read/write helpers for custom V4 rental stack. */

import { V4_REGISTRAR_ABI, V4_REGISTRY_ABI } from "./abis.js";
import { V4 } from "./chain.js";
import { getReadProvider } from "./provider.js";

export function makeV4ReadContracts(ethers, cfg = V4) {
  const r = getReadProvider(ethers, cfg);
  return {
    registry: new ethers.Contract(cfg.proxy, V4_REGISTRY_ABI, r),
    registrar: new ethers.Contract(cfg.registrar, V4_REGISTRAR_ABI, r),
    provider: r,
  };
}

export function makeV4WriteContracts(ethers, signer, cfg = V4) {
  if (!signer) throw new Error("Connect wallet first");
  return {
    registry: new ethers.Contract(cfg.proxy, V4_REGISTRY_ABI, signer),
    registrar: new ethers.Contract(cfg.registrar, V4_REGISTRAR_ABI, signer),
  };
}

/** Permanent / legacy V4 expiry sentinel (~ max uint64). */
export function fmtV4Ts(u64) {
  if (u64 === 18446744073709551615n || u64 > 10n ** 12n) return "permanent / legacy";
  const d = new Date(Number(u64) * 1000);
  if (Number.isNaN(d.getTime())) return String(u64);
  return d.toISOString().replace(".000Z", "Z") + ` (unix ${u64})`;
}

export async function loadV4StackInfo(ethers, cfg = V4) {
  const { registry, registrar, provider } = makeV4ReadContracts(ethers, cfg);
  const network = await provider.getNetwork();
  const [total, owner, regAddr, minR, p3, p4, p5, regCode] = await Promise.all([
    registry.totalNames(),
    registry.owner(),
    registry.registrar(),
    registry.MIN_REGISTRATION(),
    registrar.price3(),
    registrar.price4(),
    registrar.price5Plus(),
    provider.getCode(cfg.registrar),
  ]);
  return {
    network,
    total,
    owner,
    regAddr,
    minR: Number(minR),
    p3,
    p4,
    p5,
    regCode,
  };
}

export async function resolveV4Name(ethers, name, cfg = V4) {
  const { registry } = makeV4ReadContracts(ethers, cfg);
  const [avail, owner, resolver, expires, node, total] = await Promise.all([
    registry.available(name),
    registry.ownerOf(name),
    registry.resolve(name),
    registry.nameExpires(name),
    registry.namehash(name),
    registry.totalNames(),
  ]);
  return { name, avail, owner, resolver, expires, node, total };
}
