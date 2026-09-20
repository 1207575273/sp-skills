// 东方财富 K线源(push2his.eastmoney.com):A股 / 场内ETF 历史K线。
// secid 规则:沪市 sh -> "1.代码"、深市 sz -> "0.代码"(实跑确认)。
// klines 每行字段顺序:日期,开,收,高,低,量(收在第 3 位)。
import { httpGetJson as defaultHttpGetJson } from "../http.mjs";

const KLT = { day: 101, week: 102, month: 103 };

function secid(code) {
  const c = String(code).toLowerCase();
  if (c.startsWith("sh")) return `1.${c.slice(2)}`;
  if (c.startsWith("sz")) return `0.${c.slice(2)}`;
  throw new Error(`东财只支持 sh/sz 代码(收到:${code})`);
}

export async function fetchKline(code, market, { period = "day", limit = 120 } = {}, { httpGetJson = defaultHttpGetJson } = {}) {
  const klt = KLT[period] || 101;
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid(code)}` +
    `&klt=${klt}&fqt=1&lmt=${limit}&fields1=f1&fields2=f51,f52,f53,f54,f55,f56&end=20500101`;
  const j = await httpGetJson(url);
  const klines = j && j.data && j.data.klines;
  if (!klines || !klines.length) {
    throw new Error(`东财无K线数据,代码可能不存在:${code}`);
  }
  const bars = klines.map((row) => {
    const [date, open, close, high, low, volume] = row.split(",");
    return {
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
  });
  return { symbol: code, market, period, bars };
}
