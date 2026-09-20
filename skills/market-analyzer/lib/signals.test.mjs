import { test } from "node:test";
import assert from "node:assert/strict";
import { maxDrawdown, annualizedVol, periodReturn, lastCross, computeSignals } from "./signals.mjs";

test("periodReturn = 末/首 - 1", () => {
  assert.equal(periodReturn([100, 150]), 0.5);
});

test("maxDrawdown 取峰到谷最大跌幅", () => {
  assert.equal(maxDrawdown([100, 120, 60, 80]), 0.5); // 峰 120 -> 谷 60 = 50%
});

test("annualizedVol:恒定收益率波动为 0,有波动则 >0", () => {
  assert.equal(annualizedVol([100, 110, 121]), 0); // 每步 +10%,方差为 0
  assert.ok(annualizedVol([100, 110, 100, 120]) > 0);
});

test("lastCross 识别最近一次金叉/死叉", () => {
  assert.deepEqual(lastCross([-1, 1], [0, 0]), { type: "金叉", index: 1 });
  assert.deepEqual(lastCross([1, -1], [0, 0]), { type: "死叉", index: 1 });
  assert.equal(lastCross([1, 2, 3], [0, 0, 0]).type, null); // 全程在上,无交叉
});

test("computeSignals 产出客观状态结构", () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({
    date: `d${i}`, open: 0, high: 10 + i + 1, low: 10 + i - 1, close: 10 + i, volume: 0,
  }));
  const sig = computeSignals({ symbol: "sh600519", market: "a", period: "day", bars });
  assert.equal(sig.symbol, "sh600519");
  assert.equal(sig.window, 30);
  assert.equal(sig.price, 39); // 末根 close = 10+29
  assert.ok(sig.stats.rangeReturn > 0); // 单调上涨
  assert.equal(sig.stats.maxDrawdown, 0); // 单调上涨,无回撤
  assert.ok("rsi" in sig && "macd" in sig && "kdj" in sig && "ma" in sig);
  assert.equal(sig.ma.aboveMa20, true); // 上涨中现价在 MA20 上方
});
