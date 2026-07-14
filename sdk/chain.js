/** Live RH chain + contract addresses. Keep in sync with deployments.json files. */

export const CHAIN = {
  chainId: 4663,
  chainIdHex: "0x1237",
  chainName: "Robinhood Mainnet",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  /** Robinhood Chain Blockscout (canonical). */
  explorer: "https://robinhoodchain.blockscout.com",
  blockscoutApi: "https://robinhoodchain.blockscout.com/api",
  tld: "rh",
};

/** Blockscout deep links. */
export function txUrl(hash, cfg = CHAIN) {
  const base = (cfg.explorer || CHAIN.explorer).replace(/\/$/, "");
  return `${base}/tx/${hash}`;
}
export function addressUrl(addr, cfg = CHAIN) {
  const base = (cfg.explorer || CHAIN.explorer).replace(/\/$/, "");
  return `${base}/address/${addr}`;
}

/** Custom V4 rental product stack (this repo). */
export const V4 = {
  ...CHAIN,
  proxy: "0x25A60882A6e0F0AEdF55D0B08b6055B5B75039CE",
  implementation: "0x37C69e81Aeb2a424A699791EE51A1ccaCc28A736",
  registrar: "0xC7a86b2E0Ec81a58a41Beaa0218294e4b3688FfD",
  multisig: "0x1ecEEb6B3898b9dA56345212d0bB78836f14CdeD",
  version: 4,
};

/**
 * ENS Phase-1 product defaults (controller v2 + richer resolver v3).
 * Source of truth: ~/Downloads/rh-ens-phase1/deployments.json
 *
 * Pricing v3 (2026-07-14): LengthTierDurationDiscountOracle + new controller.
 * Tiers: 0.03 / 0.01 / 0.005 ETH per year + duration discounts.
 * Multisig txId=2: base.addController executed (2-of-3).
 */
export const PHASE1 = {
  ...CHAIN,
  registry: "0xF3fcF2aeef2b49F33C9882C28b526558C675Df5a",
  baseRegistrar: "0x2C66b1F37A00cb22828637301F31c85e180f1Aa0",
  /** Pricing v3 controller (0.03/0.01/0.005 + duration discounts). */
  controller: "0xf3C5D3a85a1646F57B449Adc401347E003a3aF92",
  /** Pricing v3 oracle. */
  oracle: "0xd19177f86bACa66d5bDBa6b3932B6E81E530605D",
  reverseRegistrar: "0xF2Cc3fB65ea90162B0556519022D84CfeD3c323C",
  /** Default for new regs + reverse defaultResolver target. */
  addrResolver: "0x20450F13747039621b87F79AAc3144f86a6C78C1",
  multisig: "0x1ecEEb6B3898b9dA56345212d0bB78836f14CdeD",
  /** Superceded 1-of-1 — still exists on-chain; no longer owns product contracts. */
  multisigLegacy1of1: "0x85Eac98DE81fa0596C3749901d7B8aD1482C1E62",
  multisigRequired: 2,
  baseNode: "0x4f10802a4efc436675f1e8abd1ec6dd7640569855900fc318b71ba13273c3402",
  /** Fallback UI constants; prefer live controller.min/maxCommitmentAge. */
  minCommitAge: 60,
  maxCommitAge: 86400,
  minRegDuration: 28 * 24 * 60 * 60,
  legacy: {
    controllerV1: "0xf45e1E219331A15F3aA9A463a2475164Cb827f68",
    /** Pre-discount static pricing (0.01/0.005/0.001). */
    controllerV2: "0x8CDB330fB770097d68Bf7c55673Ac47f19246e49",
    /** Intermediate 0.1/0.05/0.01 never activated (addController skipped). */
    controllerV3a: "0xaf5699735ee57EEc295A3EFE3B7b88d958EaE799",
    oracleV1: "0x9777a5994cb3a834fB28A63b03FaC7234B6b8346",
    oracleV2Static: "0x2E9962740F8B49e17a9d4fCCEc94e5ADF74A4667",
    oracleV3a: "0x0333f42A101719715Ee86AD6B8A4380B7ACB15C5",
    addrResolverV2: "0x3752AeB21d452A6fC0cB866900581CCb38E68c3A",
  },
};

export const COMMON_TEXT_KEYS = [
  "url",
  "avatar",
  "description",
  "com.twitter",
  "com.github",
  "email",
  "url.main",
  "notice",
];
