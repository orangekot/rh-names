/** Duration presets + duration-discount helpers (mirrors LengthTierDurationDiscountOracle). */

export const YEAR = 365n * 24n * 60n * 60n;
export const DAY = 24n * 60n * 60n;
export const MONTH_STEP = 30n * DAY; // discount step size on-chain
export const MIN_BASE = 28n * DAY;

/**
 * On-chain discount model (LengthTierDurationDiscountOracle):
 *   steps = floor((duration - 28d) / 30d), clamped 0..12
 *   discount = steps * 4%  (max 48%)
 */
export function discountStepsForDuration(sec) {
  const n = BigInt(sec);
  if (n <= MIN_BASE) return 0;
  let steps = Number((n - MIN_BASE) / MONTH_STEP);
  if (steps > 12) steps = 12;
  if (steps < 0) steps = 0;
  return steps;
}

export function discountPercentForDuration(sec) {
  return discountStepsForDuration(sec) * 4;
}

/** days for m-month preset: 28 + 30*(m-1) for m>=2; m=1 is 28 days. */
export function monthsToSeconds(m) {
  if (m <= 1) return MIN_BASE;
  return MIN_BASE + MONTH_STEP * BigInt(m - 1);
}

/**
 * Product duration list:
 * 28 days, 2..12 months (month length = discount-aligned 28+30*(m-1)),
 * 1 year (displayed instead of "13 months"), 2..5 years.
 * Each of renew + register quotes uses the same oracle path.
 */
export const DURATION_PRESETS = [
  { key: "28d", label: "28 days", seconds: MIN_BASE, hint: "minimum" },
  { key: "2m", label: "2 months", seconds: monthsToSeconds(2) },
  { key: "3m", label: "3 months", seconds: monthsToSeconds(3) },
  { key: "4m", label: "4 months", seconds: monthsToSeconds(4) },
  { key: "5m", label: "5 months", seconds: monthsToSeconds(5) },
  { key: "6m", label: "6 months", seconds: monthsToSeconds(6) },
  { key: "7m", label: "7 months", seconds: monthsToSeconds(7) },
  { key: "8m", label: "8 months", seconds: monthsToSeconds(8) },
  { key: "9m", label: "9 months", seconds: monthsToSeconds(9) },
  { key: "10m", label: "10 months", seconds: monthsToSeconds(10) },
  { key: "11m", label: "11 months", seconds: monthsToSeconds(11) },
  { key: "12m", label: "12 months", seconds: monthsToSeconds(12) },
  { key: "1y", label: "1 year", seconds: YEAR, hint: "most common" },
  { key: "2y", label: "2 years", seconds: 2n * YEAR },
  { key: "3y", label: "3 years", seconds: 3n * YEAR },
  { key: "4y", label: "4 years", seconds: 4n * YEAR },
  { key: "5y", label: "5 years", seconds: 5n * YEAR },
  // Legacy keys kept so old localStorage / deep-links still map:
  { key: "90d", label: "90 days", seconds: 90n * DAY, legacy: true },
  { key: "180d", label: "180 days", seconds: 180n * DAY, legacy: true },
  { key: "10y", label: "10 years", seconds: 10n * YEAR, v4Only: true, legacy: true },
];

export function durationSeconds(key, { allow10y = false } = {}) {
  const map = Object.fromEntries(
    DURATION_PRESETS.filter((p) => allow10y || !p.v4Only).map((p) => [p.key, p.seconds])
  );
  return map[key] ?? MIN_BASE;
}

export function formatDurationSeconds(sec) {
  const n = BigInt(sec);
  if (n % YEAR === 0n) {
    const y = n / YEAR;
    return y === 1n ? "1 year" : `${y} years`;
  }
  if (n % DAY === 0n) {
    const d = n / DAY;
    return d === 1n ? "1 day" : `${d} days`;
  }
  return `${n}s`;
}

/**
 * Human countdown for short live timers (commitment wait / expiry).
 * 1436:10-style total-minutes → prefer "23h 56m 10s".
 */
export function formatCountdown(totalSec) {
  let s = Math.max(0, Math.floor(Number(totalSec) || 0));
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${String(r).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
}

/** Fill a <select> with product duration options (skips legacy).
 *  Note: browsers do NOT allow styling individual <option> text in red;
 *  lifestyle UI shows −% in the option label, plus a live red badge beside the price.
 */
export function fillDurationSelect(selectEl, { selected = "1y" } = {}) {
  if (!selectEl) return;
  const product = DURATION_PRESETS.filter((p) => !p.legacy && !p.v4Only);
  selectEl.innerHTML = product
    .map((p) => {
      const pct = discountPercentForDuration(p.seconds);
      // Unicode minus + percent so it's obvious even when OS greys out option styling
      const disc = pct > 0 ? `  (−${pct}% off)` : `  (0% off)`;
      const sel = p.key === selected ? " selected" : "";
      return `<option value="${p.key}"${sel}>${p.label}${disc}</option>`;
    })
    .join("");
}
