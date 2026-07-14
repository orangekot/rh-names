/** Humanize wallet + custom-error reverts. */

import { PHASE1_CTRL_ABI } from "./abis.js";
import { CHAIN } from "./chain.js";

export const PHASE1_ERROR_BY_SEL = {
  "0xcba3a53b": "CommitmentTooNew — wait at least 60s after commit",
  "0xcfef9a95": "CommitmentTooOld — re-commit (max age 24h)",
  "0x7a3e9f14": "CommitmentMissing — commit first with same owner+secret",
  "0x4a9b98c8": "UnexpiredCommitmentExists — same commitment still open",
  "0xa18ea0b6": "NameNotAvailable",
  "0x25c36367": "DurationTooShort — min 28 days",
  "0x11011294": "InsufficientValue — send full quoted amount",
};

export const V4_ERROR_BY_SEL = {
  "0x40adaa20": "LabelUnavailable — name is taken, invalid, or not free",
  "0x76166401": "InvalidDuration — use 28 days … 10 years",
  "0xb99e2ab7": "InsufficientPayment — send the full quoted amount",
  "0x00bfc921": "InvalidPrice",
  "0x90b8ec18": "TransferFailed",
  "0x3d36cb8d": "InvalidLabel",
  "0x9e4b2685": "NameTaken",
  "0x3b4d5400": "NameNotFound",
  "0xea8e4eb5": "NotAuthorized",
  "0x6c80f2e3": "NameExpired",
  "0x49e27cff": "InvalidOwner",
  "0x6da3f654": "InvalidResolver",
  "0x42f058b4": "NotNameOwner",
};

function extractErrorData(e) {
  return (
    e?.data ||
    e?.info?.error?.data ||
    e?.error?.data ||
    e?.info?.error?.error?.data ||
    e?.receipt?.revertReason ||
    null
  );
}

/**
 * @param {unknown} e
 * @param {{ ethers: any; selectors?: Record<string,string>; decodeAbi?: string[] }} opts
 */
export function formatError(e, opts = {}) {
  const { ethers, selectors = PHASE1_ERROR_BY_SEL, decodeAbi = PHASE1_CTRL_ABI } = opts;
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e.code === 4001 || e.code === "ACTION_REJECTED") {
    return "Transaction rejected in wallet";
  }
  if (e.reason) return e.reason;
  if (e.revert && e.revert.name) {
    const args = e.revert.args?.length ? `(${e.revert.args.join(", ")})` : "";
    return `${e.revert.name}${args}`;
  }
  const data = extractErrorData(e);
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    const sel = data.slice(0, 10).toLowerCase();
    if (selectors[sel]) return selectors[sel];
    if (ethers) {
      try {
        const iface = new ethers.Interface(decodeAbi);
        const parsed = iface.parseError(data);
        if (parsed) return parsed.name;
      } catch (_) {
        /* ignore */
      }
    }
    return `Contract reverted (${sel})`;
  }
  const msg = e.shortMessage || e.message || String(e);
  if (/missing revert data/i.test(msg) || /CALL_EXCEPTION/i.test(String(e.code))) {
    return (
      "missing revert data — usually wrong chain or flaky wallet RPC.\n" +
      `App expects Robinhood Mainnet chainId ${CHAIN.chainId} (${CHAIN.chainIdHex}).\n` +
      "Reads force the public Robinhood RPC; re-connect and switch MetaMask to 4663."
    );
  }
  return msg;
}

export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&" + "amp;")
    .replaceAll("<", "&" + "lt;")
    .replaceAll(">", "&" + "gt;")
    .replaceAll('"', "&" + "quot;");
}
