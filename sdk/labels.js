/** Label normalization + FE-side validation (stricter than on-chain strlen-only). */

export const MIN_LABEL = 3;
export const MAX_LABEL = 32;
/** a-z0-9, hyphen not at ends; 3–32 chars after strip of trailing .rh */
export const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export function normalizeLabel(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\.rh$/i, "");
}

/** True if label contains any non-ASCII code unit/point (emoji, accents…). */
export function hasNonAscii(name) {
  if (!name) return false;
  // reject anything outside printable ASCII after normalize
  return /[^\x00-\x7F]/.test(name);
}

/**
 * Unicode codepoint length (mirrors ENS StringUtils.strlen for multi-byte UTF-8).
 * On-chain controller uses this — emoji count as 1–N codepoints, not bytes.
 */
export function unicodeLen(s) {
  return [...String(s || "")].length;
}

/**
 * Product FE validation:
 * - empty / too short / too long blocked
 * - non-ASCII (incl. emoji) blocked in product UI with a distinct message
 * - LDH / DNS-label charset only (ENS-shaped username product)
 *
 * On-chain SimpleRHRegistrarController.valid is ONLY 3…32 unicode length —
 * emoji WOULD mint on-chain if sent via cast/custom client. Product policy is stricter.
 */
export function validateLabel(name) {
  if (!name) return "Enter a label (without .rh)";
  const len = unicodeLen(name);
  if (len < MIN_LABEL) return `Label too short (min ${MIN_LABEL} characters)`;
  if (len > MAX_LABEL) return `Label too long (max ${MAX_LABEL} characters)`;
  if (hasNonAscii(name)) {
    return "This name contains non-ASCII characters and cannot be registered.";
  }
  if (!LABEL_RE.test(name)) {
    return "Invalid label: only a-z, 0-9, hyphen; no leading/trailing hyphen";
  }
  return null;
}

export function fqdn(label, tld = "rh") {
  const n = normalizeLabel(label);
  return n ? `${n}.${tld}` : "";
}
