#!/usr/bin/env node
// 只读行情分析入口:quote/kline/indicator 拉数分析,fundamental/portfolio 规划中。
// 只读——不含任何交易/下单能力。数据来自民用公开接口,非官方 SLA,可能延迟或变动。
//
//   node run-market.mjs quote <代码...>              实时报价
//   node run-market.mjs kline <代码> [--period] [--limit]  历史K线
//   node run-market.mjs indicator <代码> --type MA|RSI|MACD|KDJ  技术指标
//   node run-market.mjs --list-sources               列数据源与覆盖市场
//   --help  看全部选项。加 --html 额外生成自包含 HTML 报告。

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { fetchQuote } from "../lib/sources/tencent.mjs";
import { fetchKline as fetchKlineEast } from "../lib/sources/eastmoney.mjs";
import { fetchKline as fetchKlineYahoo } from "../lib/sources/yahoo.mjs";
import { fetchGold } from "../lib/sources/sge.mjs";
import { computeIndicator } from "../lib/indicators.mjs";
import { renderReport, renderCompare } from "../lib/report.mjs";
import { computeSignals } from "../lib/signals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// 报告归档目录:默认 skill 目录下 reports/;设环境变量 MARKET_ANALYZER_REPORTS 可改到别处(如 repo 外避免 git 噪音)。
const ARCHIVE_DIR = process.env.MARKET_ANALYZER_REPORTS || join(HERE, "..", "reports");

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

// 按代码前缀判市场:sh/sz -> A股(含场内ETF)、hk -> 港股、us -> 美股。
export function detectMarket(code) {
  const c = String(code).toLowerCase();
  if (c.startsWith("sh") || c.startsWith("sz")) return "a";
  if (c.startsWith("hk")) return "hk";
  if (c.startsWith("us")) return "us";
  throw new Error(`认不出市场,代码需带前缀 sh/sz/hk/us(收到:${code})`);
}

const PLANNED = (name) => async () => {
  process.stdout.write(`${name}:尚未实现,规划中\n`);
};

function fmtNum(n) {
  return Number.isFinite(n) ? String(n) : "-";
}

function signed(n) {
  return Number.isFinite(n) ? (n > 0 ? `+${n}` : String(n)) : "-";
}

function renderTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? "").length)));
  const line = (cells) => cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

function formatQuotes(quotes) {
  const rows = quotes.map((q) => [
    q.symbol,
    q.name,
    fmtNum(q.price),
    signed(q.change),
    Number.isFinite(q.changePct) ? `${signed(q.changePct)}%` : "-",
    fmtNum(q.high),
    fmtNum(q.low),
    q.time,
  ]);
  return renderTable(["代码", "名称", "现价", "涨跌", "涨跌%", "最高", "最低", "时间"], rows);
}

export function formatKline(kline, name) {
  const bars = kline.bars;
  const show = bars.length > 30 ? bars.slice(-30) : bars;
  const rows = show.map((b) => [b.date, b.open, b.high, b.low, b.close, b.volume]);
  const table = renderTable(["日期", "开", "高", "低", "收", "量"], rows);
  const note = bars.length > 30 ? `\n(共 ${bars.length} 根,显示最后 30;完整走势用 --html 看图)` : "";
  return `${name ? `${name} ` : ""}${kline.symbol} ${kline.period} K线\n${table}${note}`;
}

export function formatIndicator(ind, name) {
  const round = (v) => (v == null || !Number.isFinite(v) ? "-" : Math.round(v * 1000) / 1000);
  const show = ind.series.length > 15 ? ind.series.slice(-15) : ind.series;
  const rows = show.map((s) => [s.date, ...ind.lines.map((l) => round(s[l]))]);
  const table = renderTable(["日期", ...ind.lines.map((l) => l.toUpperCase())], rows);
  const note = ind.series.length > 15 ? `\n(共 ${ind.series.length} 点,显示最后 15)` : "";
  return `${name ? `${name} ` : ""}${ind.symbol} ${ind.type} 指标\n${table}${note}`;
}

// 信号面板文本:客观统计 + 指标当前状态 + 传统定义。刻意只摆事实,末尾免责,不给买卖结论。
export function formatSignals(sig, name) {
  const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "-");
  const r = (x) => (Number.isFinite(x) ? String(Math.round(x * 1000) / 1000) : "-");
  const rsiZone =
    sig.rsi == null
      ? "-"
      : sig.rsi >= 70
        ? "70 以上,传统上称超买区"
        : sig.rsi <= 30
          ? "30 以下,传统上称超卖区"
          : "30-70,中性区";
  const cross = sig.macd.cross.type
    ? `${sig.macd.cross.type}${sig.macd.cross.date ? ` 在 ${sig.macd.cross.date}` : ""}`
    : "窗口内无交叉";
  return [
    `${name ? `${name} ` : ""}${sig.symbol} 信号面板(客观状态,非买卖建议)`,
    `窗口:最近 ${sig.window} 根K线   现价:${r(sig.price)}`,
    "",
    "[历史统计]",
    `  区间涨跌幅:${pct(sig.stats.rangeReturn)}`,
    `  最大回撤  :${pct(sig.stats.maxDrawdown)}`,
    `  年化波动率:${pct(sig.stats.annualVol)}`,
    `  区间最高  :${r(sig.stats.high.price)}(${sig.stats.high.date})`,
    `  区间最低  :${r(sig.stats.low.price)}(${sig.stats.low.date})`,
    "",
    "[指标状态]",
    `  均线:现价 vs MA5(${r(sig.ma.ma5)}) ${sig.ma.aboveMa5 ? "上方" : "下方"};vs MA20(${r(sig.ma.ma20)}) ${sig.ma.aboveMa20 ? "上方" : "下方"}`,
    `  RSI(14):${r(sig.rsi)}(${rsiZone})`,
    `  MACD:DIF ${r(sig.macd.dif)} / DEA ${r(sig.macd.dea)};最近一次${cross}`,
    `  KDJ:K ${r(sig.kdj.k)} / D ${r(sig.kdj.d)} / J ${r(sig.kdj.j)}`,
    "",
    "注:以上为已发生的客观数据、指标当前状态与传统定义;不预测涨跌、不构成买卖建议。",
  ].join("\n");
}

// 拉报价用于报告的价格卡,失败不该拖垮整份报告(仍能出图),故吞掉降级为无卡。
function safeQuote(code, market) {
  return fetchQuote(code, market).catch(() => undefined);
}

// 归档:按 YYYYMMDDHHMMSS 时间戳存进 reports/,历史分析积累不互相覆盖。
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 收敛纪律:脚本产出的 HTML 一律落在 reports/(ARCHIVE_DIR),绝不写到目录外。
// --html 带名字 -> 只取文件名放进 reports/(忽略任何目录部分);--html 不带值 -> 时间戳_命令_标的.html。
function reportOut(args, cmd, label) {
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  let name;
  if (typeof args.html === "string" && args.html.trim()) {
    name = basename(args.html.trim());
    if (!name.toLowerCase().endsWith(".html")) name += ".html";
  } else {
    const safe = String(label || "").replace(/[^\w.-]/g, "_");
    name = `${stamp()}_${cmd}_${safe}.html`;
  }
  return join(ARCHIVE_DIR, name);
}

function maybeWriteReport(args, payload, cmd, label) {
  if (!args.html) return;
  const abs = reportOut(args, cmd, label);
  writeFileSync(abs, renderReport(payload), "utf8");
  process.stdout.write(`报告已生成:${abs}\n`);
}

async function runQuote(args) {
  const codes = args._.slice(1);
  if (!codes.length) throw new Error("quote 需要至少一个代码,例:quote sh600000 hk00700 usAAPL");
  const quotes = [];
  for (const code of codes) {
    quotes.push(await fetchQuote(code, detectMarket(code)));
  }
  process.stdout.write(`${formatQuotes(quotes)}\n`);
  maybeWriteReport(args, { quote: quotes[0] }, "quote", quotes[0] && quotes[0].symbol);
}

// 按市场选 K线源:A股/场内ETF 走东财,港股/美股走 Yahoo。
export function pickKlineSource(market) {
  if (market === "a") return fetchKlineEast;
  if (market === "hk" || market === "us") return fetchKlineYahoo;
  throw new Error(`没有覆盖该市场的 K线源:${market}`);
}

async function runKline(args) {
  const code = args._[1];
  if (!code) throw new Error("kline 需要一个代码,例:kline sh600000 --limit 60");
  const market = detectMarket(code);
  const period = args.period || "day";
  const limit = args.limit ? Number(args.limit) : 120;
  // 顺带拉一次报价拿中文名(与拉 K线并行,不加延迟);--html 时复用同一份报价。
  const [quote, kline] = await Promise.all([
    safeQuote(code, market),
    pickKlineSource(market)(code, market, { period, limit }),
  ]);
  process.stdout.write(`${formatKline(kline, quote?.name)}\n`);
  if (args.html) maybeWriteReport(args, { quote, kline }, "kline", kline.symbol);
}

async function runIndicator(args) {
  const code = args._[1];
  if (!code) throw new Error("indicator 需要一个代码,例:indicator sh600000 --type MACD");
  const market = detectMarket(code);
  const type = String(args.type || "MA").toUpperCase();
  const params = args.n ? { period: Number(args.n) } : {};
  const klinePeriod = args.period || "day";
  const limit = args.limit ? Number(args.limit) : 120;
  const [quote, kline] = await Promise.all([
    safeQuote(code, market),
    pickKlineSource(market)(code, market, { period: klinePeriod, limit }),
  ]);
  const ind = computeIndicator(kline, type, params);
  process.stdout.write(`${formatIndicator(ind, quote?.name)}\n`);
  if (args.html) maybeWriteReport(args, { quote, kline, indicator: ind }, "indicator", `${kline.symbol}_${ind.type}`);
}

async function runSignals(args) {
  const code = args._[1];
  if (!code) throw new Error("signals 需要一个代码,例:signals sh600519");
  const market = detectMarket(code);
  const limit = args.limit ? Number(args.limit) : 120;
  const [quote, kline] = await Promise.all([
    safeQuote(code, market),
    pickKlineSource(market)(code, market, { period: "day", limit }),
  ]);
  const sig = computeSignals(kline);
  process.stdout.write(`${formatSignals(sig, quote?.name)}\n`);
  if (args.html) maybeWriteReport(args, { quote, kline, signals: sig }, "signals", kline.symbol);
}

function formatGold(g) {
  const r = (x) => (Number.isFinite(x) ? String(Math.round(x * 1000) / 1000) : "-");
  return [
    `上海黄金交易所 ${g.instrument}(人民币/克)`,
    `现价:${r(g.price)}   当日区间:${r(g.low)} - ${r(g.high)}   分时 ${g.series.length} 点`,
    `延时:${g.time}`,
  ].join("\n");
}

async function runGold(args) {
  const instrument = args._[1] || "Au99.99";
  const gold = await fetchGold(instrument);
  process.stdout.write(`${formatGold(gold)}\n`);
  if (args.html) maybeWriteReport(args, { gold }, "gold", gold.instrument);
}

// 并排对比页:多只各拉报价+K线+信号,渲染到一个网页(每只一栏)。对比页本身就是产物,总是写文件。
async function runCompare(args) {
  const codes = args._.slice(1);
  if (codes.length < 2) throw new Error("compare 需要至少两个代码,例:compare sz300750 sh600519");
  const limit = args.limit ? Number(args.limit) : 120;
  const items = await Promise.all(
    codes.map(async (code) => {
      try {
        const market = detectMarket(code);
        const [quote, kline] = await Promise.all([
          safeQuote(code, market),
          pickKlineSource(market)(code, market, { period: "day", limit }),
        ]);
        return { quote, kline, signals: computeSignals(kline) };
      } catch (err) {
        // 单只失败只标这一栏,不连累整页(quote 已容错,这里兜住 kline/市场判定失败)。
        return { code, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  const abs = reportOut(args, "compare", codes.join("-"));
  writeFileSync(abs, renderCompare(items), "utf8");
  process.stdout.write(`对比报告已生成:${abs}\n`);
}

const SUBCOMMANDS = {
  quote: runQuote,
  kline: runKline,
  indicator: runIndicator,
  signals: runSignals,
  gold: runGold,
  compare: runCompare,
  fundamental: PLANNED("fundamental"),
  portfolio: PLANNED("portfolio"),
};

function printUsage() {
  process.stderr.write(
    [
      "market-analyzer —— 只读行情分析,不含任何交易/下单能力。",
      "数据来自民用公开接口(非官方 SLA)。分析结果不构成投资建议,盈亏自负。",
      "",
      "  实时报价: node run-market.mjs quote sh600000 hk00700 usAAPL",
      "  历史K线 : node run-market.mjs kline sh600000 [--period day|week|month] [--limit N]",
      "  技术指标: node run-market.mjs indicator sh600000 --type MA|RSI|MACD|KDJ [--period N]",
      "  信号面板: node run-market.mjs signals sh600000   (客观统计+指标状态,非买卖建议)",
      "  黄金行情: node run-market.mjs gold   (上海黄金交易所 Au99.99 当日分时)",
      "  并排对比: node run-market.mjs compare sz300750 sh600519 [--html 路径]   (多只同屏对比网页)",
      "  列数据源: node run-market.mjs --list-sources",
      "",
      "  代码前缀: A股 sh600000/sz000001, 港股 hk00700, 美股 usAAPL, 场内ETF 用 sh/sz。",
      "  通用选项: --html [路径]  额外生成自包含 HTML 报告(默认 report.html)。",
      "  规划中  : fundamental(基本面) / portfolio(持仓)。",
      "",
    ].join("\n"),
  );
}

function listSources() {
  process.stdout.write(
    [
      "已启用数据源与覆盖:",
      "  腾讯行情    -> 实时报价(A股/港股/美股/场内ETF)",
      "  东方财富    -> 历史K线(A股/场内ETF)",
      "  Yahoo Finance -> 历史K线(美股/港股)",
      "  上海黄金交易所 -> 当日分时(Au99.99 现货黄金)",
      "",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printUsage();
  if (args["list-sources"]) return listSources();

  const cmd = args._[0];
  if (!cmd) return printUsage();

  const handler = SUBCOMMANDS[cmd];
  if (!handler) {
    process.stderr.write(`未知子命令:${cmd}\n`);
    return printUsage();
  }
  return handler(args);
}

// process.argv[1] 在 Windows 上是 D:\... 无前导斜杠,手拼 file:// 会对不上——用 pathToFileURL。
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[market-analyzer] 出错:${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
