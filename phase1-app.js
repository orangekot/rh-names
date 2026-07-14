/**
 * Phase-1 ENS app wiring (ES module). Depends on global `ethers` from CDN.
 * Served alongside phase1.html over HTTP so modules resolve.
 */
import { PHASE1 } from "./sdk/chain.js";
import { commitmentTiming, clearAllCommits, clearPendingCommit, getPendingCommit, loadCommitMap, setPendingCommit } from "./sdk/commit-store.js";
import { durationSeconds, fillDurationSelect, formatCountdown, formatDurationSeconds, discountPercentForDuration } from "./sdk/duration.js";
import { escapeHtml, formatError, PHASE1_ERROR_BY_SEL } from "./sdk/errors.js";
import { normalizeLabel, validateLabel } from "./sdk/labels.js";
import {
  avatarPreviewUrl,
  ensNode,
  formatLookupSummary,
  formatProfileSummary,
  fmtTs,
  fmtTsHuman,
  labelTokenId,
  loadOraclePrices,
  loadStackInfo,
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

let browserProvider, signer, account;
/** Live ages from chain; fall back to CFG constants. */
let liveMinAge = CFG.minCommitAge;
let liveMaxAge = CFG.maxCommitAge;
let countdownTimer = null;

function errOpts() {
  return { ethers, selectors: PHASE1_ERROR_BY_SEL };
}

function showErr(el, e) {
  el.innerHTML = `<span class="err">${escapeHtml(formatError(e, errOpts()))}</span>`;
}

function setFooter() {
  // Public product keeps only light branding — contract plumbing lives under #devDetails.
  const line = $("footerSimple");
  if (line) {
    line.textContent =
      `Phase-1 ENS · Robinhood Mainnet (${CFG.chainId}) · dual stack with V4 (names do not auto-merge)`;
  }
  const fill = (id, val) => {
    const el = $(id);
    if (el) el.textContent = val;
  };
  fill("ensLine", CFG.registry);
  fill("baseLine", CFG.baseRegistrar);
  fill("ctrlLine", CFG.controller);
  fill("oracleLine", CFG.oracle);
  fill("revLine", CFG.reverseRegistrar);
  fill("resLine", CFG.addrResolver);
  fill("msLine", CFG.multisig);
}

function currentRegLabel() {
  return normalizeLabel($("regName").value);
}

function paintCountdown() {
  const bar = $("countdownBar");
  const label = $("countdownLabel");
  const fill = $("countdownFill");
  const regBtn = $("regBtn");
  if (!bar || !label || !fill || !regBtn) return;

  const name = currentRegLabel();
  const pending = account && name ? getPendingCommit(name, account) : null;
  const now = Math.floor(Date.now() / 1000);
  const t = commitmentTiming(pending, now, liveMinAge, liveMaxAge);

  // Always allow quote/commit; only gate Register.
  if (!pending) {
    bar.classList.remove("ready", "warn", "expired");
    bar.classList.add("idle");
    label.textContent = "No local secret for this label + wallet — commit first.";
    fill.style.width = "0%";
    regBtn.disabled = true;
    regBtn.title = "Commit and wait for the timer before registering";
    return;
  }

  bar.classList.remove("idle");
  if (t.expired) {
    bar.classList.remove("ready", "warn");
    bar.classList.add("expired");
    label.textContent = `Commitment expired (${t.age}s ≥ ${liveMaxAge}s). Clear and re-commit.`;
    fill.style.width = "100%";
    regBtn.disabled = true;
    regBtn.title = "Commitment too old";
    return;
  }

  if (t.ready) {
    bar.classList.remove("warn", "expired");
    bar.classList.add("ready");
    const untilMax = liveMaxAge - t.age;
    label.textContent =
      `Ready to register · age ${formatCountdown(t.age)} · commitment expires in ${formatCountdown(untilMax)}`;
    fill.style.width = "100%";
    regBtn.disabled = false;
    regBtn.title = "Reveal + pay rent";
    return;
  }

  bar.classList.remove("ready", "expired");
  bar.classList.add("warn");
  const pct = Math.min(100, Math.round((t.age / liveMinAge) * 100));
  label.textContent =
    `Waiting… ${formatCountdown(t.remaining)} until register (age ${formatCountdown(t.age)} / ${formatCountdown(liveMinAge)})`;
  fill.style.width = `${pct}%`;
  regBtn.disabled = true;
  regBtn.title = `Wait ${formatCountdown(t.remaining)} more`;
}

function startCountdownLoop() {
  if (countdownTimer) clearInterval(countdownTimer);
  paintCountdown();
  countdownTimer = setInterval(paintCountdown, 250);
}

function renderCommitHelper() {
  const map = loadCommitMap();
  const keys = Object.keys(map);
  if (!keys.length) {
    $("commitOut").textContent = "No pending commitment.";
    paintCountdown();
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  $("commitOut").textContent = keys
    .map((k) => {
      const c = map[k];
      const t = commitmentTiming(c, now, liveMinAge, liveMaxAge);
      return (
        `${k}\n` +
        `  commitment: ${c.commitment}\n` +
        `  secret: ${c.secret}\n` +
        `  age: ${t.age ?? "?"}s · ready: ${t.ready} · expired: ${t.expired}\n` +
        `  tx: ${c.tx || "(n/a)"}`
      );
    })
    .join("\n\n");
  paintCountdown();
}

function paintDurationMeta() {
  const key = $("regDuration")?.value;
  if (!key || !$("durationMeta")) return;
  const sec = durationSeconds(key);
  const human = formatDurationSeconds(sec);
  const pct = discountPercentForDuration(sec);
  $("durationMeta").innerHTML =
    `${human} · rent = yearly_tier × duration / 365 days` +
    (pct > 0
      ? ` · <span class="discount" style="color:var(--danger);font-weight:700">−${pct}% duration discount</span>`
      : " · no duration discount");
}

async function refreshPrices() {
  try {
    const { p3, p4, p5 } = await loadOraclePrices(ethers, CFG);
    $("pricePills").innerHTML =
      `<span class="pill">3ch / yr: ${ethers.formatEther(p3)} ETH</span>` +
      `<span class="pill">4ch / yr: ${ethers.formatEther(p4)} ETH</span>` +
      `<span class="pill">5+ / yr: ${ethers.formatEther(p5)} ETH</span>` +
      `<span class="pill phase">Phase-1 controller</span>`;
  } catch (e) {
    $("pricePills").innerHTML = `<span class="pill warn">${escapeHtml(formatError(e, errOpts()))}</span>`;
  }
}

async function refreshInfo() {
  try {
    const info = await loadStackInfo(ethers, CFG);
    liveMinAge = info.minAge || CFG.minCommitAge;
    liveMaxAge = info.maxAge || CFG.maxCommitAge;
    let walletChain = "(none)";
    if (window.ethereum) {
      try {
        walletChain = await window.ethereum.request({ method: "eth_chainId" });
      } catch (_) {}
    }
    if (info.ensCode === "0x" || info.ctrlCode === "0x") {
      throw new Error("Missing code on Phase-1 addresses — RPC/config wrong");
    }
    $("infoOut").textContent =
      `read RPC chainId: ${info.network.chainId}\n` +
      `wallet eth_chainId: ${walletChain}\n` +
      `base.ens matches registry: ${info.baseEns.toLowerCase() === CFG.registry.toLowerCase()}\n` +
      `base.baseNode matches namehash(rh): ${info.baseNode.toLowerCase() === CFG.baseNode.toLowerCase()}\n` +
      `base.controllers(controller v2): ${info.ctrlOk}\n` +
      `commit age window: ${info.minAge}s … ${info.maxAge}s\n` +
      `MIN_REGISTRATION_DURATION: ${info.minDur}s (${info.minDur / 86400} days)\n` +
      `reverse.defaultResolver: ${info.defRes}` +
      (account ? `\nconnected: ${account}` : "\nconnected: (none)");
    paintCountdown();
  } catch (e) {
    showErr($("infoOut"), e);
  }
}

function setConnectedUi() {
  const disc = $("disconnectBtn");
  if (!account) {
    if ($("connectBtn")) {
      $("connectBtn").textContent = "Connect wallet";
      $("connectBtn").hidden = false;
    }
    if (disc) disc.hidden = true;
    if ($("netPill")) {
      $("netPill").textContent = "not connected";
      $("netPill").classList.remove("ok");
    }
    return;
  }
  if ($("connectBtn")) $("connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);
  if (disc) disc.hidden = false;
  if ($("netPill")) {
    $("netPill").textContent = "Robinhood · " + account.slice(0, 6) + "…";
    $("netPill").classList.add("ok");
  }
}

function disconnect() {
  signer = null;
  account = null;
  browserProvider = null;
  setConnectedUi();
  paintCountdown();
  renderMyNames();
}

async function connect() {
  const w = await connectWallet(ethers, CFG);
  browserProvider = w.browserProvider;
  signer = w.signer;
  account = w.account;
  setConnectedUi();
  if (!$("stackStatusCard")?.hidden) await refreshInfo();
  else {
    try {
      const info = await loadStackInfo(ethers, CFG);
      liveMinAge = info.minAge || CFG.minCommitAge;
      liveMaxAge = info.maxAge || CFG.maxCommitAge;
      paintCountdown();
    } catch (_) {}
  }
  renderCommitHelper();
  await renderMyNames();
}

async function doResolve() {
  const name = normalizeLabel($("resolveName").value);
  const v = validateLabel(name);
  $("resolveOut").textContent = "Looking up…";
  if (v) {
    showErr($("resolveOut"), v);
    return;
  }
  try {
    const r = await resolveName(ethers, name, CFG);
    // User-facing summary only. Chain plumbing (node / tokenId / controller
    // flags / zero-address dumps) stays out of the default panel.
    $("resolveOut").textContent = formatLookupSummary(r, { ethers });
    // Prefill profile panel
    $("profileLabel").value = name;
    await loadProfile(name, r);
  } catch (e) {
    showErr($("resolveOut"), e);
  }
}

async function loadProfile(name, prefetched) {
  const panel = $("profileOut");
  const av = $("avatarPreview");
  try {
    const r = prefetched || (await resolveName(ethers, name, CFG));
    const url = r.texts?.url || "";
    const avatar = r.texts?.avatar || "";
    const desc = r.texts?.description || "";
    const tw = r.texts?.["com.twitter"] || "";
    const gh = r.texts?.["com.github"] || "";
    const email = r.texts?.email || "";

    $("profileUrl").value = url;
    $("profileAvatar").value = avatar;
    $("profileDesc").value = desc;
    $("profileTwitter").value = tw;
    $("profileGithub").value = gh;
    $("profileEmail").value = email;

    const preview = avatarPreviewUrl(avatar);
    if (preview) {
      av.src = preview;
      av.hidden = false;
    } else {
      av.removeAttribute("src");
      av.hidden = true;
    }

    panel.textContent = formatProfileSummary(
      r,
      {
        url,
        avatar,
        description: desc,
        "com.twitter": tw,
        "com.github": gh,
        email,
      },
    );
  } catch (e) {
    showErr(panel, e);
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
  const primaryEl = $("myPrimary");
  if (!box) return;
  if (!account) {
    box.innerHTML = `<div class="hint">Connect a wallet to see known .rh names for this browser.</div>`;
    if (primaryEl) primaryEl.textContent = "(connect first)";
    return;
  }
  const primary = await fetchPrimaryName(account);
  if (primaryEl) primaryEl.textContent = primary || "(none set)";

  // BaseRegistrar is ERC-721 without enumeration — no full wallet portfolio
  // without an indexer later. Track labels this browser registered/added.
  const labels = listTrackedLabels();
  if (!labels.length) {
    box.innerHTML =
      `<div class="hint">No tracked names yet. Register one, or add a label you already own below. ` +
      `A full portfolio would need an indexer (ENS-style subgraph) — planned, not in Phase‑1 UI.</div>`;
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
      rows.push(
        `<div class="name-row">
          <div>
            <strong>${escapeHtml(label)}.rh</strong>
            ${owned ? '<span class="pill ok">owned</span>' : '<span class="pill warn">not yours / expired?</span>'}
            ${isPrimary ? '<span class="pill phase">primary</span>' : ""}
            <div class="hint">expires ${escapeHtml(fmtTsHuman(r.exp))}</div>
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
  if (rows.length) box.innerHTML = rows.join("");
  box.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => {
      const label = b.getAttribute("data-open");
      $("resolveName").value = label;
      $("profileLabel").value = label;
      $("renewName").value = label;
      $("regName").value = label;
      doResolve().catch(() => {});
    })
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
      await renderMyNames();
    })
  );
}

async function doQuote() {
  const name = normalizeLabel($("regName").value);
  const duration = durationSeconds($("regDuration").value);
  $("regOut").textContent = "Quoting…";
  const v = validateLabel(name);
  if (v) {
    showErr($("regOut"), v);
    return;
  }
  try {
    const { controller } = makeReadContracts(ethers, CFG);
    const [avail, price] = await Promise.all([
      controller.available(name),
      controller.rentPrice(name, duration),
    ]);
    const total = price.base + price.premium;
    if (!avail) {
      showErr($("regOut"), "Unavailable on Phase-1 controller (taken / invalid).");
      return;
    }
    $("regOut").textContent =
      `Available: yes\n` +
      `Duration: ${formatDurationSeconds(duration)}\n` +
      `Price: ${ethers.formatEther(total)} ETH` +
      (price.premium > 0n ? ` (premium ${ethers.formatEther(price.premium)} ETH)` : "");
  } catch (e) {
    showErr($("regOut"), e);
  }
}

async function doCommit() {
  if (!signer) await connect();
  const name = normalizeLabel($("regName").value);
  const v = validateLabel(name);
  $("regOut").textContent = "Preparing commitment…";
  if (v) {
    showErr($("regOut"), v);
    return;
  }
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();

    const { controller: rCtrl } = makeReadContracts(ethers, CFG);
    const avail = await rCtrl.available(name);
    if (!avail) {
      showErr($("regOut"), "Unavailable — cannot commit for this label.");
      return;
    }

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
        tx: pending?.tx || "(already on-chain)",
        owner: account,
        label: name,
      });
      const age = now - Number(existingTs);
      $("regOut").innerHTML =
        `<span class="ok">Commitment already on-chain</span>\n` +
        `commitment: ${commitment}\n` +
        `age: ${age}s · need ≥ ${liveMinAge}s\n` +
        `secret stored in browser localStorage for register step.`;
      renderCommitHelper();
      return;
    }

    const { controller } = makeWriteContracts(ethers, signer, CFG);
    const tx = await controller.commit(commitment);
    $("regOut").textContent = `commit tx: ${tx.hash}\nwaiting…`;
    const rc = await tx.wait();
    const committedAt = Math.floor(Date.now() / 1000);
    setPendingCommit(name, account, {
      secret,
      commitment,
      committedAt,
      tx: rc.hash,
      owner: account,
      label: name,
    });
    $("regOut").innerHTML =
      `<span class="ok">Committed ${escapeHtml(name)}.rh</span>\n` +
      `commitment: ${commitment}\n` +
      `tx: ${rc.hash}\n` +
      `Wait ≥ ${liveMinAge}s then click Register (same wallet).`;
    renderCommitHelper();
  } catch (e) {
    showErr($("regOut"), e);
  }
}

async function doRegister() {
  if (!signer) await connect();
  const name = normalizeLabel($("regName").value);
  const duration = durationSeconds($("regDuration").value);
  $("regOut").textContent = "Registering…";
  const v = validateLabel(name);
  if (v) {
    showErr($("regOut"), v);
    return;
  }
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();

    const pending = getPendingCommit(name, account);
    if (!pending?.secret) {
      showErr(
        $("regOut"),
        "No local secret for this label+wallet. Click Commit first (same browser)."
      );
      return;
    }

    const { controller: rCtrl, ens, base } = makeReadContracts(ethers, CFG);
    const commitment = await rCtrl.makeCommitment(name, account, pending.secret);
    const cTs = await rCtrl.commitments(commitment);
    if (cTs === 0n) {
      showErr($("regOut"), "CommitmentMissing on-chain — commit again.");
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const age = now - Number(cTs);
    if (age < liveMinAge) {
      showErr(
        $("regOut"),
        `CommitmentTooNew — wait ${liveMinAge - age}s more (age ${age}s).`
      );
      paintCountdown();
      return;
    }
    if (age >= liveMaxAge) {
      showErr($("regOut"), "CommitmentTooOld — clear secret and commit again.");
      return;
    }

    const price = await rCtrl.rentPrice(name, duration);
    const total = price.base + price.premium;

    const { controller } = makeWriteContracts(ethers, signer, CFG);
    const tx = await controller.register(name, account, duration, pending.secret, CFG.addrResolver, {
      value: total,
    });
    $("regOut").textContent = `register tx: ${tx.hash}\nwaiting…`;
    const rc = await tx.wait();

    const node = ensNode(ethers, name, CFG.tld);
    const tokenId = labelTokenId(ethers, name);
    const [regOwner, res, exp, nftOwner] = await Promise.all([
      ens.owner(node),
      ens.resolver(node),
      base.nameExpires(tokenId),
      base.ownerOf(tokenId).catch(() => ethers.ZeroAddress),
    ]);
    let addr = ethers.ZeroAddress;
    if (res && res !== ethers.ZeroAddress) {
      try {
        const r = new ethers.Contract(res, PHASE1_RESOLVER_ABI, makeReadContracts(ethers, CFG).provider);
        addr = await r.addr(node);
      } catch (_) {}
    }
    clearPendingCommit(name, account);
    rememberLabel(name);
    $("regOut").innerHTML =
      `<span class="ok">Registered ${escapeHtml(name)}.rh</span>\n` +
      `Owner: ${nftOwner && nftOwner !== ethers.ZeroAddress ? nftOwner : regOwner}\n` +
      `Expires: ${fmtTsHuman(exp)}\n` +
      (addr && addr !== ethers.ZeroAddress ? `Points to: ${addr}\n` : "") +
      `Tx: ${rc.hash}\n` +
      `Next: set reverse primary and fill profile.`;
    $("reverseName").value = `${name}.rh`;
    $("resolveName").value = name;
    $("profileLabel").value = name;
    $("renewName").value = name;
    renderCommitHelper();
    await refreshInfo();
    await loadProfile(name);
    await renderMyNames();
  } catch (e) {
    showErr($("regOut"), e);
  }
}

async function doReverse() {
  if (!signer) await connect();
  let name = String($("reverseName").value || "").trim().toLowerCase();
  if (!name) {
    showErr($("reverseOut"), "Enter fully-qualified name e.g. mylabel.rh");
    return;
  }
  if (!name.endsWith(".rh")) name = name + ".rh";
  $("reverseOut").textContent = "Submitting setName…";
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();

    const { reverse } = makeWriteContracts(ethers, signer, CFG);
    const tx = await reverse.setName(name);
    $("reverseOut").textContent = `tx: ${tx.hash}\nwaiting…`;
    const rc = await tx.wait();

    const { reverse: rRead, resolver } = makeReadContracts(ethers, CFG);
    const node = await rRead.node(account);
    const primary = await resolver.name(node);
    $("reverseOut").innerHTML =
      `<span class="ok">Primary name set</span>\n` +
      `Wallet: ${account}\n` +
      `Primary: ${primary || "(empty)"}\n` +
      `Tx: ${rc.hash}`;
    await renderMyNames();
  } catch (e) {
    showErr($("reverseOut"), e);
  }
}

async function doRenewQuote() {
  const name = normalizeLabel($("renewName").value);
  const duration = durationSeconds($("renewDuration").value);
  $("renewOut").textContent = "Quoting renew…";
  const v = validateLabel(name);
  if (v) {
    showErr($("renewOut"), v);
    return;
  }
  try {
    const { controller, base, ens } = makeReadContracts(ethers, CFG);
    const node = ensNode(ethers, name, CFG.tld);
    const tokenId = labelTokenId(ethers, name);
    const [price, exp, regOwner, nftOwner] = await Promise.all([
      controller.rentPrice(name, duration),
      base.nameExpires(tokenId),
      ens.owner(node),
      base.ownerOf(tokenId).catch(() => ethers.ZeroAddress),
    ]);
    const total = price.base + price.premium;
    $("renewOut").textContent =
      `Owner: ${nftOwner && nftOwner !== ethers.ZeroAddress ? nftOwner : regOwner}\n` +
      `Current expiry: ${fmtTsHuman(exp)}\n` +
      `Extend by: ${formatDurationSeconds(duration)}\n` +
      `Renew cost: ${ethers.formatEther(total)} ETH`;
  } catch (e) {
    showErr($("renewOut"), e);
  }
}

async function doRenew() {
  if (!signer) await connect();
  const name = normalizeLabel($("renewName").value);
  const duration = durationSeconds($("renewDuration").value);
  $("renewOut").textContent = "Submitting renew…";
  const v = validateLabel(name);
  if (v) {
    showErr($("renewOut"), v);
    return;
  }
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();

    const { controller: rCtrl, base } = makeReadContracts(ethers, CFG);
    const price = await rCtrl.rentPrice(name, duration);
    const total = price.base + price.premium;
    const { controller } = makeWriteContracts(ethers, signer, CFG);
    const tx = await controller.renew(name, duration, { value: total });
    $("renewOut").textContent = `tx: ${tx.hash}\nwaiting…`;
    const rc = await tx.wait();
    const exp = await base.nameExpires(labelTokenId(ethers, name));
    $("renewOut").innerHTML =
      `<span class="ok">Renewed ${escapeHtml(name)}.rh</span>\n` +
      `New expiry: ${fmtTsHuman(exp)}\n` +
      `Tx: ${rc.hash}`;
  } catch (e) {
    showErr($("renewOut"), e);
  }
}

async function doTextRead() {
  const name = normalizeLabel($("textLabel").value);
  const key = String($("textKey").value || "").trim();
  const v = validateLabel(name);
  $("textOut").textContent = "Reading…";
  if (v) {
    showErr($("textOut"), v);
    return;
  }
  if (!key) {
    showErr($("textOut"), "Pick a text key");
    return;
  }
  try {
    const { ens, provider } = makeReadContracts(ethers, CFG);
    const node = ensNode(ethers, name, CFG.tld);
    const res = await ens.resolver(node);
    if (!res || res === ethers.ZeroAddress) {
      showErr($("textOut"), "No resolver set on this name");
      return;
    }
    const r = new ethers.Contract(res, PHASE1_RESOLVER_ABI, provider);
    let value = "";
    try {
      value = await r.text(node, key);
    } catch (e) {
      showErr($("textOut"), "Resolver may not support text() — " + formatError(e, errOpts()));
      return;
    }
    $("textOut").textContent =
      `label: ${name}.rh\n` + `resolver: ${res}\n` + `text["${key}"]: ${value === "" ? "(empty)" : value}`;
  } catch (e) {
    showErr($("textOut"), e);
  }
}

async function doTextWrite() {
  if (!signer) await connect();
  const name = normalizeLabel($("textLabel").value);
  const key = String($("textKey").value || "").trim();
  const value = String($("textValue").value || "");
  const v = validateLabel(name);
  $("textOut").textContent = "Writing text…";
  if (v) {
    showErr($("textOut"), v);
    return;
  }
  if (!key) {
    showErr($("textOut"), "Pick a text key");
    return;
  }
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();

    const { ens, provider } = makeReadContracts(ethers, CFG);
    const node = ensNode(ethers, name, CFG.tld);
    const res = await ens.resolver(node);
    if (!res || res === ethers.ZeroAddress) {
      showErr($("textOut"), "No resolver set — register with default resolver first");
      return;
    }
    const r = new ethers.Contract(res, PHASE1_RESOLVER_ABI, signer);
    const tx = await r.setText(node, key, value);
    $("textOut").textContent = `tx: ${tx.hash}\nwaiting…`;
    const rc = await tx.wait();
    const rread = new ethers.Contract(res, PHASE1_RESOLVER_ABI, provider);
    const got = await rread.text(node, key);
    $("textOut").innerHTML =
      `<span class="ok">text updated</span>\n` +
      `label: ${escapeHtml(name)}.rh\n` +
      `key: ${escapeHtml(key)}\n` +
      `value: ${escapeHtml(got)}\n` +
      `tx: ${rc.hash}`;
    if (normalizeLabel($("profileLabel").value) === name) await loadProfile(name);
  } catch (e) {
    showErr($("textOut"), e);
  }
}

async function saveProfileField(key, inputId) {
  if (!signer) await connect();
  const name = normalizeLabel($("profileLabel").value);
  const value = String($(inputId).value || "");
  const v = validateLabel(name);
  const out = $("profileOut");
  if (v) {
    showErr(out, v);
    return;
  }
  out.textContent = `Writing text["${key}"]…`;
  try {
    await ensureChain(CFG);
    browserProvider = new ethers.BrowserProvider(window.ethereum, CFG.chainId);
    signer = await browserProvider.getSigner();
    const { ens, provider } = makeReadContracts(ethers, CFG);
    const node = ensNode(ethers, name, CFG.tld);
    const res = await ens.resolver(node);
    if (!res || res === ethers.ZeroAddress) {
      showErr(out, "No resolver set");
      return;
    }
    const r = new ethers.Contract(res, PHASE1_RESOLVER_ABI, signer);
    const tx = await r.setText(node, key, value);
    out.textContent = `tx: ${tx.hash}\nwaiting…`;
    await tx.wait();
    const got = await new ethers.Contract(res, PHASE1_RESOLVER_ABI, provider).text(node, key);
    out.innerHTML = `<span class="ok">saved ${escapeHtml(key)}</span>\nvalue: ${escapeHtml(got)}`;
    await loadProfile(name);
  } catch (e) {
    showErr(out, e);
  }
}

function doClearLocal() {
  if (!account) {
    clearAllCommits();
    renderCommitHelper();
    $("regOut").textContent = "Cleared all local commitments.";
    return;
  }
  const name = normalizeLabel($("regName").value);
  if (name) clearPendingCommit(name, account);
  else {
    clearAllCommits();
    renderCommitHelper();
  }
  $("regOut").textContent = "Cleared local commitment secret.";
  paintCountdown();
}

function wire() {
  initTheme();
  setFooter();
  // Product duration list with red −% in option labels
  fillDurationSelect($("regDuration"), { selected: "1y" });
  if ($("renewDuration")) fillDurationSelect($("renewDuration"), { selected: "1y" });
  paintDurationMeta();
  startCountdownLoop();
  setConnectedUi();

  if (window.ethereum) {
    window.ethereum.on?.("chainChanged", () => {
      if (!$("stackStatusCard")?.hidden) refreshInfo();
    });
    window.ethereum.on?.("accountsChanged", (accs) => {
      if (!accs || !accs.length) disconnect();
      else connect().catch(() => {});
    });
  }

  $("connectBtn").onclick = () => connect().catch((e) => alert(formatError(e, errOpts())));
  if ($("disconnectBtn")) $("disconnectBtn").onclick = () => disconnect();
  $("resolveBtn").onclick = () => doResolve();
  $("quoteBtn").onclick = () => doQuote();
  $("commitBtn").onclick = () => doCommit();
  $("regBtn").onclick = () => doRegister();
  $("renewQuoteBtn").onclick = () => doRenewQuote();
  $("renewBtn").onclick = () => doRenew();
  $("reverseBtn").onclick = () => doReverse();
  if ($("textReadBtn")) $("textReadBtn").onclick = () => doTextRead();
  if ($("textWriteBtn")) $("textWriteBtn").onclick = () => doTextWrite();
  $("clearCommitBtn").onclick = () => doClearLocal();
  $("regName").addEventListener("input", () => paintCountdown());
  $("regDuration").addEventListener("change", () => {
    paintDurationMeta();
    doQuote().catch(() => {});
  });
  $("profileLoadBtn").onclick = () => {
    const name = normalizeLabel($("profileLabel").value);
    const v = validateLabel(name);
    if (v) showErr($("profileOut"), v);
    else loadProfile(name);
  };
  $("saveUrlBtn").onclick = () => saveProfileField("url", "profileUrl");
  $("saveAvatarBtn").onclick = () => saveProfileField("avatar", "profileAvatar");
  $("saveDescBtn").onclick = () => saveProfileField("description", "profileDesc");
  $("saveTwitterBtn").onclick = () => saveProfileField("com.twitter", "profileTwitter");
  $("saveGithubBtn").onclick = () => saveProfileField("com.github", "profileGithub");
  $("saveEmailBtn").onclick = () => saveProfileField("email", "profileEmail");
  $("profileAvatar").addEventListener("input", () => {
    const preview = avatarPreviewUrl($("profileAvatar").value);
    const av = $("avatarPreview");
    if (preview) {
      av.src = preview;
      av.hidden = false;
    } else {
      av.removeAttribute("src");
      av.hidden = true;
    }
  });
  if ($("addTrackBtn")) {
    $("addTrackBtn").onclick = () => {
      const n = normalizeLabel($("addTrack").value);
      const v = validateLabel(n);
      if (v) return alert(v);
      rememberLabel(n);
      $("addTrack").value = "";
      renderMyNames();
    };
  }

  // keep raw stack fingerprint for local debugging (?debug=1 or #devDetails open)
  const showDebug = new URLSearchParams(location.search).has("debug");
  const stackCard = $("stackStatusCard");
  if (stackCard && !showDebug) stackCard.hidden = true;
  if (showDebug) refreshInfo();
  else {
    // Still need live min/max commit ages even **without** dumping stack card.
    loadStackInfo(ethers, CFG)
      .then((info) => {
        liveMinAge = info.minAge || CFG.minCommitAge;
        liveMaxAge = info.maxAge || CFG.maxCommitAge;
        paintCountdown();
      })
      .catch(() => {});
  }

  refreshPrices();
  renderCommitHelper();
  renderMyNames();
  // Don't auto-hit resolve on page load with a hard-coded demo label — quieter product UX.
}

if (!window.ethers) {
  document.body.insertAdjacentHTML(
    "afterbegin",
    '<p class="err" style="padding:1rem">ethers failed to load from CDN</p>'
  );
} else {
  wire();
}
