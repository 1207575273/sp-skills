import { test } from "node:test";
import assert from "node:assert/strict";
import { sma, ema, rsi, macd, kdj, computeIndicator } from "./indicators.mjs";

test("sma 前 period-1 项为 null,其后为窗口均值", () => {
  const r = sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(r.slice(0, 2), [null, null]);
  assert.equal(r[2], 2);
  assert.equal(r[3], 3);
  assert.equal(r[4], 4);
});

test("ema 首项等于首值,长度一致", () => {
  const r = ema([10, 10, 10], 2);
  assert.equal(r[0], 10);
  assert.equal(r.length, 3);
  assert.ok(Math.abs(r[2] - 10) < 1e-9);
});

test("rsi 全程上涨时趋近 100", () => {
  const r = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
  assert.equal(r[13], null); // 第一个有效值在 index 14
  assert.ok(r[15] > 99);
});

test("macd 三线等长且首值 dif=0", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 10 + i);
  const m = macd(closes);
  assert.equal(m.dif.length, 40);
  assert.equal(m.dea.length, 40);
  assert.equal(m.macd.length, 40);
  assert.ok(Math.abs(m.dif[0]) < 1e-9);
});

test("kdj 递推,j = 3k - 2d,值域大致 0..100", () => {
  const bars = Array.from({ length: 20 }, (_, i) => ({ high: 10 + i, low: 8 + i, close: 9 + i }));
  const r = kdj(bars);
  const last = r.k.length - 1;
  assert.ok(Math.abs(r.j[last] - (3 * r.k[last] - 2 * r.d[last])) < 1e-9);
  assert.ok(r.k[last] >= 0 && r.k[last] <= 100);
});

test("computeIndicator 输出统一契约:MACD 有 lines 与 series", () => {
  const kline = {
    symbol: "sh600000",
    market: "a",
    period: "day",
    bars: Array.from({ length: 40 }, (_, i) => ({ date: `d${i}`, open: 0, high: 0, low: 0, close: 10 + i, volume: 0 })),
  };
  const ind = computeIndicator(kline, "MACD", {});
  assert.deepEqual(ind.lines, ["dif", "dea", "macd"]);
  assert.equal(ind.series.length, 40);
  assert.ok("dif" in ind.series[39] && "date" in ind.series[39]);
  assert.equal(ind.type, "MACD");
});
