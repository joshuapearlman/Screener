"use strict";

const { analyzeBatch } = require("../lib/analysis");

function parseTickers(value) {
  const parts = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return [...new Set(parts.map((item) => String(item).trim().toUpperCase()).filter(Boolean))];
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST for /api/screen." });
  try {
    const tickers = parseTickers(req.body?.tickers || req.body?.input);
    if (!tickers.length) return res.status(400).json({ error: "Provide at least one ticker." });
    if (tickers.length > 10) return res.status(400).json({ error: "Send no more than 10 tickers per batch." });
    const invalid = tickers.filter((ticker) => !/^[A-Z0-9.-]{1,12}$/.test(ticker));
    if (invalid.length) return res.status(400).json({ error: `Invalid ticker: ${invalid.join(", ")}` });
    const result = await analyzeBatch(tickers);
    return res.status(200).json({ ...result, requested: tickers.length, analyzedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Screen failed." });
  }
};

module.exports.parseTickers = parseTickers;
