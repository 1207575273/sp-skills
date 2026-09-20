// 腾讯行情源(qt.gtimg.cn):一个接口覆盖 A股/港股/美股/场内ETF 实时报价。
// 响应形如 v_sh600000="1~名称~代码~现价~昨收~今开~...";,GBK 编码,字段 ~ 分隔。
// 字段索引由实跑确认,跨市场一致:[1]名称 [3]现价 [4]昨收 [30]时间 [31]涨跌 [32]涨跌% [33]高 [34]低。
import { httpGetText as defaultHttpGetText } from "../http.mjs";

export function parseQuoteLine(text, code, market) {
  const m = String(text).match(/="([^"]*)"/);
  if (!m) throw new Error(`腾讯行情响应无法解析(${code}):${String(text).slice(0, 60)}`);
  const f = m[1].split("~");
  if (f.length < 35 || !f[3]) {
    throw new Error(`腾讯行情无有效数据,代码可能不存在或未开盘:${code}`);
  }
  return {
    symbol: code,
    market,
    name: f[1],
    price: Number(f[3]),
    prevClose: Number(f[4]),
    change: Number(f[31]),
    changePct: Number(f[32]),
    high: Number(f[33]),
    low: Number(f[34]),
    time: f[30],
  };
}

export async function fetchQuote(code, market, { httpGetText = defaultHttpGetText } = {}) {
  const url = `https://qt.gtimg.cn/q=${code}`;
  const text = await httpGetText(url, { encoding: "gbk" });
  return parseQuoteLine(text, code, market);
}
