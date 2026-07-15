/**
 * V4 rental product app (ES module). Depends on global `ethers` from CDN.
 */
import { V4 } from "./sdk/chain.js";
import { durationSeconds, formatDurationSeconds } from "./sdk/duration.js";
import { escapeHtml, formatError, V4_ERROR_BY_SEL } from "./sdk/errors.js";
import { normalizeLabel, validateLabel } from "./sdk/labels.js";
import { connectWallet, ensureChain } from "./sdk/provider.js";
import {
  fmtV4Ts,
  loadV4StackInfo,
  makeV4ReadContracts,
  makeV4WriteContracts,
  resolveV4Name,
} from "./sdk/v4-client.js";
import { V4_REGISTRY_ABI, V4_REGISTRAR_ABI } from "./sdk/abis.js";

const ethers = window.ethers;
const CFG = V4;
const $ = (id) => document.getElementById(id);

let browserProvider, signer, account;

function errOpts() {
  return {
    ethers,
    selectors: V4_ERROR_BY_SEL,
    decodeAbi: [...V4_REGISTRY_ABI, ...V4_REGISTRAR_ABI],
  };
}

function showErr(el, e) {
  el.innerHTML = `<span class="err">${escapeHtml(formatError(e, errOpts()))}</span>`;
}

function setFooter() {
  $("proxyLine").textContent = CFG.proxy;
  $("regLine").textContent = CFG.registrar;
  $("msLine").textContent = CFG.multisig;
}

function paintDurationMeta() {
  const key = $("regDuration").value;
  const sec = durationSeconds(key, { allow10y: true });
  $("durationMeta").textContent =
    `${formatDurationSeconds(sec)} · ${sec}s · yearly_rate × duration / 365 days`;
}

async function connect() {
  const w = await connectWallet(ethers, CFG);
  browserProvider = w.browserProvider;
  signer = w.signer;
  account = w.account;
  const short = account.slice(0, 6) + "…" + account.slice(-4);
  const btn = $("connectBtn");
  btn.textContent = short;
  btn.classList.remove("secondary");
  // Hover behavior: show "Disconnect" on hover, address when not hovering
  btn.onmouseenter = () => { btn.textContent = "Disconnect"; btn.classList.add("secondary"); };
  btn.onmouseleave = () => { btn.textContent = short; btn.classList.remove("secondary"); };
  btn.onclick = () => disconnectV4();
  $("netPill").textContent = "Robinhood · " + short;
  $("netPill").classList.add("ok");
  $("netPill").classList.remove("warn");
  await refreshInfo();
}

function disconnectV4() {
  signer = null;
  account = null;
  browserProvider = null;
  const btn = $("connectBtn");
  btn.textContent = "Connect wallet";
  btn.classList.add("secondary");
  btn.onmouseenter = null;
  btn.onmouseleave = null;
  btn.onclick = () => connect().catch((e) => alert(formatError(e, errOpts())));
  $("netPill").textContent = "not connected";
  $("netPill").classList.remove("ok");
}

async function refreshPrices() {
  try {
    const { registrar } = makeV4ReadContracts(ethers, CFG);
    const [p3, p4, p5] = await Promise.all([
      registrar.price3(),
      registrar.price4(),
      registrar.price5Plus(),
    ]);
    $("pricePills").innerHTML =
      `<span class="pill">3ch / yr: ${ethers.formatEther(p3)} ETH</span>` +
      `<span class="pill">4ch / yr: ${ethers.formatEther(p4)} ETH</span>` +
      `<span class="pill">5+ / yr: ${ethers.formatEther(p5)} ETH</span>`;
  } catch (e) {
    $("pricePills").innerHTML = `<span class="pill warn">${escapeHtml(formatError(e, errOpts()))}</span>`;
  }
}

async function refreshInfo() {
  try {
    const info = await loadV4StackInfo(ethers, CFG);
    let walletChain = "(none)";
    if (window.ethereum) {
      try {
        walletChain = await window.ethereum.request({ method: "eth_chainId" });
      } catch (_) {}
    }
    if (info.regCode === "0x") {
      throw new Error("Registrar has no code on read RPC — config or RPC is wrong");
    }
    $("infoOut").textContent =
      `read RPC chainId: ${info.network.chainId}\n` +
      `wallet eth_chainId: ${walletChain}\n` +
      `totalNames: ${info.total}\n` +
      `registry.owner (multisig): ${info.owner}\n` +
      `registry.registrar: ${info.regAddr}\n` +
      `MIN_REGISTRATION: ${info.minR}s (${info.minR / 86400} days)\n` +
      `yearly wei 3/4/5+: ${info.p3} / ${info.p4} / ${info.p5}` +
      (account ? `\nconnected: ${account}` : "\nconnected: (none)");
  } catch (e) {
    showErr($("infoOut"), e);
  }
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
    const r = await resolveV4Name(ethers, name, CFG);
    $("resolveOut").textContent =
      `label: ${name}.rh\n` +
      `available: ${r.avail}\n` +
      `ownerOf: ${r.owner}\n` +
      `resolve: ${r.resolver}\n` +
      `expires: ${fmtV4Ts(r.expires)}\n` +
      `namehash: ${r.node}\n` +
      `totalNames: ${r.total}`;
  } catch (e) {
    showErr($("resolveOut"), e);
  }
}

async function doQuote() {
  const name = normalizeLabel($("regName").value);
  const duration = durationSeconds($("regDuration").value, { allow10y: true });
  $("regOut").textContent = "Quoting…";
  const v = validateLabel(name);
  if (v) {
    showErr($("regOut"), v);
    return;
  }
  try {
    const { registry, registrar } = makeV4ReadContracts(ethers, CFG);
    const avail = await registry.available(name);
    if (!avail) {
      showErr(
        $("regOut"),
        "Unavailable — label taken, not expired, or failed on-chain validation."
      );
      return;
    }
    const price = await registrar["quote(string,uint64)"](name, duration);
    const yearly = await registrar.rentPricePerYear(name);
    $("regOut").textContent =
      `available: true\n` +
      `duration: ${formatDurationSeconds(duration)} (${duration}s)\n` +
      `yearly base: ${ethers.formatEther(yearly)} ETH\n` +
      `total due: ${ethers.formatEther(price)} ETH (${price} wei)\n` +
      `rpc: ${CFG.rpcUrl}`;
  } catch (e) {
    showErr($("regOut"), e);
  }
}

async function doRegister() {
  if (!signer) await connect();
  const name = normalizeLabel($("regName").value);
  const duration = durationSeconds($("regDuration").value, { allow10y: true });
  $("regOut").textContent = "Submitting…";
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

    const { registry: regRead, registrar: regReadR } = makeV4ReadContracts(ethers, CFG);
    const avail = await regRead.available(name);
    if (!avail) {
      showErr($("regOut"), "Unavailable — cannot register this label right now.");
      return;
    }
    const price = await regReadR["quote(string,uint64)"](name, duration);

    const { registrar } = makeV4WriteContracts(ethers, signer, CFG);
    // owner/resolver zero → registrar defaults (name owner = msg.sender style path)
    const tx = await registrar["register(string,address,address,uint64)"](
      name,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      duration,
      { value: price }
    );
    $("regOut").textContent = `tx: ${tx.hash}\nwaiting…`;
    const rc = await tx.wait();
    const [owner, exp] = await Promise.all([regRead.ownerOf(name), regRead.nameExpires(name)]);
    $("regOut").innerHTML =
      `<span class="ok">registered ${escapeHtml(name)}.rh</span>\n` +
      `owner: ${owner}\nexpires: ${fmtV4Ts(exp)}\ntx: ${rc.hash}`;
    $("renewName").value = name;
    $("resolveName").value = name;
    await refreshInfo();
  } catch (e) {
    showErr($("regOut"), e);
  }
}

async function doRenewQuote() {
  const name = normalizeLabel($("renewName").value);
  const duration = durationSeconds($("renewDuration").value, { allow10y: true });
  $("renewOut").textContent = "Quoting renew…";
  const v = validateLabel(name);
  if (v) {
    showErr($("renewOut"), v);
    return;
  }
  try {
    const { registry, registrar } = makeV4ReadContracts(ethers, CFG);
    const [owner, exp, price] = await Promise.all([
      registry.ownerOf(name),
      registry.nameExpires(name),
      registrar["rentPrice(string,uint64)"](name, duration),
    ]);
    $("renewOut").textContent =
      `ownerOf: ${owner}\n` +
      `current expiry: ${fmtV4Ts(exp)}\n` +
      `extend by: ${formatDurationSeconds(duration)} (${duration}s)\n` +
      `renew cost: ${ethers.formatEther(price)} ETH (${price} wei)`;
  } catch (e) {
    showErr($("renewOut"), e);
  }
}

async function doRenew() {
  if (!signer) await connect();
  const name = normalizeLabel($("renewName").value);
  const duration = durationSeconds($("renewDuration").value, { allow10y: true });
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

    const { registrar: regReadR, registry: regRead } = makeV4ReadContracts(ethers, CFG);
    const price = await regReadR["rentPrice(string,uint64)"](name, duration);

    const { registrar } = makeV4WriteContracts(ethers, signer, CFG);
    const tx = await registrar.renew(name, duration, { value: price });
    $("renewOut").textContent = `tx: ${tx.hash}\nwaiting…`;
    const rc = await tx.wait();
    const exp = await regRead.nameExpires(name);
    $("renewOut").innerHTML =
      `<span class="ok">renewed ${escapeHtml(name)}.rh</span>\n` +
      `new expiry: ${fmtV4Ts(exp)}\ntx: ${rc.hash}`;
  } catch (e) {
    showErr($("renewOut"), e);
  }
}

function wire() {
  setFooter();
  paintDurationMeta();

  if (window.ethereum) {
    window.ethereum.on?.("chainChanged", () => {
      refreshInfo();
    });
    window.ethereum.on?.("accountsChanged", (accs) => {
      if (!accs || !accs.length) {
        signer = null;
        account = null;
        $("connectBtn").textContent = "Connect wallet";
        $("netPill").textContent = "not connected";
        $("netPill").classList.remove("ok");
      } else {
        connect().catch(() => {});
      }
    });
  }

  $("connectBtn").onclick = () => connect().catch((e) => alert(formatError(e, errOpts())));
  $("resolveBtn").onclick = () => doResolve();
  $("quoteBtn").onclick = () => doQuote();
  $("regBtn").onclick = () => doRegister();
  $("renewQuoteBtn").onclick = () => doRenewQuote();
  $("renewBtn").onclick = () => doRenew();
  $("regDuration").addEventListener("change", () => {
    paintDurationMeta();
    doQuote().catch(() => {});
  });

  refreshInfo();
  refreshPrices();
}

if (!window.ethers) {
  document.body.insertAdjacentHTML(
    "afterbegin",
    '<p class="err" style="padding:1rem">ethers failed to load from CDN</p>'
  );
} else {
  wire();
}
