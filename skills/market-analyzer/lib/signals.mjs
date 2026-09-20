// 信号面板的纯计算:历史客观统计 + 指标当前状态。全是已发生的事实与指标的通行定义。
// 明确边界:这里只描述"仪表盘现在显示什么",不预测涨跌、不产出买卖结论。
import { sma, rsi, macd, kdj } from "./indicators.mjs";

export function periodReturn(closes) {
  if (closes.length < 2 || !closes[0]) return 0;
  return closes[closes.length - 1] / closes[0] - 1;
}

export function maxDrawdown(closes) {
  let peak = closes[0];
  let mdd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = peak ? (peak - c) / peak : 0;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

// 日收益率标准差 * sqrt(每年交易日),得到年化波动率。
export function annualizedVol(closes, periodsPerYear = 252) {
  const rets = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1]) rets.push(closes[i] / closes[i - 1] - 1);
  }
  if (rets.length === 0) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

// 最近一次 DIF 与 DEA 的交叉:DIF 上穿 = 金叉,下穿 = 死叉。从末尾往回找第一次。
export function lastCross(dif, dea) {
  for (let i = dif.length - 1; i > 0; i -= 1) {
    const prev = dif[i - 1] - dea[i - 1];
    const cur = dif[i] - dea[i];
    if (prev <= 0 && cur > 0) return { type: "金叉", index: i };
    if (prev >= 0 && cur < 0) return { type: "死叉", index: i };
  }
  return { type: null, index: -1 };
}

export function computeSignals(kline) {
  const bars = kline.bars;
  const closes = bars.map((b) => b.close);
  const last = closes.length - 1;
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const rsiArr = rsi(closes, 14);
  const m = macd(closes);
  const kd = kdj(bars);

  let hi = -Infinity;
  let lo = Infinity;
  let hiDate = null;
  let loDate = null;
  for (const b of bars) {
    if (b.high > hi) {
      hi = b.high;
      hiDate = b.date;
    }
    if (b.low < lo) {
      lo = b.low;
      loDate = b.date;
    }
  }

  const cross = lastCross(m.dif, m.dea);
  return {
    symbol: kline.symbol,
    market: kline.market,
    window: bars.length,
    price: closes[last],
    stats: {
      rangeReturn: periodReturn(closes),
      maxDrawdown: maxDrawdown(closes),
      annualVol: annualizedVol(closes),
      high: { price: hi, date: hiDate },
      low: { price: lo, date: loDate },
    },
    ma: {
      ma5: ma5[last],
      ma20: ma20[last],
      aboveMa5: ma5[last] != null && closes[last] > ma5[last],
      aboveMa20: ma20[last] != null && closes[last] > ma20[last],
    },
    rsi: rsiArr[last],
    macd: {
      dif: m.dif[last],
      dea: m.dea[last],
      cross: { type: cross.type, date: cross.index >= 0 ? bars[cross.index].date : null },
    },
    kdj: { k: kd.k[last], d: kd.d[last], j: kd.j[last] },
  };
}
