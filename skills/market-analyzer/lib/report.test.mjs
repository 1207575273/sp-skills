import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, renderCompare } from "./report.mjs";

const quote = {
  symbol: "sh600000", market: "a", name: "浦发银行",
  price: 10.5, prevClose: 10.4, change: 0.1, changePct: 0.96, high: 10.6, low: 10.3, time: "20260717",
};
const kline = {
  symbol: "sh600000", market: "a", period: "day",
  bars: [
    { date: "d1", open: 1, high: 2, low: 1, close: 1.5, volume: 10 },
    { date: "d2", open: 1.5, high: 3, low: 1.5, close: 2.8, volume: 20 },
  ],
};
const indicator = {
  symbol: "sh600000", market: "a", type: "MACD", lines: ["dif", "dea", "macd"],
  series: [
    { date: "d1", dif: 0.1, dea: 0.05, macd: 0.1 },
    { date: "d2", dif: 0.2, dea: 0.1, macd: 0.2 },
  ],
};

test("报告是自包含 HTML,无任何 http(s) 外链", () => {
  const html = renderReport({ quote, kline });
  assert.match(html, /<!doctype html>/i);
  assert.ok(!/https?:\/\//i.test(html), "不应含 http(s):// 外链");
});

test("含报价与 K线板块、关键数值、内嵌 svg", () => {
  const html = renderReport({ quote, kline });
  assert.match(html, /浦发银行/);
  assert.match(html, /10\.5/);
  assert.match(html, /<svg/);
});

test("只传 quote 时不渲染 K线板块(无 svg)", () => {
  const html = renderReport({ quote });
  assert.ok(!/<svg/.test(html));
});

test("图表带 hover 交互:含 chart-wrap/十字线/数据脚本/初始化脚本,仍无外链", () => {
  const html = renderReport({ quote, kline });
  assert.match(html, /class="chart-wrap"/);
  assert.match(html, /class="chart-data"/);
  assert.match(html, /class="cx"/);
  assert.match(html, /mousemove/);
  assert.ok(!/https?:\/\//i.test(html), "交互脚本不应引入外链");
});

test("指标板块渲染类型标题与多线图例", () => {
  const html = renderReport({ quote, kline, indicator });
  assert.match(html, /MACD/);
  assert.match(html, /dif/i);
});

test("signals 板块渲染历史统计与指标状态,自包含无外链", () => {
  const sig = {
    symbol: "sh600519", market: "a", window: 120, price: 1253,
    stats: { rangeReturn: 0.1, maxDrawdown: 0.2, annualVol: 0.3, high: { price: 1269, date: "d1" }, low: { price: 1100, date: "d2" } },
    ma: { ma5: 1250, ma20: 1200, aboveMa5: true, aboveMa20: true },
    rsi: 72,
    macd: { dif: 0.1, dea: 0.05, cross: { type: "金叉", date: "d3" } },
    kdj: { k: 80, d: 70, j: 95 },
  };
  const html = renderReport({ signals: sig });
  assert.match(html, /信号面板/);
  assert.match(html, /最大回撤/);
  assert.match(html, /超买区/);
  assert.match(html, /金叉/);
  assert.ok(!/https?:\/\//i.test(html));
});

test("renderCompare 并排多只:含各自名称与走势图,自包含无外链", () => {
  const item = (sym, name) => ({
    quote: { symbol: sym, market: "a", name, price: 10, change: 0.1, changePct: 1, prevClose: 9.9, high: 11, low: 9, time: "t" },
    kline: { symbol: sym, market: "a", period: "day", bars: [
      { date: "d1", open: 1, high: 2, low: 1, close: 1.5, volume: 1 },
      { date: "d2", open: 1.5, high: 3, low: 1.5, close: 2.8, volume: 1 },
    ] },
    signals: {
      symbol: sym, market: "a", window: 2, price: 2.8,
      stats: { rangeReturn: 0.8, maxDrawdown: 0, annualVol: 0.3, high: { price: 3, date: "d2" }, low: { price: 1, date: "d1" } },
      ma: { ma5: 2, ma20: 2, aboveMa5: true, aboveMa20: true },
      rsi: 60, macd: { dif: 0.1, dea: 0.05, cross: { type: "金叉", date: "d2" } }, kdj: { k: 80, d: 70, j: 95 },
    },
  });
  const html = renderCompare([item("sz300750", "宁德时代"), item("sh600519", "贵州茅台")]);
  assert.match(html, /宁德时代/);
  assert.match(html, /贵州茅台/);
  assert.equal((html.match(/<svg/g) || []).length, 2);
  assert.ok(!/https?:\/\//i.test(html));
});

test("renderCompare 某只失败只渲染失败栏,不连累其它栏", () => {
  const ok = {
    quote: { symbol: "sz300750", market: "a", name: "宁德时代", price: 360, change: -6, changePct: -1.6, prevClose: 366, high: 375, low: 360, time: "t" },
    kline: { symbol: "sz300750", market: "a", period: "day", bars: [{ date: "d1", open: 1, high: 2, low: 1, close: 1.5, volume: 1 }, { date: "d2", open: 1.5, high: 3, low: 1.5, close: 2.8, volume: 1 }] },
    signals: { symbol: "sz300750", market: "a", window: 2, price: 2.8, stats: { rangeReturn: 0.8, maxDrawdown: 0, annualVol: 0.3, high: { price: 3, date: "d2" }, low: { price: 1, date: "d1" } }, ma: { ma5: 2, ma20: 2, aboveMa5: true, aboveMa20: true }, rsi: 60, macd: { dif: 0.1, dea: 0.05, cross: { type: "金叉", date: "d2" } }, kdj: { k: 80, d: 70, j: 95 } },
  };
  const bad = { code: "sz999999", error: "东财无K线数据,代码可能不存在:sz999999" };
  const html = renderCompare([ok, bad]);
  assert.match(html, /宁德时代/); // 好的那栏正常
  assert.match(html, /sz999999/); // 失败栏标出代码
  assert.match(html, /拉取失败/);
  assert.equal((html.match(/<svg/g) || []).length, 1); // 只有好的那栏有图
});

test("黄金板块渲染合约名与分时图,自包含无外链", () => {
  const gold = {
    instrument: "Au99.99", price: 873.1, low: 872, high: 873.1, time: "2026年07月20日",
    series: [{ time: "20:00", price: 872 }, { time: "20:01", price: 873 }],
  };
  const html = renderReport({ gold });
  assert.match(html, /Au99\.99/);
  assert.match(html, /<svg/);
  assert.ok(!/https?:\/\//i.test(html));
});
