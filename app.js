/**
 * Public product home — Phase-1 only (ENS-shaped search-first).
 * V4 lives at internal-v4.html for ops; not linked from public nav.
 */
import { PHASE1 } from "./sdk/chain.js";
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
} from "./sdk/duration.js";
import { escapeHtml, formatError, PHASE1_ERROR_BY_SEL } from "./sdk/errors.js";
import { normalizeLabel, validateLabel } from "./sdk/labels.js";
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

function setConnectedUi() {
  const disc = $("disconnectBtn");
  if (!account) {
    $("connectBtn").textContent = "Connect";
    $("connectBtn").hidden = false;
    if (disc) disc.hidden = true;
    $("netPill").textContent = "not connected";
    $("netPill").classList.remove("ok");
    // Default stock avatar near connect when disconnected
    setImg($("walletAvatar"), DEFAULT_AVATAR);
    return;
  }
  $("connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);
  $("connectBtn").hidden = false;
  if (disc) disc.hidden = false;
  $("netPill").textContent = "RH " + account.slice(0, 6) + "…";
  $("netPill").classList.add("ok");
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
  // Prefer primary name avatar when reverse is set.
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
  await refreshPrices();
  await refreshWalletAvatar();
  if (activeView === "my") await renderMyNames();
  if (activeLabel) await openName(activeLabel, { quiet: true });
}

async function refreshPrices() {
  try {
    const { p3, p4, p5 } = await loadOraclePrices(ethers, CFG);
    $("pricePills").innerHTML =
      `<span class="pill">3 ≈ ${ethers.formatEther(p3)} ETH/yr</span>` +
      `<span class="pill">4 ≈ ${ethers.formatEther(p4)} ETH/yr</span>` +
      `<span class="pill">5+ ≈ ${ethers.formatEther(p5)} ETH/yr</span>`;
    const how = $("howPriceHint");
    if (how) {
      how.textContent =
        `${ethers.formatEther(p3)} / ${ethers.formatEther(p4)} / ${ethers.formatEther(p5)} ETH per year`;
    }
  } catch (e) {
    $("pricePills").innerHTML = `<span class="pill warn">${escapeHtml(formatError(e, errOpts()))}</span>`;
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

async function openName(raw, { quiet = false } = {}) {
  const name = normalizeLabel(raw);
  const v = validateLabel(name);
  if (v) {
    if (!quiet) showErr($("searchOut"), v);
    return;
  }
  activeLabel = name;
  showView("name");
  if (!quiet) showNameTab("overview");

  $("profileTitle").textContent = `${name}.rh`;
  if ($("heroSearch")) $("heroSearch").value = name;
  if ($("nameSearch")) $("nameSearch").value = name;
  if ($("regName")) $("regName").value = name;
  if ($("profileLabel")) $("profileLabel").value = name;

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
    $("ownOwner").textContent = r.regOwner && r.regOwner !== ethers.ZeroAddress ? r.regOwner : "—";
    $("ownNft").textContent = r.nftOwner && r.nftOwner !== ethers.ZeroAddress ? r.nftOwner : "—";
    $("ownExp").textContent = fmtTsHuman(r.exp);
    $("ownAvail").textContent = r.avail ? "Available to register" : "Registered";
    $("ownBio").textContent = texts.description || "—";
    $("ownUrl").textContent = texts.url || "—";
    $("ownAddr").textContent =
      r.addr && r.addr !== ethers.ZeroAddress ? r.addr : "—";
    paintAvatarSurfaces(texts.avatar || "");

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

    if (account && r.nftOwner && r.nftOwner.toLowerCase() === account.toLowerCase()) {
      rememberLabel(name);
    }
    paintCountdown();
    if (r.avail) await doQuote({ silent: true });
    else {
      if ($("livePrice")) $("livePrice").textContent = "—";
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
  if ($("searchOut")) $("searchOut").textContent = "Searching…";
  await openName(q);
}

async function doQuote({ silent = false } = {}) {
  if (quoteBusy) return;
  const name = normalizeLabel($("regName")?.value || activeLabel);
  const duration = durationSeconds($("regDuration")?.value || "1y");
  const pct = discountPercentForDuration(duration);
  if (!silent) $("regOut").textContent = "Quoting…";
  const v = validateLabel(name);
  if (v) {
    if ($("livePrice")) $("livePrice").textContent = "—";
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
    if ($("livePrice")) {
      $("livePrice").textContent = `${ethers.formatEther(total)} ETH`;
    }
    if ($("liveDiscount")) {
      $("liveDiscount").textContent = pct > 0 ? ` (−${pct}% duration discount)` : " (no duration discount)";
    }
    if (!avail) {
      if (!silent) showErr($("regOut"), "Not available.");
      return;
    }
    if (!silent || $("regOut")) {
      $("regOut").textContent =
        `Available: yes\n` +
        `Duration: ${formatDurationSeconds(duration)}\n` +
        `Price: ${ethers.formatEther(total)} ETH` +
        (pct > 0 ? `\nDiscount: −${pct}% for longer term` : "");
    }
  } catch (e) {
    if ($("livePrice")) $("livePrice").textContent = "—";
    showErr($("regOut"), e);
  } finally {
    quoteBusy = false;
  }
}

async function doCommit() {
  if (!signer) await connect();
  const name = normalizeLabel($("regName").value || activeLabel);
  if (validateLabel(name)) return showErr($("regOut"), validateLabel(name));
  $("regOut").textContent = "Committing…";
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();
    setConnectedUi();
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
    $("regOut").textContent = `tx ${tx.hash}…`;
    const rc = await tx.wait();
    setPendingCommit(name, account, {
      secret,
      commitment,
      committedAt: Math.floor(Date.now() / 1000),
      tx: rc.hash,
      owner: account,
      label: name,
    });
    $("regOut").innerHTML = `<span class="ok">Committed</span> ${escapeHtml(name)}.rh\ntx ${rc.hash}`;
    paintCountdown();
  } catch (e) {
    showErr($("regOut"), e);
  }
}

async function doRegister() {
  if (!signer) await connect();
  const name = normalizeLabel($("regName").value || activeLabel);
  const duration = durationSeconds($("regDuration").value);
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
    const tx = await controller.register(name, account, duration, pending.secret, CFG.addrResolver, {
      value: total,
    });
    $("regOut").textContent = `tx ${tx.hash}…`;
    const rc = await tx.wait();
    clearPendingCommit(name, account);
    rememberLabel(name);
    $("regOut").innerHTML = `<span class="ok">Registered ${escapeHtml(name)}.rh</span>\ntx ${rc.hash}`;
    if ($("reverseName")) $("reverseName").value = `${name}.rh`;
    await openName(name, { quiet: true });
    await refreshWalletAvatar();
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
    $("reverseOut").textContent = `tx ${tx.hash}…`;
    await tx.wait();
    const { reverse: rr, resolver } = makeReadContracts(ethers, CFG);
    const node = await rr.node(account);
    const primary = await resolver.name(node);
    $("reverseOut").innerHTML = `<span class="ok">Primary name</span>\n${escapeHtml(primary)}`;
    await refreshWalletAvatar();
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
    const { ens, provider } = makeReadContracts(ethers, CFG);
    const node = ensNode(ethers, name, CFG.tld);
    const res = await ens.resolver(node);
    if (!res || res === ethers.ZeroAddress) return showErr($("profileSaveOut"), "No resolver");
    const r = new ethers.Contract(res, PHASE1_RESOLVER_ABI, signer);
    const tx = await r.setText(node, key, value);
    $("profileSaveOut").textContent = `tx ${tx.hash}…`;
    await tx.wait();
    $("profileSaveOut").innerHTML = `<span class="ok">Saved ${escapeHtml(key)}</span>`;
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
    $("profileSaveOut").textContent = `tx ${tx.hash}…`;
    await tx.wait();
    $("profileSaveOut").innerHTML =
      `<span class="ok">Points to updated</span>\n${escapeHtml(target)}`;
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
    box.innerHTML = `<div class="hint">Connect a wallet to manage names tracked in this browser.</div>`;
    if ($("myPrimary")) $("myPrimary").textContent = "(connect first)";
    return;
  }

  box.innerHTML = `<div class="hint loading-dot">Loading names for your wallet</div>`;
  if ($("myPrimary")) $("myPrimary").textContent = "Loading…";

  let primary = "";
  try {
    primary = await fetchPrimaryName(account);
  } catch (_) {}
  if ($("myPrimary")) $("myPrimary").textContent = primary || "(none set)";
  if ($("reverseName") && primary) $("reverseName").value = primary;

  const labels = listTrackedLabels();
  if (!labels.length) {
    box.innerHTML =
      `<div class="hint">No tracked names yet. Register one, or add a label you already own. ` +
      `Full portfolio history needs an indexer later.</div>`;
    return;
  }

  const rows = [];
  for (const label of labels) {
    try {
      const r = await resolveName(ethers, label, CFG);
      const owned =
        account &&
        r.nftOwner &&
        r.nftOwner.toLowerCase() === account.toLowerCase();
      const isPrimary = primary && primary.toLowerCase() === `${label}.rh`;
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

function wire() {
  initTheme();
  fillDurationSelect($("regDuration"), { selected: "1y" });

  const foot = $("footerAddrs");
  if (foot) foot.textContent = "rh.names · Robinhood Mainnet · Phase-1 ENS";

  refreshPrices();
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
  if ($("nameSearchBtn")) {
    $("nameSearchBtn").onclick = () => doSearchFrom("nameSearch");
    $("nameSearch").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") doSearchFrom("nameSearch");
    });
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
}

if (!window.ethers) {
  document.body.insertAdjacentHTML("afterbegin", '<p class="err">ethers CDN failed</p>');
} else {
  makeReadContracts(ethers, CFG)
    .controller.minCommitmentAge()
    .then(async (m) => {
      liveMinAge = Number(m);
      liveMaxAge = Number(await makeReadContracts(ethers, CFG).controller.maxCommitmentAge());
    })
    .catch(() => {});
  wire();
}
