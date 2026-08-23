"use strict";

const { fetchSecCompany, extractFinancials } = require("./sec");
const { fetchYahooQuote } = require("./yahoo");
const { finite, round, median, standardDeviation } = require("./utils");

function valueForYear(series, year) {
  return series.values.get(year)?.val ?? null;
}

function annualRows(extracted) {
  const years = new Set();
  for (const series of Object.values(extracted.series)) for (const year of series.values.keys()) years.add(year);
  return [...years].sort((a, b) => b - a).slice(0, 10).map((year) => {
    const revenue = valueForYear(extracted.series.revenue, year);
    const ocf = valueForYear(extracted.series.ocf, year);
    const capexRaw = valueForYear(extracted.series.capex, year);
    const capex = finite(capexRaw) ? Math.abs(capexRaw) : null;
    const fcf = finite(ocf) && finite(capex) ? ocf - capex : null;
    const sbc = valueForYear(extracted.series.sbc, year);
    const shares = valueForYear(extracted.series.dilutedShares, year);
    return {
      year, revenue, ocf, capex, fcf, sbc, shares,
      fcfMargin: finite(fcf) && finite(revenue) && revenue > 0 ? fcf / revenue : null,
      sbcToRevenue: finite(sbc) && finite(revenue) && revenue > 0 ? sbc / revenue : null,
      sbcToFcf: finite(sbc) && finite(fcf) && fcf > 0 ? sbc / fcf : null
    };
  });
}

function normalize(rows) {
  const usable = rows.filter((row) => finite(row.revenue) && row.revenue > 0 && finite(row.fcf));
  const latestRevenue = usable[0]?.revenue ?? null;
  if (!usable.length || !finite(latestRevenue)) return { usableYears: 0, latestRevenue, latestReportedFcf: null, totalRevenue: null, totalFcf: null, averageAnnualFcf: null, averageMargin: null, aggregateMargin: null, medianMargin: null, marginNormalizedFcf: null, medianNormalizedFcf: null, conservativeFcf: null };
  const totalRevenue = usable.reduce((sum, row) => sum + row.revenue, 0);
  const totalFcf = usable.reduce((sum, row) => sum + row.fcf, 0);
  const averageAnnualFcf = totalFcf / usable.length;
  const averageMargin = usable.reduce((sum, row) => sum + row.fcfMargin, 0) / usable.length;
  const aggregateMargin = totalFcf / totalRevenue;
  const medianMargin = median(usable.map((row) => row.fcfMargin));
  const marginNormalizedFcf = aggregateMargin * latestRevenue;
  const medianNormalizedFcf = medianMargin * latestRevenue;
  const positive = [marginNormalizedFcf, medianNormalizedFcf].filter((value) => finite(value) && value > 0);
  return {
    usableYears: usable.length, latestRevenue, latestReportedFcf: usable[0].fcf,
    totalRevenue, totalFcf, averageAnnualFcf, averageMargin, aggregateMargin, medianMargin,
    marginNormalizedFcf, medianNormalizedFcf,
    conservativeFcf: positive.length === 2 ? Math.min(...positive) : null,
    includedYears: usable.map((row) => row.year)
  };
}

function selectValuationShares(rows, instantFact) {
  const annualRow = rows.find((row) => finite(row.shares) && row.shares > 0);
  const annual = annualRow?.shares ?? null;
  const instant = instantFact?.val ?? null;
  if (finite(annual) && finite(instant) && instant > 0) {
    const ratio = instant / annual;
    if (ratio >= 0.7 && ratio <= 1.3) {
      return { shares: instant, source: `SEC shares outstanding (${instantFact.end})`, annual, instant, inconsistent: false };
    }
    return { shares: annual, source: `Latest annual diluted weighted-average shares (${annualRow.year})`, annual, instant, inconsistent: true };
  }
  if (finite(annual)) return { shares: annual, source: `Latest annual diluted weighted-average shares (${annualRow.year})`, annual, instant: null, inconsistent: false };
  if (finite(instant) && instant > 0) return { shares: instant, source: `SEC shares outstanding (${instantFact.end})`, annual: null, instant, inconsistent: false };
  return { shares: null, source: "Unavailable", annual, instant, inconsistent: false };
}

function debtValue(latest) {
  if (finite(latest.totalDebt?.val)) return latest.totalDebt.val;
  const short = latest.shortDebt?.val;
  const long = latest.longDebt?.val;
  if (finite(short) || finite(long)) return (finite(short) ? short : 0) + (finite(long) ? long : 0);
  return null;
}

function computeQuality(rows, normalized) {
  const usable = rows.filter((row) => finite(row.fcf) && finite(row.revenue) && row.revenue > 0);
  const positiveYears = usable.filter((row) => row.fcf > 0).length;
  const margins = usable.map((row) => row.fcfMargin);
  const shareRows = rows.filter((row) => finite(row.shares) && row.shares > 0);
  const comparableShares = shareRows.length ? [shareRows[0]] : [];
  for (let index = 1; index < shareRows.length; index += 1) {
    const prior = comparableShares.at(-1).shares;
    const next = shareRows[index].shares;
    if (Math.abs(prior - next) / Math.min(prior, next) > 0.6) break;
    comparableShares.push(shareRows[index]);
  }
  const latestShares = comparableShares[0]?.shares;
  const oldestShares = comparableShares.length >= 2 ? comparableShares.at(-1)?.shares : null;
  const dilution = finite(latestShares) && finite(oldestShares) && oldestShares > 0 ? latestShares / oldestShares - 1 : null;
  const latestSbc = rows.find((row) => finite(row.sbc));
  const reliability = normalized.usableYears < 6 ? "Insufficient" : positiveYears / usable.length >= 0.8 && standardDeviation(margins) <= 0.08 ? "High" : positiveYears / usable.length >= 0.67 ? "Medium" : "Low";
  return {
    reliability,
    positiveFcfYears: positiveYears,
    positiveFcfRatio: usable.length ? positiveYears / usable.length : null,
    marginVolatility: standardDeviation(margins),
    shareChange: dilution,
    latestSbcToRevenue: latestSbc?.sbcToRevenue ?? null,
    latestSbcToFcf: latestSbc?.sbcToFcf ?? null
  };
}

function latestFiling(submissions) {
  const recent = submissions?.filings?.recent || {};
  const forms = recent.form || [];
  for (let index = 0; index < forms.length; index += 1) {
    if (["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"].includes(forms[index])) {
      return { form: forms[index], filed: recent.filingDate?.[index] || null, accession: recent.accessionNumber?.[index] || null, primaryDocument: recent.primaryDocument?.[index] || null };
    }
  }
  return null;
}

function filingUrl(cik, filing) {
  if (!filing?.accession || !filing.primaryDocument) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replaceAll("-", "")}/${filing.primaryDocument}`;
}

async function analyzeTicker(rawTicker, options = {}) {
  const ticker = String(rawTicker || "").trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    const error = new Error("Enter a valid ticker such as AAPL or BRK.B.");
    error.statusCode = 400;
    throw error;
  }
  const [{ company, facts, submissions }, quoteResult] = await Promise.all([
    fetchSecCompany(ticker),
    fetchYahooQuote(ticker).catch((error) => ({ price: finite(Number(options.price)) ? Number(options.price) : null, error: error.message, source: "Unavailable" }))
  ]);
  const extracted = extractFinancials(facts);
  const rows = annualRows(extracted);
  const normalized = normalize(rows);
  const quality = computeQuality(rows, normalized);
  const sic = Number(submissions.sic);
  const isFinancial = finite(sic) && sic >= 6000 && sic <= 6799;
  const hasUsdQuote = !quoteResult.currency || quoteResult.currency === "USD";
  const shareSelection = selectValuationShares(rows, extracted.latest.sharesOutstanding);
  const shares = shareSelection.shares;
  const price = finite(Number(options.price)) ? Number(options.price) : quoteResult.price;
  const suppliedMarketCap = finite(Number(options.marketCap)) && Number(options.marketCap) > 0 ? Number(options.marketCap) : null;
  const marketCap = suppliedMarketCap ?? (finite(price) && finite(shares) ? price * shares : null);
  const marketCapSource = suppliedMarketCap ? "Yahoo screener market cap" : finite(marketCap) ? `${shareSelection.source} × current price` : "Unavailable";
  const debt = debtValue(extracted.latest);
  const cash = extracted.latest.cash?.val ?? null;
  const netDebt = finite(debt) && finite(cash) ? debt - cash : null;
  const enterpriseValue = finite(marketCap) && finite(netDebt) ? marketCap + netDebt : null;
  const nfcf = normalized.conservativeFcf;
  const valuation = {
    price, shares, shareSource: shareSelection.source, marketCap, marketCapSource, debt, cash, netDebt, enterpriseValue,
    priceToNfcf: finite(marketCap) && finite(nfcf) && nfcf > 0 ? marketCap / nfcf : null,
    evToNfcf: finite(enterpriseValue) && finite(nfcf) && nfcf > 0 ? enterpriseValue / nfcf : null,
    fcfYield: finite(marketCap) && marketCap > 0 && finite(nfcf) ? nfcf / marketCap : null,
    averageFcfYield: finite(marketCap) && marketCap > 0 && finite(normalized.averageAnnualFcf) ? normalized.averageAnnualFcf / marketCap : null,
    latestFcfYield: finite(marketCap) && marketCap > 0 && finite(normalized.latestReportedFcf) ? normalized.latestReportedFcf / marketCap : null,
    netDebtToNfcf: finite(netDebt) && finite(nfcf) && nfcf > 0 ? netDebt / nfcf : null
  };
  const warnings = [];
  if (isFinancial) warnings.push("Banking/insurance-style company: conventional FCF analysis is unsuitable.");
  if (!hasUsdQuote) warnings.push(`Price is quoted in ${quoteResult.currency}; version one only values USD-quoted securities.`);
  if (normalized.usableYears < 6) warnings.push(`Only ${normalized.usableYears} usable annual periods; six are required.`);
  if (!finite(price)) warnings.push("Current price is unavailable.");
  if (!finite(shares)) warnings.push("Current share count is unavailable.");
  if (shareSelection.inconsistent && !suppliedMarketCap) warnings.push(`SEC instant shares (${round(shareSelection.instant)}) differ materially from annual diluted shares (${round(shareSelection.annual)}); valuation uses the annual diluted figure.`);
  if (finite(valuation.fcfYield) && valuation.fcfYield > 0.5) warnings.push("Normalized FCF yield exceeds 50%; verify market capitalization and cash-flow facts before relying on valuation.");
  if (!finite(extracted.latest.cash?.val) || !finite(debt)) warnings.push("Cash or debt data is incomplete.");
  if (finite(quality.shareChange) && quality.shareChange > 0.2) warnings.push("Share count increased by more than 20% over the available period.");
  if (quality.reliability === "Low") warnings.push("Free cash flow history is inconsistent.");
  const valuationSane = finite(marketCap) && marketCap >= 10_000_000 && finite(valuation.fcfYield) && valuation.fcfYield > 0 && valuation.fcfYield <= 0.5;
  if (!valuationSane) warnings.push("Valuation failed the market-cap/FCF sanity check and cannot qualify automatically.");
  const passes = !isFinancial && hasUsdQuote && valuationSane && normalized.usableYears >= 6 && quality.reliability !== "Low" && finite(valuation.priceToNfcf) && valuation.priceToNfcf <= 15 && (!finite(valuation.netDebtToNfcf) || valuation.netDebtToNfcf <= 5) && (!finite(quality.shareChange) || quality.shareChange <= 0.2);
  const filing = latestFiling(submissions);
  return {
    ticker, companyName: submissions.name || company.title, cik: company.cik,
    company: { sic: submissions.sic || null, sicDescription: submissions.sicDescription || null, fiscalYearEnd: submissions.fiscalYearEnd || null, exchanges: submissions.exchanges || [], tickers: submissions.tickers || [] },
    quote: quoteResult,
    rows,
    normalized,
    quality,
    valuation,
    status: passes ? "Idea" : normalized.usableYears < 6 || isFinancial ? "Excluded" : "Review",
    passesDefaultIdeaFilter: passes,
    warnings,
    filing: filing ? { ...filing, url: filingUrl(company.cik, filing) } : null,
    methodology: {
      standardFcf: "Operating cash flow − absolute capital expenditure",
      marginNormalized: "Aggregate historical FCF ÷ aggregate historical revenue × latest annual revenue",
      medianNormalized: "Median annual FCF margin × latest annual revenue",
      conservative: "Lower positive estimate when both normalization methods are available",
      sbcTreatment: "SBC is disclosed separately and assessed through dilution; it is not silently deducted from standard FCF"
    },
    sources: {
      financials: "SEC Company Facts",
      price: quoteResult.source,
      shares: shareSelection.source,
      marketCap: marketCapSource,
      financialTags: Object.fromEntries(Object.entries(extracted.series).map(([key, value]) => [key, value.tag]))
    },
    analyzedAt: new Date().toISOString()
  };
}

function summary(report) {
  return {
    ticker: report.ticker, companyName: report.companyName, status: report.status,
    price: round(report.valuation.price), marketCap: round(report.valuation.marketCap), priceToNfcf: round(report.valuation.priceToNfcf),
    evToNfcf: round(report.valuation.evToNfcf), fcfYield: round(report.valuation.fcfYield, 4),
    averageFcfYield: round(report.valuation.averageFcfYield, 4), latestFcfYield: round(report.valuation.latestFcfYield, 4),
    latestRevenue: round(report.normalized.latestRevenue), averageAnnualFcf: round(report.normalized.averageAnnualFcf),
    conservativeFcf: round(report.normalized.conservativeFcf), usableYears: report.normalized.usableYears,
    reliability: report.quality.reliability, positiveFcfRatio: round(report.quality.positiveFcfRatio, 4),
    netDebtToNfcf: round(report.valuation.netDebtToNfcf), shareChange: round(report.quality.shareChange, 4),
    latestSbcToRevenue: round(report.quality.latestSbcToRevenue, 4),
    warnings: report.warnings, passesDefaultIdeaFilter: report.passesDefaultIdeaFilter,
    analyzedAt: report.analyzedAt
  };
}

async function analyzeBatch(tickers, options = {}) {
  const reports = {};
  const failures = [];
  let index = 0;
  const workers = Math.min(3, tickers.length);
  async function worker() {
    while (index < tickers.length) {
      const ticker = tickers[index++];
      try { reports[ticker] = await analyzeTicker(ticker, { ...options, ...(options.quotes?.[ticker] || {}) }); }
      catch (error) { failures.push({ ticker, error: error.message || "Analysis failed." }); }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  const results = Object.values(reports).map(summary).sort((a, b) => Number(b.passesDefaultIdeaFilter) - Number(a.passesDefaultIdeaFilter) || (a.priceToNfcf ?? 999) - (b.priceToNfcf ?? 999));
  return { results, reports, failures };
}

module.exports = { annualRows, normalize, computeQuality, selectValuationShares, analyzeTicker, analyzeBatch, summary };
