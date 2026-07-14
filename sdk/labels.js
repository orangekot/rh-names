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

export function validateLabel(name) {
  if (!name) return "Enter a label (without .rh)";
  if (name.length < MIN_LABEL) return `Label too short (min ${MIN_LABEL} chars)`;
  if (name.length > MAX_LABEL) return `Label too long (max ${MAX_LABEL} chars)`;
  if (!LABEL_RE.test(name)) {
    return "Invalid label: only a-z, 0-9, hyphen; no leading/trailing hyphen";
  }
  return null;
}

export function fqdn(label, tld = "rh") {
  const n = normalizeLabel(label);
  return n ? `${n}.${tld}` : "";
}
