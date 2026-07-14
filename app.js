/**
 * Public product home — Phase-1 only (ENS-shaped search-first).
 * V4 lives at internal-v4.html for ops; not linked from public nav.
 */
import { PHASE1, txUrl } from "./sdk/chain.js";
import {
  commitmentTiming,
  clearAllCommits,
  clearPendingCommit,
  getPendingCommit,
  setPendingCommit,
} from "./sdk/commit-store.js";
import {
  durationSeconds,
  discountPercentForDuration,
  fillDurationSelect,
  formatCountdown,
  formatDurationSeconds,
  MIN_BASE,
  YEAR,
} from "./sdk/duration.js";
import { escapeHtml, formatError, PHASE1_ERROR_BY_SEL } from "./sdk/errors.js";
import { hasNonAscii, normalizeLabel, validateLabel } from "./sdk/labels.js";
import {
  avatarPreviewUrl,
  ensNode,
  fmtTsHuman,
  loadOraclePrices,
  makeReadContracts,
  makeWriteContracts,
  resolveName,
} from "./sdk/phase1-client.js";
import { connectWallet, ensureChain } from "./sdk/provider.js";
import { PHASE1_RESOLVER_ABI } from "./sdk/abis.js";
import {
  listTrackedLabels,
  rememberLabel,
  removeTrackedLabel,
} from "./sdk/name-tracker.js";
import {
  countTotalRegistrations,
  discoverOwnedLabels,
} from "./sdk/portfolio.js";
import { initTheme } from "./theme.js";

const ethers = window.ethers;
const CFG = PHASE1;
const $ = (id) => document.getElementById(id);
const DEFAULT_AVATAR = "./assets/default-avatar.svg";

let signer, account, browserProvider;
let liveMinAge = CFG.minCommitAge;
let liveMaxAge = CFG.maxCommitAge;
let countdownTimer = null;
let activeView = "search"; // search | name | my
let activeLabel = "";
/** Cache of last resolve for quote without second RPC round-trip when possible. */
let lastResolve = null;
let quoteBusy = false;
/** Cached ETH→USD rate (number) or null. */
let ethUsdRate = null;
let ethUsdFetchedAt = 0;
const ETH_USD_TTL_MS = 5 * 60 * 1000;

function errOpts() {
  return { ethers, selectors: PHASE1_ERROR_BY_SEL };
}
function showErr(el, e) {
  if (!el) return;
  el.innerHTML = `<span class="err">${escapeHtml(formatError(e, errOpts()))}</span>`;
  el.hidden = false;
}

function setImg(el, url, fallback = DEFAULT_AVATAR) {
  if (!el) return;
  const src = url || fallback;
  el.onerror = () => {
    if (el.src && !el.src.endsWith("default-avatar.svg")) el.src = fallback;
  };
  el.src = src;
  el.hidden = false;
}

/** Clickable tx hash for Blockscout. */
function txLinkHtml(hash) {
  if (!hash) return "";
  const url = txUrl(hash, CFG);
  return `<a class="tx-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hash)}</a>`;
}

function setTxStatus(el, prefixHtml, hash) {
  if (!el) return;
  el.innerHTML = `${prefixHtml}${hash ? `<br/>tx ${txLinkHtml(hash)}` : ""}`;
  el.hidden = false;
}

function paintAsciiWarn(rawInput) {
  const name = normalizeLabel(rawInput);
  const bad = !!(name && hasNonAscii(name));
  for (const id of ["asciiWarnHero", "asciiWarnName", "asciiWarnReg"]) {
    const el = $(id);
    if (!el) continue;
    if (bad) {
      el.hidden = false;
      el.textContent =
        "This name contains non-ASCII characters and cannot be registered.";
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  }
  return bad;
}

async function fetchEthUsd() {
  const now = Date.now();
  if (ethUsdRate != null && now - ethUsdFetchedAt < ETH_USD_TTL_MS) return ethUsdRate;
  try {
    // CoinGecko simple public endpoint — no API key.
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error("cg http " + res.status);
    const j = await res.json();
    const n = Number(j?.ethereum?.usd);
    if (Number.isFinite(n) && n > 0) {
      ethUsdRate = n;
      ethUsdFetchedAt = now;
      return n;
    }
  } catch (_) {
    /* leave previous cache or null */
  }
  return ethUsdRate;
}

function formatUsd(ethAmount) {
  if (ethUsdRate == null || ethAmount == null) return "";
  const n = Number(ethAmount) * ethUsdRate;
  if (!Number.isFinite(n)) return "";
  if (n >= 100) return `≈ $${n.toFixed(0)}`;
  if (n >= 1) return `≈ $${n.toFixed(2)}`;
  return `≈ $${n.toFixed(4)}`;
}

async function paintUsdBeside(ethStr) {
  const el = $("livePriceUsd");
  if (!el) return;
  const eth = Number(ethStr);
  if (!Number.isFinite(eth)) {
    el.textContent = "";
    return;
  }
  await fetchEthUsd();
  el.textContent = formatUsd(eth);
}

function shortAddress(addr) {
  if (!addr || addr.length < 10) return addr || "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function setConnectedUi() {
  const disc = $("disconnectBtn");
  if (!account) {
    $("connectBtn").textContent = "Connect";
    $("connectBtn").hidden = false;
    if (disc) disc.hidden = true;
    $("netPill").textContent = "not connected";
    $("netPill").classList.remove("ok");
    setImg($("walletAvatar"), DEFAULT_AVATAR);
    return;
  }
  // Green button = short EVM address only (primary name goes in #netPill).
  $("connectBtn").textContent = shortAddress(account);
  $("connectBtn").hidden = false;
  if (disc) disc.hidden = false;
  $("netPill").textContent = "loading…";
  $("netPill").classList.add("ok");
}

/**
 * Connect button always stays the EVM address (short form).
 * Primary .rh name is shown only in #netPill (to the left of the green button).
 */
async function refreshPrimaryPill() {
  const pill = $("netPill");
  const btn = $("connectBtn");
  if (!account) {
    if (pill) {
      pill.textContent = "not connected";
      pill.classList.remove("ok");
    }
    if (btn) btn.textContent = "Connect";
    return;
  }
  // Hard rule: green connect button = address only, never primary name.
  if (btn) btn.textContent = shortAddress(account);
  if (!pill) return;
  pill.textContent = "loading…";
  pill.classList.add("ok");
  try {
    const primary = await fetchPrimaryName(account);
    if (primary) {
      pill.textContent = primary.endsWith(".rh") ? primary : `${primary}.rh`;
      return;
    }
  } catch (_) {}
  // No primary set — show short RH address marker in the left pill only.
  pill.textContent = "RH " + shortAddress(account);
}

function disconnect() {
  signer = null;
  account = null;
  browserProvider = null;
  setConnectedUi();
  paintCountdown();
  if (activeView === "my") renderMyNames();
}

function showView(name) {
  activeView = name;
  for (const id of ["viewSearch", "viewName", "viewMy"]) {
    const el = $(id);
    if (el) el.hidden = true;
  }
  if (name === "search") $("viewSearch").hidden = false;
  if (name === "name") $("viewName").hidden = false;
  if (name === "my") $("viewMy").hidden = false;
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-nav") === name);
  });
}

function showNameTab(tab) {
  document.querySelectorAll("#nameTabs [data-tab]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tab);
  });
  for (const t of ["overview", "records"]) {
    const el = $("tab-" + t);
    if (el) el.hidden = t !== tab;
  }
}

async function refreshWalletAvatar() {
  const av = $("walletAvatar");
  if (!av) return;
  if (!account) {
    setImg(av, DEFAULT_AVATAR);
    return;
  }
  try {
    const primary = await fetchPrimaryName(account);
    if (primary) {
      const label = normalizeLabel(primary);
      const r = await resolveName(ethers, label, CFG);
      const preview = avatarPreviewUrl(r.texts?.avatar);
      setImg(av, preview || DEFAULT_AVATAR);
      return;
    }
  } catch (_) {}
  setImg(av, DEFAULT_AVATAR);
}

async function connect() {
  const w = await connectWallet(ethers, CFG);
  browserProvider = w.browserProvider;
  signer = w.signer;
  account = w.account;
  setConnectedUi();
  await Promise.all([
    refreshPrices(),
    refreshWalletAvatar(),
    refreshPrimaryPill(),
  ]);
  if (activeView === "my") await renderMyNames();
  if (activeLabel) await openName(activeLabel, { quiet: true });
}

/**
 * Sample labels per length tier for oracle/controller quotes.
 * rentPrice is length-based only (no availability check).
 */
const TIER_SAMPLES = [
  { chars: "3", sample: "aaa" },
  { chars: "4", sample: "aaaa" },
  { chars: "5+", sample: "aaaaa" },
];

/** Live register cost for each tier at a fixed duration (wei totals). */
async function quoteTierTotals(durationSec) {
  const { controller } = makeReadContracts(ethers, CFG);
  const rows = await Promise.all(
    TIER_SAMPLES.map(async ({ chars, sample }) => {
      const price = await controller.rentPrice(sample, durationSec);
      const total = price.base + price.premium;
      return { chars, total };
    })
  );
  return rows;
}

/** Format ETH for display. Monthly row uses 4 dp to match the tidy yearly figures. */
function formatEthDisplay(totalWei, { decimals = null } = {}) {
  if (decimals != null) {
    const n = Number(ethers.formatEther(totalWei));
    if (!Number.isFinite(n)) return ethers.formatEther(totalWei);
    // fixed then strip only trailing zeros after the forced precision? user asked 4 places
    return n.toFixed(decimals);
  }
  const ethStr = ethers.formatEther(totalWei);
  if (!ethStr.includes(".")) return ethStr;
  return ethStr.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function pricePillHtml({ chars, totalWei, unitLabel, green = false, decimals = null }) {
  const eth = formatEthDisplay(totalWei, { decimals });
  const usd = formatUsd(Number(eth));
  const numCls = green ? ' class="price-num"' : "";
  return (
    `<span class="pill">` +
    `${chars} chars ≈ <span${numCls}>${eth}</span> ${unitLabel}` +
    (usd ? ` <span${numCls}>${usd}</span>` : "") +
    `</span>`
  );
}

async function refreshPrices() {
  try {
    await fetchEthUsd();
    // On-chain truth: same LengthTierDurationDiscountOracle formula as register.
    // 28d → 0% duration discount. 1y (365d) → 11 steps → −44% duration discount.
    const monthSec = MIN_BASE; // 28 days
    const yearSec = YEAR; // 365 days
    const yearPct = discountPercentForDuration(yearSec);
    const [monthly, yearly, base] = await Promise.all([
      quoteTierTotals(monthSec),
      quoteTierTotals(yearSec),
      loadOraclePrices(ethers, CFG),
    ]);

    const monthRow =
      `<div class="prices-row">` +
      `<div class="prices-row-label">28 days <span class="hint">(0% duration off)</span></div>` +
      `<div class="prices">` +
      monthly
        .map((t) =>
          pricePillHtml({
            chars: t.chars,
            totalWei: t.total,
            unitLabel: "ETH / 28d",
            green: false,
            decimals: 4, // round like yearly readability: e.g. 0.0023
          })
        )
        .join("") +
      `</div></div>`;

    const yearRow =
      `<div class="prices-row">` +
      `<div class="prices-row-label">1 year <span class="hint">(−${yearPct}% duration off)</span></div>` +
      `<div class="prices">` +
      yearly
        .map((t) =>
          pricePillHtml({
            chars: t.chars,
            totalWei: t.total,
            unitLabel: "ETH / yr",
            green: true,
            decimals: 4,
          })
        )
        .join("") +
      `</div></div>`;

    $("pricePills").innerHTML = monthRow + yearRow;

    const how = $("howPriceHint");
    if (how) {
      const yMap = Object.fromEntries(
        yearly.map((t) => [t.chars, formatEthDisplay(t.total, { decimals: 4 })])
      );
      const mMap = Object.fromEntries(
        monthly.map((t) => [t.chars, formatEthDisplay(t.total, { decimals: 4 })])
      );
      const u = (eth) => {
        const s = formatUsd(Number(eth));
        return s ? ` ${s}` : "";
      };
      // Show paid totals (discounted year + floor month). Raw oracle yearly kept only as note.
      how.textContent =
        `28d: 3 chars ${mMap["3"]}${u(mMap["3"])} · 4 ${mMap["4"]}${u(mMap["4"])} · 5+ ${mMap["5+"]}${u(mMap["5+"])} ETH. ` +
        `1y (incl. −${yearPct}%): 3 ${yMap["3"]}${u(yMap["3"])} · 4 ${yMap["4"]}${u(yMap["4"])} · 5+ ${yMap["5+"]}${u(yMap["5+"])} ETH. ` +
        `Raw yearly base (pre-discount): ${formatEthDisplay(base.p3, { decimals: 4 })} / ${formatEthDisplay(base.p4, { decimals: 4 })} / ${formatEthDisplay(base.p5, { decimals: 4 })} ETH.`;
    }
  } catch (e) {
    $("pricePills").innerHTML = `<span class="pill warn">${escapeHtml(formatError(e, errOpts()))}</span>`;
  }
}

async function refreshStats() {
  const el = $("statTotalRegs");
  if (!el) return;
  el.textContent = "…";
  try {
    const { total } = await countTotalRegistrations(ethers, CFG);
    el.textContent = String(total);
  } catch (_) {
    el.textContent = "—";
  }
}

function paintCountdown() {
  const bar = $("countdownBar");
  const label = $("countdownLabel");
  const fill = $("countdownFill");
  const regBtn = $("regBtn");
  if (!bar || !label || !fill || !regBtn) return;
  const name = normalizeLabel($("regName")?.value || activeLabel);
  const pending = account && name ? getPendingCommit(name, account) : null;
  const now = Math.floor(Date.now() / 1000);
  const t = commitmentTiming(pending, now, liveMinAge, liveMaxAge);
  if (!pending) {
    bar.className = "countdown idle";
    label.textContent = "Commit first — Register unlocks after the wait.";
    fill.style.width = "0%";
    regBtn.disabled = true;
    return;
  }
  if (t.expired) {
    bar.className = "countdown expired";
    label.textContent = `Commitment expired (${formatCountdown(t.age)}). Clear & re-commit.`;
    fill.style.width = "100%";
    regBtn.disabled = true;
    return;
  }
  if (t.ready) {
    bar.className = "countdown ready";
    const untilMax = liveMaxAge - t.age;
    label.textContent = `Ready to register · age ${formatCountdown(t.age)} · expires in ${formatCountdown(untilMax)}`;
    fill.style.width = "100%";
    regBtn.disabled = false;
    return;
  }
  bar.className = "countdown warn";
  label.textContent = `Wait ${formatCountdown(t.remaining)} (min ${formatCountdown(liveMinAge)} after commit)`;
  fill.style.width = `${Math.min(100, Math.round((t.age / liveMinAge) * 100))}%`;
  regBtn.disabled = true;
}

function startCountdownLoop() {
  if (countdownTimer) clearInterval(countdownTimer);
  paintCountdown();
  countdownTimer = setInterval(paintCountdown, 250);
}

function paintAvatarSurfaces(avatarText) {
  const preview = avatarPreviewUrl(avatarText);
  const src = preview || DEFAULT_AVATAR;
  setImg($("nameAvatar"), src);
  setImg($("fieldAvatar"), src);
  const ownAvatar = $("ownAvatar");
  if (ownAvatar) {
    ownAvatar.textContent = preview
      ? avatarText.length > 64
        ? avatarText.slice(0, 48) + "…"
        : avatarText
      : "Default Robinhood avatar";
  }
}

function paintStatusChrome({ avail }) {
  const emoji = $("statusEmoji");
  const beside = $("statusBeside");
  const btn = $("quickRegBtn");
  if (emoji) {
    if (avail) {
      emoji.textContent = "🟢";
      emoji.title = "Available";
    } else {
      emoji.textContent = "🔴";
      emoji.title = "Registered";
    }
  }
  if (beside) {
    beside.textContent = avail ? "Available to register" : "Registered";
  }
  if (btn) {
    if (avail) {
      btn.hidden = false;
      btn.disabled = false;
      btn.textContent = "Register";
      btn.onclick = () => {
        const panel = $("registerPanel");
        if (panel) {
          panel.hidden = false;
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };
    } else {
      btn.hidden = false;
      btn.disabled = true;
      btn.textContent = "Registered";
      btn.onclick = null;
    }
  }
}

async function openName(raw, { quiet = false } = {}) {
  const name = normalizeLabel(raw);
  paintAsciiWarn(name);
  const v = validateLabel(name);
  if (v) {
    if (!quiet) {
      if (hasNonAscii(name)) {
        // soft UI warning already painted; also surface under search
        if ($("searchOut")) {
          $("searchOut").innerHTML = `<span class="err">${escapeHtml(v)}</span>`;
        }
      } else {
        showErr($("searchOut"), v);
      }
    }
    // Still open name shell for non-ASCII so user sees red message near avatar area
    if (!hasNonAscii(name) && v) return;
    if (!hasNonAscii(name)) return;
  }
  activeLabel = name;
  showView("name");
  if (!quiet) showNameTab("overview");

  $("profileTitle").textContent = `${name}.rh`;
  if ($("heroSearch")) $("heroSearch").value = name;
  if ($("nameSearch")) $("nameSearch").value = name;
  if ($("regName")) $("regName").value = name;
  if ($("profileLabel")) $("profileLabel").value = name;

  if (validateLabel(name)) {
    // Invalid names can't resolve meaningfully
    $("nameLoading").textContent = "";
    $("ownAvail").textContent = "Invalid label";
    $("ownOwner").textContent = "—";
    $("ownNft").textContent = "—";
    $("ownExp").textContent = "—";
    $("ownBio").textContent = "—";
    $("ownUrl").textContent = "—";
    $("ownAddr").textContent = "—";
    paintAvatarSurfaces("");
    paintStatusChrome({ avail: false });
    if ($("registerPanel")) $("registerPanel").hidden = true;
    if ($("manageHint")) $("manageHint").hidden = true;
    if ($("quickRegBtn")) {
      $("quickRegBtn").hidden = false;
      $("quickRegBtn").disabled = true;
      $("quickRegBtn").textContent = "Unavailable";
    }
    return;
  }

  $("nameLoading").textContent = "Loading…";
  $("nameLoading").classList.add("loading-dot");
  $("ownOwner").textContent = "…";
  $("ownNft").textContent = "…";
  $("ownExp").textContent = "…";
  $("ownAvail").textContent = "…";
  $("ownBio").textContent = "…";
  $("ownUrl").textContent = "…";
  $("ownAddr").textContent = "…";
  paintAvatarSurfaces("");

  try {
    const r = await resolveName(ethers, name, CFG);
    lastResolve = r;
    const texts = r.texts || {};
    $("nameLoading").textContent = "";
    $("nameLoading").classList.remove("loading-dot");

    const owner =
      (r.nftOwner && r.nftOwner !== ethers.ZeroAddress && r.nftOwner) ||
      (r.regOwner && r.regOwner !== ethers.ZeroAddress && r.regOwner) ||
      "—";
    $("ownOwner").textContent =
      r.regOwner && r.regOwner !== ethers.ZeroAddress ? r.regOwner : "—";
    $("ownNft").textContent =
      r.nftOwner && r.nftOwner !== ethers.ZeroAddress ? r.nftOwner : "—";
    $("ownExp").textContent = fmtTsHuman(r.exp);
    // Status immediately after emoji in title chrome, and still in facts
    $("ownAvail").textContent = r.avail ? "Available to register" : "Registered";
    $("ownBio").textContent = texts.description || "—";
    $("ownUrl").textContent = texts.url || "—";
    $("ownAddr").textContent =
      r.addr && r.addr !== ethers.ZeroAddress ? r.addr : "—";
    paintAvatarSurfaces(texts.avatar || "");
    paintStatusChrome({ avail: r.avail, valid: r.valid });

    $("profileUrl").value = texts.url || "";
    $("profileAvatar").value = texts.avatar || "";
    $("profileDesc").value = texts.description || "";
    if ($("profileAddr")) {
      $("profileAddr").value =
        r.addr && r.addr !== ethers.ZeroAddress ? r.addr : "";
    }
    $("profileSaveOut").textContent = account
      ? owner !== "—" && account.toLowerCase() === String(owner).toLowerCase()
        ? "You own this name — edits will be signed by your wallet."
        : "Connected wallet is not the owner — Save may revert."
      : "Owner wallet required to save.";

    $("registerPanel").hidden = !r.avail;
    $("manageHint").hidden = r.avail;

    if (
      account &&
      r.nftOwner &&
      r.nftOwner.toLowerCase() === account.toLowerCase()
    ) {
      rememberLabel(name);
    }
    paintCountdown();
    if (r.avail) await doQuote({ silent: true });
    else {
      if ($("livePrice")) $("livePrice").textContent = "—";
      if ($("livePriceUsd")) $("livePriceUsd").textContent = "";
      if ($("liveDiscount")) $("liveDiscount").textContent = "";
    }
    if ($("searchOut")) $("searchOut").textContent = "";
  } catch (e) {
    $("nameLoading").classList.remove("loading-dot");
    showErr($("nameLoading"), e);
  }
}

async function doSearchFrom(inputId) {
  const q = $(inputId)?.value;
  paintAsciiWarn(q);
  if ($("searchOut")) $("searchOut").textContent = "Searching…";
  await openName(q);
}

async function doQuote({ silent = false } = {}) {
  if (quoteBusy) return;
  const name = normalizeLabel($("regName")?.value || activeLabel);
  paintAsciiWarn(name);
  const duration = durationSeconds($("regDuration")?.value || "1y");
  const pct = discountPercentForDuration(duration);
  if (!silent) $("regOut").textContent = "Quoting…";
  const v = validateLabel(name);
  if (v) {
    if ($("livePrice")) $("livePrice").textContent = "—";
    if ($("livePriceUsd")) $("livePriceUsd").textContent = "";
    return showErr($("regOut"), v);
  }
  quoteBusy = true;
  try {
    const { controller } = makeReadContracts(ethers, CFG);
    const [avail, price] = await Promise.all([
      controller.available(name),
      controller.rentPrice(name, duration),
    ]);
    const total = price.base + price.premium;
    const ethStr = ethers.formatEther(total);
    if ($("livePrice")) {
      $("livePrice").textContent = `${ethStr} ETH`;
    }
    paintUsdBeside(ethStr);
    if ($("liveDiscount")) {
      $("liveDiscount").textContent =
        pct > 0 ? ` (−${pct}% duration discount)` : " (no duration discount)";
    }
    if (!avail) {
      if (!silent) showErr($("regOut"), "Not available.");
      return;
    }
    if (!silent || $("regOut")) {
      $("regOut").textContent =
        `Available: yes\n` +
        `Duration: ${formatDurationSeconds(duration)}\n` +
        `Price: ${ethStr} ETH` +
        (pct > 0 ? `\nDiscount: −${pct}% for longer term` : "");
    }
  } catch (e) {
    if ($("livePrice")) $("livePrice").textContent = "—";
    if ($("livePriceUsd")) $("livePriceUsd").textContent = "";
    showErr($("regOut"), e);
  } finally {
    quoteBusy = false;
  }
}

async function doCommit() {
  if (!signer) await connect();
  const name = normalizeLabel($("regName").value || activeLabel);
  paintAsciiWarn(name);
  if (validateLabel(name)) return showErr($("regOut"), validateLabel(name));
  $("regOut").textContent = "Committing…";
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();
    setConnectedUi();
    refreshPrimaryPill().catch(() => {});
    const { controller: rCtrl } = makeReadContracts(ethers, CFG);
    if (!(await rCtrl.available(name))) return showErr($("regOut"), "Unavailable");
    let pending = getPendingCommit(name, account);
    const secret = pending?.secret || ethers.hexlify(ethers.randomBytes(32));
    const commitment = await rCtrl.makeCommitment(name, account, secret);
    const existingTs = await rCtrl.commitments(commitment);
    const now = Math.floor(Date.now() / 1000);
    if (existingTs > 0n && Number(existingTs) + liveMaxAge > now) {
      setPendingCommit(name, account, {
        secret,
        commitment,
        committedAt: Number(existingTs),
        tx: pending?.tx || "(on-chain)",
        owner: account,
        label: name,
      });
      $("regOut").innerHTML = `<span class="ok">Commitment already on-chain</span>`;
      paintCountdown();
      return;
    }
    const { controller } = makeWriteContracts(ethers, signer, CFG);
    const tx = await controller.commit(commitment);
    setTxStatus($("regOut"), `Submitting…`, tx.hash);
    const rc = await tx.wait();
    setPendingCommit(name, account, {
      secret,
      commitment,
      committedAt: Math.floor(Date.now() / 1000),
      tx: rc.hash,
      owner: account,
      label: name,
    });
    $("regOut").innerHTML = `<span class="ok">Committed</span> ${escapeHtml(name)}.rh<br/>tx ${txLinkHtml(rc.hash)}`;
    paintCountdown();
  } catch (e) {
    showErr($("regOut"), e);
  }
}

async function doRegister() {
  if (!signer) await connect();
  const name = normalizeLabel($("regName").value || activeLabel);
  paintAsciiWarn(name);
  const duration = durationSeconds($("regDuration").value || "1y");
  if (validateLabel(name)) return showErr($("regOut"), validateLabel(name));
  $("regOut").textContent = "Registering…";
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();
    const pending = getPendingCommit(name, account);
    if (!pending?.secret) return showErr($("regOut"), "Commit first (same browser).");
    const { controller: rCtrl } = makeReadContracts(ethers, CFG);
    const commitment = await rCtrl.makeCommitment(name, account, pending.secret);
    const cTs = await rCtrl.commitments(commitment);
    if (cTs === 0n) return showErr($("regOut"), "Commitment missing");
    const now = Math.floor(Date.now() / 1000);
    const age = now - Number(cTs);
    if (age < liveMinAge) return showErr($("regOut"), `Wait ${liveMinAge - age}s more`);
    if (age >= liveMaxAge) return showErr($("regOut"), "Commitment expired");
    const price = await rCtrl.rentPrice(name, duration);
    const total = price.base + price.premium;
    const { controller } = makeWriteContracts(ethers, signer, CFG);
    const tx = await controller.register(
      name,
      account,
      duration,
      pending.secret,
      CFG.addrResolver,
      { value: total }
    );
    setTxStatus($("regOut"), `Submitting…`, tx.hash);
    const rc = await tx.wait();
    clearPendingCommit(name, account);
    rememberLabel(name);
    $("regOut").innerHTML = `<span class="ok">Registered ${escapeHtml(name)}.rh</span><br/>tx ${txLinkHtml(rc.hash)}`;
    if ($("reverseName")) $("reverseName").value = `${name}.rh`;
    await openName(name, { quiet: true });
    await refreshWalletAvatar();
    await refreshPrimaryPill();
    refreshStats().catch(() => {});
  } catch (e) {
    showErr($("regOut"), e);
  }
}

async function doReverse() {
  if (!signer) await connect();
  let name = String($("reverseName").value || "").trim().toLowerCase();
  if (!name) return showErr($("reverseOut"), "Enter name e.g. alice.rh");
  if (!name.endsWith(".rh")) name += ".rh";
  $("reverseOut").hidden = false;
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();
    const { reverse } = makeWriteContracts(ethers, signer, CFG);
    const tx = await reverse.setName(name);
    setTxStatus($("reverseOut"), `Submitting…`, tx.hash);
    await tx.wait();
    const { reverse: rr, resolver } = makeReadContracts(ethers, CFG);
    const node = await rr.node(account);
    const primary = await resolver.name(node);
    $("reverseOut").innerHTML = `<span class="ok">Primary name</span>\n${escapeHtml(primary)}`;
    await refreshWalletAvatar();
    await refreshPrimaryPill();
    await renderMyNames();
  } catch (e) {
    showErr($("reverseOut"), e);
  }
}

async function saveProfileField(key, inputId) {
  if (!signer) await connect();
  const name = normalizeLabel($("profileLabel")?.value || activeLabel);
  if (validateLabel(name)) return showErr($("profileSaveOut"), validateLabel(name));
  if ($("profileLabel")) $("profileLabel").value = name;
  const value = String($(inputId).value || "");
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    const { ens } = makeReadContracts(ethers, CFG);
    const node = ensNode(ethers, name, CFG.tld);
    const res = await ens.resolver(node);
    if (!res || res === ethers.ZeroAddress) return showErr($("profileSaveOut"), "No resolver");
    const r = new ethers.Contract(res, PHASE1_RESOLVER_ABI, signer);
    const tx = await r.setText(node, key, value);
    setTxStatus($("profileSaveOut"), `Saving ${escapeHtml(key)}…`, tx.hash);
    await tx.wait();
    $("profileSaveOut").innerHTML = `<span class="ok">Saved ${escapeHtml(key)}</span><br/>tx ${txLinkHtml(tx.hash)}`;
    await openName(name, { quiet: true });
    if (key === "avatar") await refreshWalletAvatar();
  } catch (e) {
    showErr($("profileSaveOut"), e);
  }
}

/** Save resolver EIP-137 addr (points-to) — used by wallets to resolve name → payment address. */
async function saveAddrField() {
  if (!signer) await connect();
  const name = normalizeLabel($("profileLabel")?.value || activeLabel);
  if (validateLabel(name)) return showErr($("profileSaveOut"), validateLabel(name));
  if ($("profileLabel")) $("profileLabel").value = name;
  const raw = String($("profileAddr")?.value || "").trim();
  if (!raw || !ethers.isAddress(raw)) {
    return showErr($("profileSaveOut"), "Enter a valid 0x address to point this name at");
  }
  const target = ethers.getAddress(raw);
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    const { ens } = makeReadContracts(ethers, CFG);
    const node = ensNode(ethers, name, CFG.tld);
    const res = await ens.resolver(node);
    if (!res || res === ethers.ZeroAddress) {
      return showErr($("profileSaveOut"), "No resolver set on this name");
    }
    const r = new ethers.Contract(res, PHASE1_RESOLVER_ABI, signer);
    const tx = await r["setAddr(bytes32,address)"](node, target);
    setTxStatus($("profileSaveOut"), `Saving points-to…`, tx.hash);
    await tx.wait();
    $("profileSaveOut").innerHTML =
      `<span class="ok">Points to updated</span>\n${escapeHtml(target)}<br/>tx ${txLinkHtml(tx.hash)}`;
    await openName(name, { quiet: true });
  } catch (e) {
    showErr($("profileSaveOut"), e);
  }
}

async function fetchPrimaryName(addr) {
  try {
    const { reverse, resolver } = makeReadContracts(ethers, CFG);
    const node = await reverse.node(addr);
    return await resolver.name(node);
  } catch {
    return "";
  }
}

async function renderMyNames() {
  const box = $("myList");
  if (!box) return;
  if (!account) {
    box.innerHTML = `<div class="hint">Connect a wallet to load names you own on-chain.</div>`;
    if ($("myPrimary")) $("myPrimary").textContent = "(connect first)";
    return;
  }

  box.innerHTML = `<div class="my-loading loading-dot">Loading names for your wallet</div>`;
  if ($("myPrimary")) $("myPrimary").textContent = "Loading…";

  let primary = "";
  try {
    primary = await fetchPrimaryName(account);
  } catch (_) {}
  if ($("myPrimary")) $("myPrimary").textContent = primary || "(none set)";
  if ($("reverseName") && primary) $("reverseName").value = primary;

  // 1) on-chain discovery (no localStorage)
  let chainLabels = [];
  let discSource = "chain";
  try {
    const disc = await discoverOwnedLabels(ethers, account, CFG);
    chainLabels = disc.labels || [];
    discSource = disc.source;
  } catch (_) {
    discSource = "error";
  }

  // 2) merge manual local tracks + verify ownership
  const manual = listTrackedLabels();
  const merged = [...new Set([...chainLabels, ...manual])];

  if (!merged.length) {
    box.innerHTML =
      `<div class="hint">No names found for this wallet yet. Register one, or add a label you already own. ` +
      `(Discovery: ${escapeHtml(discSource)} logs / NFT history.)</div>`;
    return;
  }

  const rows = [];
  for (const label of merged) {
    try {
      const r = await resolveName(ethers, label, CFG);
      const owned =
        account &&
        r.nftOwner &&
        r.nftOwner.toLowerCase() === account.toLowerCase();
      // Auto-forget junk tracks that aren't owned (unless just discovered)
      if (!owned && manual.includes(label) && !chainLabels.includes(label)) {
        // keep listed as warn so user can Forget
      }
      const isPrimary =
        primary &&
        (primary.toLowerCase() === `${label}.rh` ||
          primary.toLowerCase() === label);
      const av = avatarPreviewUrl(r.texts?.avatar) || DEFAULT_AVATAR;
      rows.push(
        `<div class="name-row">
          <div class="row" style="gap:.65rem">
            <img src="${escapeHtml(av)}" class="wallet-avatar" alt="" onerror="this.src='${DEFAULT_AVATAR}'" />
            <div>
              <strong>${escapeHtml(label)}.rh</strong>
              ${owned ? '<span class="pill ok">owned</span>' : '<span class="pill warn">not yours / expired?</span>'}
              ${isPrimary ? '<span class="pill phase">primary</span>' : ""}
              <div class="hint">exp ${escapeHtml(fmtTsHuman(r.exp))}</div>
            </div>
          </div>
          <div class="row">
            <button class="secondary tiny" type="button" data-open="${escapeHtml(label)}">Open</button>
            ${
              owned
                ? `<button class="accent tiny" type="button" data-primary="${escapeHtml(label)}.rh">Set primary</button>`
                : ""
            }
            <button class="secondary tiny" type="button" data-forget="${escapeHtml(label)}">Forget</button>
          </div>
        </div>`
      );
      if (owned) rememberLabel(label);
    } catch (e) {
      rows.push(
        `<div class="name-row"><span class="err">${escapeHtml(label)}: ${escapeHtml(formatError(e, errOpts()))}</span></div>`
      );
    }
  }
  box.innerHTML = rows.join("");
  box.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => openName(b.getAttribute("data-open")))
  );
  box.querySelectorAll("[data-forget]").forEach((b) =>
    b.addEventListener("click", () => {
      removeTrackedLabel(b.getAttribute("data-forget"));
      renderMyNames();
    })
  );
  box.querySelectorAll("[data-primary]").forEach((b) =>
    b.addEventListener("click", async () => {
      $("reverseName").value = b.getAttribute("data-primary");
      await doReverse();
    })
  );
}

function setFooter() {
  const foot = $("footerAddrs");
  if (foot) foot.textContent = "rh.names · Robinhood Mainnet · Phase-1 ENS";
  const set = (id, val) => {
    const el = $(id);
    if (!el) return;
    el.textContent = val;
  };
  set("footerResolver", CFG.addrResolver);
  set("footerCollector", CFG.controller); // rent accrued on controller until withdraw()
  set("footerRegistry", CFG.registry);
  set("footerController", CFG.controller);
  set("footerBase", CFG.baseRegistrar);
  set("footerMultisig", CFG.multisig);
}

function wire() {
  initTheme();
  fillDurationSelect($("regDuration"), { selected: "1y" });
  setFooter();

  refreshPrices();
  refreshStats();
  fetchEthUsd().catch(() => {});
  startCountdownLoop();
  setConnectedUi();
  setImg($("walletAvatar"), DEFAULT_AVATAR);
  setImg($("nameAvatar"), DEFAULT_AVATAR);
  setImg($("fieldAvatar"), DEFAULT_AVATAR);

  $("connectBtn").onclick = () => connect().catch((e) => alert(formatError(e, errOpts())));
  if ($("disconnectBtn")) $("disconnectBtn").onclick = () => disconnect();

  $("heroSearchBtn").onclick = () => doSearchFrom("heroSearch");
  $("heroSearch").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") doSearchFrom("heroSearch");
  });
  $("heroSearch").addEventListener("input", () => paintAsciiWarn($("heroSearch").value));
  if ($("nameSearchBtn")) {
    $("nameSearchBtn").onclick = () => doSearchFrom("nameSearch");
    $("nameSearch").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") doSearchFrom("nameSearch");
    });
    $("nameSearch").addEventListener("input", () => paintAsciiWarn($("nameSearch").value));
  }

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const n = el.getAttribute("data-nav");
      showView(n);
      if (n === "my") renderMyNames();
      if (n === "search") $("heroSearch")?.focus();
    });
  });

  document.querySelectorAll("#nameTabs [data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => showNameTab(btn.getAttribute("data-tab")));
  });

  $("quoteBtn").onclick = () => doQuote();
  $("commitBtn").onclick = () => doCommit();
  $("regBtn").onclick = () => doRegister();
  $("regDuration").onchange = () => doQuote().catch(() => {});
  $("reverseBtn").onclick = () => doReverse();
  $("saveUrlBtn").onclick = () => saveProfileField("url", "profileUrl");
  $("saveAvatarBtn").onclick = () => saveProfileField("avatar", "profileAvatar");
  $("saveDescBtn").onclick = () => saveProfileField("description", "profileDesc");
  if ($("saveAddrBtn")) $("saveAddrBtn").onclick = () => saveAddrField();
  $("profileAvatar").addEventListener("input", () => {
    paintAvatarSurfaces($("profileAvatar").value);
  });
  $("addTrackBtn").onclick = () => {
    const n = normalizeLabel($("addTrack").value);
    if (validateLabel(n)) return alert(validateLabel(n));
    rememberLabel(n);
    $("addTrack").value = "";
    renderMyNames();
  };
  $("clearCommitBtn").onclick = () => {
    if (account) {
      const n = normalizeLabel($("regName").value || activeLabel);
      if (n) clearPendingCommit(n, account);
      else clearAllCommits();
    } else clearAllCommits();
    paintCountdown();
  };

  const params = new URLSearchParams(location.search);
  if (params.get("name")) openName(params.get("name"));
  else showView("search");

  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", (accs) => {
      if (!accs?.length) disconnect();
      else connect().catch(() => {});
    });
  }

  // Silent pageview counter (no cookies / no UI). Every full load/refresh hits once.
  // Uses a free privacy-friendly counter service suitable for static GH Pages.
  // To read total: GET https://abacus.jasoncameron.dev/get/rh-names/public-fe
  try {
    fetch("https://abacus.jasoncameron.dev/hit/rh-names/public-fe", {
      mode: "no-cors",
      cache: "no-store",
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}
}

if (!window.ethers) {
  document.body.insertAdjacentHTML("afterbegin", '<p class="err">ethers CDN failed</p>');
} else {
  makeReadContracts(ethers, CFG)
    .controller.minCommitmentAge()
    .then(async (m) => {
      liveMinAge = Number(m);
      liveMaxAge = Number(
        await makeReadContracts(ethers, CFG).controller.maxCommitmentAge()
      );
    })
    .catch(() => {});
  wire();
}
