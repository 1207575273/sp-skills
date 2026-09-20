// Yahoo Finance K线源(query1.finance.yahoo.com/v8/finance/chart):美股 / 港股 历史K线。
// 代码转换:美股 usAAPL -> AAPL;港股 hk00700 -> 0700.HK(去 hk 前缀、数字补足 4 位 + .HK)。
import { httpGetJson as defaultHttpGetJson } from "../http.mjs";

const RANGE = { day: "6mo", week: "2y", month: "5y" };
const INTERVAL = { day: "1d", week: "1wk", month: "1mo" };

function yahooSymbol(code, market) {
  const c = String(code).toLowerCase();
  if (market === "us") return code.slice(2).toUpperCase();
  if (market === "hk") {
    const num = c.slice(2).replace(/^0+/, "") || "0";
    return `${num.padStart(4, "0")}.HK`;
  }
  throw new Error(`Yahoo 只支持美股/港股(收到:${code})`);
}

const round3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

export async function fetchKline(code, market, { period = "day", limit = 120 } = {}, { httpGetJson = defaultHttpGetJson } = {}) {
  const sym = yahooSymbol(code, market);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${sym}` +
    `?range=${RANGE[period] || "6mo"}&interval=${INTERVAL[period] || "1d"}`;
  const j = await httpGetJson(url);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) {
    throw new Error(`Yahoo 无K线数据,代码可能不存在:${code}`);
  }
  const q = r.indicators.quote[0];
  const bars = r.timestamp
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: round3(q.open[i]),
      high: round3(q.high[i]),
      low: round3(q.low[i]),
      close: round3(q.close[i]),
      volume: q.volume[i] ?? 0,
    }))
    .filter((b) => b.close != null)
    .slice(-limit);
  return { symbol: code, market, period, bars };
}
