"use strict";

const $ = (selector) => document.querySelector(selector);
const state = { auto: null, reports: {}, stopped: false };
const STORAGE_KEY = "clear-fcf-auto-v3";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function setStatus(message, error = false) {
  const el = $("#status");
  el.textContent = message;
  el.classList.toggle("error", error);
}

function parseTickers(input) {
  return [...new Set(String(input || "").split(/[\s,;]+/).map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function compact(value, currency = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const formatter = new Intl.NumberFormat("en-US", { notation: Math.abs(value) >= 1e6 ? "compact" : "standard", maximumFractionDigits: 2, style: currency ? "currency" : "decimal", currency: "USD" });
  return formatter.format(value);
}

function multiple(value) { return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}×` : "—"; }
function percent(value) { return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—"; }

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === button.dataset.view));
}));

function tableHtml(results, title) {
  if (!results.length) return `<div class="results-shell"><div class="empty">No results yet.</div></div>`;
  return `<div class="results-shell">
    <div class="results-head"><h2>${escapeHtml(title)} <small>(${results.length})</small></h2><button class="export" type="button">Export CSV</button></div>
    <div class="table-scroll"><table><thead><tr>
      <th>Company</th><th>Status</th><th>Price</th><th>Market cap</th><th>Current revenue</th><th>P/nFCF</th><th>EV/nFCF</th><th>Normalized FCF yield</th><th>Avg FCF yield*</th><th>History</th><th>Reliability</th><th>Avg/median gap</th><th>Net debt/nFCF</th><th>Share change</th><th>SBC/revenue</th>
    </tr></thead><tbody>${results.map((row) => `<tr data-ticker="${escapeHtml(row.ticker)}">
      <td><span class="ticker">${escapeHtml(row.ticker)}</span><span class="subname">${escapeHtml(row.companyName)}</span></td>
      <td><span class="badge ${String(row.status).toLowerCase()}">${escapeHtml(row.status)}</span></td>
      <td>${compact(row.price, true)}</td><td>${compact(row.marketCap, true)}</td><td>${compact(row.latestRevenue, true)}</td><td>${multiple(row.priceToNfcf)}</td><td>${multiple(row.evToNfcf)}</td><td>${percent(row.fcfYield)}</td><td>${percent(row.averageFcfYield)}</td>
      <td>${escapeHtml(row.usableYears)} years</td><td>${escapeHtml(row.reliability)}</td><td>${percent(row.averageMedianGap)}</td><td>${multiple(row.netDebtToNfcf)}</td><td>${percent(row.shareChange)}</td><td>${percent(row.latestSbcToRevenue)}</td>
    </tr>`).join("")}</tbody></table></div></div>`;
}

function attachTableEvents(container, results) {
  container.querySelectorAll("tbody tr").forEach((row) => row.addEventListener("click", () => openReport(row.dataset.ticker)));
  container.querySelector(".export")?.addEventListener("click", () => exportCsv(results));
}

function renderTable(container, results, title) {
  container.innerHTML = tableHtml(results, title);
  attachTableEvents(container, results);
}

function exportCsv(results) {
  const fields = ["ticker", "companyName", "status", "price", "marketCap", "latestRevenue", "averageAnnualFcf", "averageFcfMargin", "medianFcfMargin", "averageMedianGap", "marginAgreement", "priceToNfcf", "evToNfcf", "fcfYield", "averageFcfYield", "latestFcfYield", "usableYears", "reliability", "netDebtToNfcf", "shareChange", "latestSbcToRevenue"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [fields.join(","), ...results.map((row) => fields.map((key) => quote(row[key])).join(","))].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = `clear-fcf-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function rowTable(rows) {
  return `<div class="table-scroll"><table><thead><tr><th>Year</th><th>Revenue</th><th>OCF</th><th>CapEx</th><th>FCF</th><th>FCF margin</th><th>SBC</th><th>Diluted shares</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.year}</td><td>${compact(row.revenue, true)}</td><td>${compact(row.ocf, true)}</td><td>${compact(row.capex, true)}</td><td>${compact(row.fcf, true)}</td><td>${percent(row.fcfMargin)}</td><td>${compact(row.sbc, true)}</td><td>${compact(row.shares)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderReport(report) {
  const v = report.valuation;
  const n = report.normalized;
  const q = report.quality;
  const filing = report.filing?.url ? `<a class="source-link" href="${escapeHtml(report.filing.url)}" target="_blank" rel="noopener">Open latest ${escapeHtml(report.filing.form)} filed ${escapeHtml(report.filing.filed)}</a>` : "Latest annual filing link unavailable";
  const latestRow = report.rows.find((row) => typeof row.fcf === "number" && typeof row.revenue === "number") || {};
  const marketCapMath = report.sources.marketCap === "Yahoo screener market cap"
    ? `Yahoo market cap = ${compact(v.marketCap, true)}`
    : `${compact(v.price, true)} × ${compact(v.shares)} shares = ${compact(v.marketCap, true)}`;
  return `<div class="report-card">
    <div class="report-title"><div><p class="kicker">${escapeHtml(report.status)}</p><h2>${escapeHtml(report.ticker)} · ${escapeHtml(report.companyName)}</h2><p class="muted">${escapeHtml(report.company.sicDescription || "Industry unavailable")} · ${escapeHtml(report.quote.exchange || report.company.exchanges?.[0] || "Exchange unavailable")}</p></div><span class="badge ${String(report.status).toLowerCase()}">${escapeHtml(report.status)}</span></div>
    ${report.warnings.length ? `<div class="warnings"><strong>Check before relying on this result</strong><ul>${report.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}
  </div>
  <div class="report-grid">
    <div class="metric"><span>Price</span><strong>${compact(v.price, true)}</strong></div>
    <div class="metric"><span>Market capitalization</span><strong>${compact(v.marketCap, true)}</strong></div>
    <div class="metric"><span>Shares used</span><strong>${compact(v.shares)}</strong></div>
    <div class="metric"><span>Latest revenue</span><strong>${compact(n.latestRevenue, true)}</strong></div>
    <div class="metric"><span>Latest reported FCF</span><strong>${compact(n.latestReportedFcf, true)}</strong></div>
    <div class="metric"><span>Average annual FCF</span><strong>${compact(n.averageAnnualFcf, true)}</strong></div>
    <div class="metric"><span>Average FCF margin</span><strong>${percent(n.averageMargin)}</strong></div>
    <div class="metric"><span>Median margin check</span><strong>${percent(n.medianMargin)}</strong></div>
    <div class="metric"><span>Average/median gap</span><strong>${percent(n.averageMedianGap)}</strong></div>
    <div class="metric"><span>Average FCF yield*</span><strong>${percent(v.averageFcfYield)}</strong></div>
    <div class="metric"><span>Latest reported FCF yield</span><strong>${percent(v.latestFcfYield)}</strong></div>
    <div class="metric"><span>P/nFCF</span><strong>${multiple(v.priceToNfcf)}</strong></div>
    <div class="metric"><span>EV/nFCF</span><strong>${multiple(v.evToNfcf)}</strong></div>
    <div class="metric"><span>Normalized FCF yield</span><strong>${percent(v.fcfYield)}</strong></div>
    <div class="metric"><span>Net debt</span><strong>${compact(v.netDebt, true)}</strong></div>
    <div class="metric"><span>Usable history</span><strong>${n.usableYears} years</strong></div>
    <div class="metric"><span>Reliability</span><strong>${escapeHtml(q.reliability)}</strong></div>
    <div class="metric"><span>Net debt/nFCF</span><strong>${multiple(v.netDebtToNfcf)}</strong></div>
    <div class="metric"><span>Share change</span><strong>${percent(q.shareChange)}</strong></div>
  </div>
  <div class="report-card"><h3>Normalized FCF calculation</h3><div class="formulas">
    <div class="formula"><span>Average annual FCF margin</span><strong>${percent(n.averageMargin)}</strong><small>Simple average of ${n.usableYears} annual FCF margins</small></div>
    <div class="formula"><span>Current revenue</span><strong>${compact(n.latestRevenue, true)}</strong><small>Latest reported annual revenue</small></div>
    <div class="formula"><span>Normalized FCF</span><strong>${compact(n.normalizedFcf, true)}</strong><small>${percent(n.averageMargin)} × ${compact(n.latestRevenue, true)}</small></div>
  </div><p class="footnote">Median cross-check: ${percent(n.medianMargin)} median margin; ${percent(n.averageMedianGap)} relative gap — <strong>${n.marginAgreement ? "passes" : "fails"}</strong> the 20% automatic-idea limit. ${n.outlierYears?.length ? `Extreme margin years: ${n.outlierYears.map((item) => item.year).join(", ")}.` : "No extreme annual margins detected."}</p><p class="footnote">* Average FCF yield means historical average annual FCF divided by today's market capitalization. It is not an average of historical market yields.</p></div>
  <div class="report-card"><h3>Calculation audit</h3><div class="audit-list">
    <div><span>Latest reported FCF</span><code>${compact(latestRow.ocf, true)} OCF − ${compact(latestRow.capex, true)} CapEx = ${compact(latestRow.fcf, true)}</code></div>
    <div><span>Average FCF margin</span><code>Sum of annual FCF margins ÷ ${n.usableYears} years = ${percent(n.averageMargin)}</code></div>
    <div><span>Median reliability check</span><code>|${percent(n.averageMargin)} average − ${percent(n.medianMargin)} median| ÷ |${percent(n.medianMargin)} median| = ${percent(n.averageMedianGap)}</code><small>${n.marginAgreement ? "Passes" : "Fails"} the maximum 20% relative difference.</small></div>
    <div><span>Normalized FCF</span><code>${percent(n.averageMargin)} × ${compact(n.latestRevenue, true)} current revenue = ${compact(n.normalizedFcf, true)}</code></div>
    <div><span>Average annual FCF</span><code>${compact(n.totalFcf, true)} ÷ ${n.usableYears} years = ${compact(n.averageAnnualFcf, true)}</code></div>
    <div><span>Market capitalization</span><code>${escapeHtml(marketCapMath)}</code><small>${escapeHtml(v.marketCapSource || report.sources.marketCap || "Unavailable")}</small></div>
    <div><span>P/nFCF</span><code>${compact(v.marketCap, true)} ÷ ${compact(n.normalizedFcf, true)} = ${multiple(v.priceToNfcf)}</code></div>
    <div><span>Normalized FCF yield</span><code>${compact(n.normalizedFcf, true)} ÷ ${compact(v.marketCap, true)} = ${percent(v.fcfYield)}</code></div>
    <div><span>Enterprise value</span><code>${compact(v.marketCap, true)} market cap + ${compact(v.debt, true)} debt − ${compact(v.cash, true)} cash = ${compact(v.enterpriseValue, true)}</code></div>
    <div><span>EV/nFCF</span><code>${compact(v.enterpriseValue, true)} ÷ ${compact(n.normalizedFcf, true)} = ${multiple(v.evToNfcf)}</code></div>
  </div></div>
  <div class="report-card"><h3>Annual evidence</h3>${rowTable(report.rows)}<p>${filing}</p></div>
  <div class="report-card"><h3>Sources and treatment</h3><p>Financial statements: <strong>SEC Company Facts</strong>. Price: <strong>${escapeHtml(report.sources.price || "Unavailable")}</strong>. Shares: <strong>${escapeHtml(report.sources.shares || "Unavailable")}</strong>. Market cap: <strong>${escapeHtml(report.sources.marketCap || "Unavailable")}</strong>. Analyzed ${escapeHtml(new Date(report.analyzedAt).toLocaleString())}.</p><p class="muted">${escapeHtml(report.methodology.sbcTreatment)}. This is an idea-generation research aid, not investment advice.</p></div>`;
}

async function openReport(ticker) {
  document.querySelector('[data-view="analyze"]').click();
  $("#single-ticker").value = ticker;
  $("#report").innerHTML = `<div class="panel">Loading ${escapeHtml(ticker)}…</div>`;
  setStatus(`Loading the full ${ticker} report…`);
  try {
    const report = state.reports[ticker] || await request(`/api/analyze?ticker=${encodeURIComponent(ticker)}`);
    state.reports[ticker] = report;
    $("#report").innerHTML = renderReport(report);
    setStatus(`${ticker} analysis complete.`);
  } catch (error) {
    $("#report").innerHTML = "";
    setStatus(error.message, true);
  }
}

$("#analyze-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const ticker = $("#single-ticker").value.trim().toUpperCase();
  if (ticker) openReport(ticker);
});

async function screenInBatches(tickers, onBatch) {
  const all = [];
  const failures = [];
  for (let index = 0; index < tickers.length; index += 10) {
    const batch = tickers.slice(index, index + 10);
    const data = await request("/api/screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers: batch }) });
    all.push(...data.results);
    all.sort((a, b) => Number(b.passesDefaultIdeaFilter) - Number(a.passesDefaultIdeaFilter) || (a.priceToNfcf ?? 999) - (b.priceToNfcf ?? 999));
    failures.push(...data.failures);
    Object.assign(state.reports, data.reports);
    if (onBatch) onBatch(index + batch.length, all, failures);
  }
  return { results: all, failures };
}

$("#screen-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const tickers = parseTickers($("#ticker-list").value);
  if (!tickers.length) return setStatus("Paste at least one ticker.", true);
  if (tickers.length > 50) return setStatus("Screen up to 50 tickers at a time.", true);
  const container = $("#screen-results");
  container.innerHTML = "";
  try {
    setStatus(`Screening ${tickers.length} ticker${tickers.length === 1 ? "" : "s"}…`);
    const data = await screenInBatches(tickers, (done, results) => {
      setStatus(`Analyzed ${done} of ${tickers.length}.`);
      renderTable(container, results, "Watchlist results");
    });
    setStatus(`Finished: ${data.results.length} analyzed, ${data.failures.length} failed.`);
  } catch (error) { setStatus(error.message, true); }
});

function saveAuto() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.auto)); } catch { /* storage may be disabled */ }
}

function updateAutoUi() {
  const scan = state.auto;
  if (!scan) return;
  const max = Math.min(scan.maxExamine, scan.symbols.length);
  const examined = Math.min(scan.cursor, max);
  $("#progress-wrap").classList.remove("hidden");
  $("#progress-bar").style.width = `${max ? examined / max * 100 : 0}%`;
  $("#progress-text").textContent = `${examined}/${max} examined · ${scan.results.length}/${scan.target} ideas`;
  renderTable($("#idea-results"), scan.results, "Current ideas");
}

async function runAuto() {
  const scan = state.auto;
  state.stopped = false;
  $("#find-button").disabled = true;
  $("#stop-button").disabled = false;
  const max = Math.min(scan.maxExamine, scan.symbols.length);
  try {
    while (scan.cursor < max && scan.results.length < scan.target && !state.stopped) {
      const batchRows = scan.symbols.slice(scan.cursor, scan.cursor + 5);
      const batch = batchRows.map((item) => item.ticker);
      const data = await request("/api/screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers: batch, quotes: batchRows.map(({ ticker, price, marketCap }) => ({ ticker, price, marketCap })) }) });
      Object.assign(state.reports, data.reports);
      scan.cursor += batch.length;
      const existing = new Set(scan.results.map((row) => row.ticker));
      scan.results.push(...data.results.filter((row) => row.passesDefaultIdeaFilter && !existing.has(row.ticker)));
      scan.failures.push(...data.failures);
      saveAuto();
      updateAutoUi();
      setStatus(`Auto Finder: examined ${scan.cursor} and found ${scan.results.length} ideas.`);
    }
    scan.complete = scan.results.length >= scan.target || scan.cursor >= max;
    saveAuto();
    const reason = state.stopped ? "stopped" : scan.results.length >= scan.target ? "target reached" : "universe exhausted";
    setStatus(`Auto Finder ${reason}: ${scan.results.length} ideas from ${scan.cursor} companies.`);
  } catch (error) { setStatus(`Scan paused: ${error.message}. Press Resume to continue.`, true); }
  finally {
    $("#find-button").disabled = false;
    $("#stop-button").disabled = true;
    $("#find-button").textContent = scan.complete ? "Start new scan" : "Resume scan";
  }
}

$("#find-button").addEventListener("click", async () => {
  const target = Number($("#target").value);
  const maxExamine = Number($("#max-examine").value);
  if (state.auto && !state.auto.complete && state.auto.target === target && state.auto.maxExamine === maxExamine) return runAuto();
  try {
    setStatus("Loading changing Yahoo idea lists…");
    $("#find-button").disabled = true;
    const universe = await request("/api/universe?perSource=100");
    state.auto = { symbols: universe.symbols, sources: universe.sources, target, maxExamine, cursor: 0, results: [], failures: [], startedAt: new Date().toISOString(), complete: false };
    saveAuto();
    updateAutoUi();
    setStatus(`Loaded ${universe.symbols.length} unique Yahoo candidates from ${universe.sources.length} lists.`);
    await runAuto();
  } catch (error) {
    $("#find-button").disabled = false;
    setStatus(error.message, true);
  }
});

$("#stop-button").addEventListener("click", () => { state.stopped = true; $("#stop-button").disabled = true; });

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved?.symbols && Array.isArray(saved.results)) {
    state.auto = saved;
    $("#target").value = String(saved.target);
    $("#max-examine").value = String(saved.maxExamine);
    $("#find-button").textContent = saved.complete ? "Start new scan" : "Resume scan";
    updateAutoUi();
    setStatus(saved.complete ? `Previous scan found ${saved.results.length} ideas.` : `A saved scan can resume at ${saved.cursor} examined.`);
  }
} catch { localStorage.removeItem(STORAGE_KEY); }
