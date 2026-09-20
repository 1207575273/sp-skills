import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, detectMarket, pickKlineSource, formatKline, formatIndicator, formatSignals } from "./run-market.mjs";
import { fetchKline as fetchKlineEast } from "../lib/sources/eastmoney.mjs";
import { fetchKline as fetchKlineYahoo } from "../lib/sources/yahoo.mjs";

test("parseArgs 收集位置参数到 _ 与 --key value / 布尔 flag", () => {
  const a = parseArgs(["quote", "sh600000", "usAAPL", "--html", "--period", "day"]);
  assert.deepEqual(a._, ["quote", "sh600000", "usAAPL"]);
  assert.equal(a.html, true);
  assert.equal(a.period, "day");
});

test("detectMarket 按前缀判市场", () => {
  assert.equal(detectMarket("sh600000"), "a");
  assert.equal(detectMarket("sz000001"), "a");
  assert.equal(detectMarket("hk00700"), "hk");
  assert.equal(detectMarket("usAAPL"), "us");
});

test("detectMarket 不认识的前缀抛错", () => {
  assert.throws(() => detectMarket("xy123"), /前缀/);
});

test("pickKlineSource 按市场选源:a->东财, hk/us->雅虎", () => {
  assert.equal(pickKlineSource("a"), fetchKlineEast);
  assert.equal(pickKlineSource("hk"), fetchKlineYahoo);
  assert.equal(pickKlineSource("us"), fetchKlineYahoo);
  assert.throws(() => pickKlineSource("xx"), /K线源/);
});

test("formatIndicator 标题带中文名与代码", () => {
  const ind = {
    symbol: "sh600519",
    market: "a",
    type: "MACD",
    lines: ["dif", "dea", "macd"],
    series: [{ date: "d1", dif: 0.1234, dea: 0.05, macd: 0.15 }],
  };
  const text = formatIndicator(ind, "贵州茅台");
  assert.match(text, /贵州茅台 sh600519/);
  assert.match(text, /MACD/);
  assert.match(text, /DIF/);
  assert.match(text, /0\.123/);
});

test("formatKline 标题带中文名与代码", () => {
  const kline = {
    symbol: "sh600519",
    market: "a",
    period: "day",
    bars: [{ date: "2026-07-17", open: 1, high: 2, low: 1, close: 1.5, volume: 10 }],
  };
  const text = formatKline(kline, "贵州茅台");
  assert.match(text, /贵州茅台 sh600519 day K线/);
  assert.match(text, /2026-07-17/);
});

test("formatSignals 含历史统计/指标状态与免责,超买区按 RSI 标注", () => {
  const sig = {
    symbol: "sh600519",
    market: "a",
    window: 120,
    price: 1253,
    stats: { rangeReturn: 0.1, maxDrawdown: 0.2, annualVol: 0.3, high: { price: 1269, date: "d1" }, low: { price: 1100, date: "d2" } },
    ma: { ma5: 1250, ma20: 1200, aboveMa5: true, aboveMa20: true },
    rsi: 72,
    macd: { dif: 0.1, dea: 0.05, cross: { type: "金叉", date: "d3" } },
    kdj: { k: 80, d: 70, j: 95 },
  };
  const text = formatSignals(sig, "贵州茅台");
  assert.match(text, /贵州茅台 sh600519/);
  assert.match(text, /历史统计/);
  assert.match(text, /最大回撤/);
  assert.match(text, /超买区/);
  assert.match(text, /金叉/);
  assert.match(text, /不构成买卖建议/);
});
