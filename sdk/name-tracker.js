/** Browser-side list of names the user cares about (local). Not a chain indexer. */

const KEY = "rh-tracked-names-v1";

export function listTrackedLabels() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(arr) ? [...new Set(arr.map((x) => String(x).toLowerCase()))] : [];
  } catch {
    return [];
  }
}

export function rememberLabel(label) {
  const n = String(label || "").toLowerCase().replace(/\.rh$/i, "");
  if (!n) return;
  const set = new Set(listTrackedLabels());
  set.add(n);
  localStorage.setItem(KEY, JSON.stringify([...set]));
}

export function removeTrackedLabel(label) {
  const n = String(label || "").toLowerCase().replace(/\.rh$/i, "");
  const next = listTrackedLabels().filter((x) => x !== n);
  localStorage.setItem(KEY, JSON.stringify(next));
}
