/** Browser-local commit secrets for slim Phase-1 controller. */

export const COMMIT_KEY = "rh-phase1-commit-v1";

export function loadCommitMap() {
  try {
    return JSON.parse(localStorage.getItem(COMMIT_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveCommitMap(map) {
  localStorage.setItem(COMMIT_KEY, JSON.stringify(map));
}

export function commitStorageKey(label, owner) {
  return `${String(label).toLowerCase()}::${String(owner).toLowerCase()}`;
}

export function getPendingCommit(label, owner) {
  if (!owner) return null;
  const map = loadCommitMap();
  return map[commitStorageKey(label, owner)] || null;
}

export function setPendingCommit(label, owner, data) {
  const map = loadCommitMap();
  map[commitStorageKey(label, owner)] = data;
  saveCommitMap(map);
}

export function clearPendingCommit(label, owner) {
  const map = loadCommitMap();
  delete map[commitStorageKey(label, owner)];
  saveCommitMap(map);
}

export function clearAllCommits() {
  saveCommitMap({});
}

/**
 * Live age / readiness for countdown UI.
 * @returns {{ age: number|null, remaining: number, ready: boolean, expired: boolean, committedAt: number|null }}
 */
export function commitmentTiming(pending, nowSec, minAge = 60, maxAge = 86400) {
  if (!pending?.committedAt) {
    return { age: null, remaining: minAge, ready: false, expired: false, committedAt: null };
  }
  const age = Math.max(0, nowSec - Number(pending.committedAt));
  const remaining = Math.max(0, minAge - age);
  return {
    age,
    remaining,
    ready: age >= minAge && age < maxAge,
    expired: age >= maxAge,
    committedAt: Number(pending.committedAt),
  };
}
