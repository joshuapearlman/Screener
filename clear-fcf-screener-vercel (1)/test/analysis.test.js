"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalize, computeQuality, selectValuationShares } = require("../lib/analysis");
const { parseTickers } = require("../api/screen");

function row(year, revenue, fcf, shares = 100, sbc = 5) {
  return { year, revenue, fcf, shares, sbc, fcfMargin: fcf / revenue, sbcToRevenue: sbc / revenue, sbcToFcf: sbc / fcf };
}

test("normalization uses aggregate and median margins against latest revenue", () => {
  const rows = [
    row(2025, 200, 20), row(2024, 150, 30), row(2023, 100, 10),
    row(2022, 100, 10), row(2021, 100, 10), row(2020, 100, 10)
  ];
  const result = normalize(rows);
  assert.equal(result.usableYears, 6);
  assert.equal(result.latestRevenue, 200);
  assert.equal(result.aggregateMargin, 90 / 750);
  assert.equal(result.medianMargin, 0.1);
  assert.equal(result.marginNormalizedFcf, 24);
  assert.equal(result.medianNormalizedFcf, 20);
  assert.equal(result.conservativeFcf, 20);
});

test("conservative FCF is unavailable when either method is non-positive", () => {
  const result = normalize([row(2025, 100, 10), row(2024, 100, -20)]);
  assert.equal(result.aggregateMargin, -0.05);
  assert.equal(result.medianMargin, -0.05);
  assert.equal(result.conservativeFcf, null);
});

test("quality requires six usable years for a non-insufficient label", () => {
  const rows = [row(2025, 100, 10), row(2024, 100, 10), row(2023, 100, 10), row(2022, 100, 10), row(2021, 100, 10)];
  assert.equal(computeQuality(rows, normalize(rows)).reliability, "Insufficient");
});

test("share-count discontinuities do not masquerade as dilution", () => {
  const rows = [row(2025, 100, 10, 100), row(2024, 100, 10, 98), row(2023, 100, 10, 10)];
  assert.ok(Math.abs(computeQuality(rows, { usableYears: 6 }).shareChange - (100 / 98 - 1)) < 1e-12);
});

test("valuation rejects an anomalous instant share fact", () => {
  const selected = selectValuationShares([row(2025, 100, 10, 439_000_000)], { val: 10, end: "2026-06-30" });
  assert.equal(selected.shares, 439_000_000);
  assert.equal(selected.inconsistent, true);
});

test("ticker parsing handles commas spaces and duplicates", () => {
  assert.deepEqual(parseTickers("aapl, MSFT\nAAPL; googl"), ["AAPL", "MSFT", "GOOGL"]);
});
