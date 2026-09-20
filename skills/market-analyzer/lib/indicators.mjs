// 技术指标纯函数:输入价格/K线数组,输出等长指标序列。无 IO、无网络。
// 算法用业界通行口径:EMA 首项取首值递推、RSI 用 Wilder 平滑、KDJ 用 1/3 递推。

export function sma(values, period) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    out.push(i === 0 ? values[0] : values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = values[i] - values[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const dif = values.map((_, i) => emaFast[i] - emaSlow[i]);
  const dea = ema(dif, signal);
  const macdLine = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, macd: macdLine };
}

export function kdj(bars, n = 9, kp = 3, dp = 3) {
  const kArr = [];
  const dArr = [];
  const jArr = [];
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < bars.length; i += 1) {
    const from = Math.max(0, i - n + 1);
    let hi = -Infinity;
    let lo = Infinity;
    for (let x = from; x <= i; x += 1) {
      hi = Math.max(hi, bars[x].high);
      lo = Math.min(lo, bars[x].low);
    }
    const rsv = hi === lo ? 0 : ((bars[i].close - lo) / (hi - lo)) * 100;
    const k = (prevK * (kp - 1) + rsv) / kp;
    const d = (prevD * (dp - 1) + k) / dp;
    kArr.push(k);
    dArr.push(d);
    jArr.push(3 * k - 2 * d);
    prevK = k;
    prevD = d;
  }
  return { k: kArr, d: dArr, j: jArr };
}

// 各指标声明有哪些数值列(lines)与如何从 K线计算(build 返回 { 列名: 等长数组 })。
const SPEC = {
  MA: { lines: ["ma"], build: (kl, p) => ({ ma: sma(closes(kl), p.period || 5) }) },
  RSI: { lines: ["rsi"], build: (kl, p) => ({ rsi: rsi(closes(kl), p.period || 14) }) },
  MACD: { lines: ["dif", "dea", "macd"], build: (kl) => macd(closes(kl)) },
  KDJ: { lines: ["k", "d", "j"], build: (kl) => kdj(kl.bars) },
};

function closes(kline) {
  return kline.bars.map((b) => b.close);
}

export function computeIndicator(kline, type, params = {}) {
  const spec = SPEC[type];
  if (!spec) throw new Error(`不支持的指标类型:${type}(支持 MA/RSI/MACD/KDJ)`);
  const cols = spec.build(kline, params);
  const series = kline.bars.map((b, i) => {
    const row = { date: b.date };
    for (const line of spec.lines) row[line] = cols[line][i];
    return row;
  });
  return { symbol: kline.symbol, market: kline.market, type, params, lines: spec.lines, series };
}
