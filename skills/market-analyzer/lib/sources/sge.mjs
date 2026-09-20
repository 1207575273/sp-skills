// 上海黄金交易所行情源(www.sge.com.cn/graph/quotations):默认返回 Au99.99 当日分时。
// 响应:{ times:[分钟...], data:[价格...], min, max, heyue:合约名, delaystr:延时时间 }(实跑确认)。
import { httpGetJson as defaultHttpGetJson } from "../http.mjs";

export function parseGold(json, instrument) {
  const times = (json && json.times) || [];
  const data = (json && json.data) || [];
  if (!times.length || !data.length) {
    throw new Error(`上金所无行情数据:${instrument}`);
  }
  const series = times
    .map((t, i) => ({ time: t, price: Number(data[i]) }))
    .filter((p) => Number.isFinite(p.price));
  if (!series.length) {
    throw new Error(`上金所无行情数据:${instrument}`);
  }
  // json.min/max 是图表纵轴取整边界,不是真实高低(实测现价可低于 json.min)。从分时数据实算。
  const prices = series.map((p) => p.price);
  const last = series[series.length - 1];
  return {
    instrument: json.heyue || instrument,
    price: last.price,
    low: Math.min(...prices),
    high: Math.max(...prices),
    time: json.delaystr || "",
    series,
  };
}

export async function fetchGold(instrument = "Au99.99", { httpGetJson = defaultHttpGetJson } = {}) {
  // quotations 默认给 Au99.99(现货黄金,人民币/克)当日分时。
  const url = "https://www.sge.com.cn/graph/quotations";
  const json = await httpGetJson(url);
  return parseGold(json, instrument);
}
