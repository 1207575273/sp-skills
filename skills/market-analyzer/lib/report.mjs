// 把统一数据结构渲染成单文件自包含 HTML(内联 CSS + 内嵌 SVG),无任何外链。
// 设计取向(frontend-design):浅色、冷静中性 chrome,无渐变/玻璃/大圆角;走势图是主视觉面。
// 涨跌红绿为状态色,按市场习惯(A/港 红涨绿跌、美 绿涨红跌);指标多线用 dataviz 校验过的分类色。
// 注意:内联 HTML 里的 <svg> 不写 xmlns,既符合 HTML5 解析、也保证全文件零 http 外链。

const UP_DOWN = {
  a: { up: "#d92b2b", down: "#17924e" },
  hk: { up: "#d92b2b", down: "#17924e" },
  us: { up: "#17924e", down: "#d92b2b" },
};
const CAT = ["#d97706", "#7c3aed", "#0d9488"]; // 指标多线分类色(validate_palette 全通过)

function colorsFor(market) {
  return UP_DOWN[market] || UP_DOWN.a;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function fmt(v, d = 2) {
  return Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : "-";
}

// 单/多序列折线图。dates: string[];seriesList: [{name, values:(number|null)[], color}]。
function svgChart(dates, seriesList) {
  const width = 760;
  const height = 260;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = dates.length;
  const nums = seriesList.flatMap((s) => s.values).filter((v) => v != null && Number.isFinite(v));
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "";
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;
  const xAt = (i) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;

  const grid = [];
  const ylabels = [];
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const v = min + ((max - min) * t) / ticks;
    const y = yAt(v).toFixed(1);
    grid.push(`<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" class="grid"/>`);
    ylabels.push(`<text x="${padL - 6}" y="${(Number(y) + 3).toFixed(1)}" class="ylabel">${fmt(v)}</text>`);
  }

  const paths = seriesList.map((s) => {
    let d = "";
    let started = false;
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        started = false;
        return;
      }
      d += `${started ? "L" : "M"}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)} `;
      started = true;
    });
    return `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });

  // 单序列在末点直接标值(dataviz:选择性直接标注);颜色由圆点承载,数字用墨色。
  let marker = "";
  if (seriesList.length === 1) {
    const s = seriesList[0];
    let li = -1;
    for (let i = s.values.length - 1; i >= 0; i -= 1) {
      if (s.values[i] != null && Number.isFinite(s.values[i])) {
        li = i;
        break;
      }
    }
    if (li >= 0) {
      const x = xAt(li);
      const y = yAt(s.values[li]);
      marker =
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${s.color}"/>` +
        `<text x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="end" class="lastlabel">${fmt(s.values[li])}</text>`;
    }
  }

  const xIdx = [...new Set([0, Math.floor((n - 1) / 2), n - 1].filter((i) => i >= 0))];
  const xlabels = xIdx.map((i) => {
    const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
    return `<text x="${xAt(i).toFixed(1)}" y="${height - 8}" class="xlabel" text-anchor="${anchor}">${esc(dates[i])}</text>`;
  });

  // 悬停十字竖线(JS 控制 x 与显隐);数据以内嵌 JSON 交给页面底部的交互脚本做鼠标定位。
  const crosshair = `<line class="cx" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" style="display:none"/>`;
  const svg = `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" preserveAspectRatio="xMidYMid meet">${grid.join("")}${paths.join("")}${marker}${crosshair}${ylabels.join("")}${xlabels.join("")}</svg>`;
  const meta = { n, padL, plotW, dates, series: seriesList.map((s) => ({ name: s.name, color: s.color, values: s.values })) };
  const data = JSON.stringify(meta).replace(/</g, "\\u003c");
  return `<div class="chart-wrap">${svg}<div class="chart-tip"></div><script type="application/json" class="chart-data">${data}</script></div>`;
}

function quoteSection(q) {
  const c = colorsFor(q.market);
  const rising = Number(q.change) >= 0;
  const col = rising ? c.up : c.down;
  const sign = rising ? "+" : "";
  return `
  <section class="panel quote">
    <div class="q-head">
      <h1>${esc(q.name)} <span class="sym">${esc(q.symbol)}</span></h1>
      <div class="q-time">${esc(q.time || "")}</div>
    </div>
    <div class="q-price" style="color:${col}">${fmt(q.price)}</div>
    <div class="q-change" style="color:${col}">${sign}${fmt(q.change)}  (${sign}${fmt(q.changePct)}%)</div>
    <dl class="q-facts">
      <div><dt>昨收</dt><dd>${fmt(q.prevClose)}</dd></div>
      <div><dt>最高</dt><dd>${fmt(q.high)}</dd></div>
      <div><dt>最低</dt><dd>${fmt(q.low)}</dd></div>
    </dl>
  </section>`;
}

function klineSection(kl) {
  const closes = kl.bars.map((b) => b.close);
  const dates = kl.bars.map((b) => b.date);
  const c = colorsFor(kl.market);
  const net = closes[closes.length - 1] - closes[0];
  const color = net >= 0 ? c.up : c.down;
  return `
  <section class="panel">
    <h2>收盘价走势 <span class="muted">${esc(kl.period)} · ${kl.bars.length} 根</span></h2>
    ${svgChart(dates, [{ name: "收盘价", values: closes, color }])}
  </section>`;
}

function indicatorSection(ind) {
  const dates = ind.series.map((s) => s.date);
  const seriesList = ind.lines.map((l, i) => ({ name: l, values: ind.series.map((s) => s[l]), color: CAT[i % CAT.length] }));
  const legend =
    ind.lines.length >= 2
      ? `<div class="legend">${seriesList
          .map((s) => `<span class="lg"><i style="background:${s.color}"></i>${esc(s.name)}</span>`)
          .join("")}</div>`
      : "";
  return `
  <section class="panel">
    <h2>${esc(ind.type)} 指标</h2>
    ${legend}
    ${svgChart(dates, seriesList)}
  </section>`;
}

function goldSection(g) {
  const dates = g.series.map((p) => p.time);
  const values = g.series.map((p) => p.price);
  return `
  <section class="panel">
    <h2>${esc(g.instrument)} 当日分时 <span class="muted">现价 ${fmt(g.price)} · 区间 ${fmt(g.low)}-${fmt(g.high)} · ${esc(g.time)}</span></h2>
    ${svgChart(dates, [{ name: g.instrument, values, color: "#b8860b" }])}
  </section>`;
}

function signalsSection(sig) {
  const c = colorsFor(sig.market);
  const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "-");
  const retColor = sig.stats.rangeReturn >= 0 ? c.up : c.down;
  const rsiZone =
    sig.rsi == null ? "-" : sig.rsi >= 70 ? "超买区(70以上)" : sig.rsi <= 30 ? "超卖区(30以下)" : "中性(30-70)";
  const cross = sig.macd.cross.type
    ? `${sig.macd.cross.type}${sig.macd.cross.date ? ` ${esc(sig.macd.cross.date)}` : ""}`
    : "窗口内无交叉";
  return `
  <section class="panel">
    <h2>信号面板 <span class="muted">最近 ${sig.window} 根K线 · 客观状态,非买卖建议</span></h2>
    <dl class="sig-facts">
      <div><dt>区间涨跌幅</dt><dd style="color:${retColor}">${pct(sig.stats.rangeReturn)}</dd></div>
      <div><dt>最大回撤</dt><dd>${pct(sig.stats.maxDrawdown)}</dd></div>
      <div><dt>年化波动率</dt><dd>${pct(sig.stats.annualVol)}</dd></div>
      <div><dt>区间最高</dt><dd>${fmt(sig.stats.high.price)}</dd></div>
      <div><dt>区间最低</dt><dd>${fmt(sig.stats.low.price)}</dd></div>
    </dl>
    <div class="sig-list">
      <div class="row"><span class="k">均线</span><span>现价 vs MA5 ${sig.ma.aboveMa5 ? "上方" : "下方"} · vs MA20 ${sig.ma.aboveMa20 ? "上方" : "下方"}</span></div>
      <div class="row"><span class="k">RSI</span><span>${fmt(sig.rsi)}(${rsiZone})</span></div>
      <div class="row"><span class="k">MACD</span><span>DIF ${fmt(sig.macd.dif)} / DEA ${fmt(sig.macd.dea)};最近${cross}</span></div>
      <div class="row"><span class="k">KDJ</span><span>K ${fmt(sig.kdj.k)} / D ${fmt(sig.kdj.d)} / J ${fmt(sig.kdj.j)}</span></div>
    </div>
    <p class="sig-note">注:以上为已发生的客观数据、指标当前状态与传统定义;不预测涨跌、不构成买卖建议。</p>
  </section>`;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#f7f7f5;color:#1c1c1e;font-family:system-ui,-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.5}
.wrap{max-width:840px;margin:0 auto;padding:28px 20px 40px}
.panel{background:#fff;border:1px solid #e6e6e3;border-radius:10px;padding:20px 22px;margin-bottom:16px}
.panel h2{font-size:15px;font-weight:600;margin:0 0 14px}
.panel h2 .muted{font-weight:400;color:#6e6e73;font-size:13px}
.q-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.quote h1{font-size:20px;font-weight:600;margin:0}
.quote h1 .sym{font-size:13px;color:#6e6e73;font-weight:400;margin-left:6px}
.q-time{color:#6e6e73;font-size:12px}
.q-price{font-size:34px;font-weight:600;margin:10px 0 2px;font-variant-numeric:tabular-nums}
.q-change{font-size:15px;font-weight:500;font-variant-numeric:tabular-nums}
.q-facts{display:flex;gap:28px;margin:16px 0 0;padding:14px 0 0;border-top:1px solid #e6e6e3}
.q-facts div{display:flex;flex-direction:column;gap:2px}
.q-facts dt{color:#6e6e73;font-size:12px;margin:0}
.q-facts dd{margin:0;font-size:15px;font-variant-numeric:tabular-nums}
.chart{width:100%;height:auto;display:block}
.chart .grid{stroke:#eeeeec;stroke-width:1}
.chart .ylabel{fill:#6e6e73;font-size:11px;text-anchor:end}
.chart .xlabel{fill:#6e6e73;font-size:11px}
.chart .lastlabel{fill:#1c1c1e;font-size:11px;font-weight:600}
.legend{display:flex;gap:16px;margin:-4px 0 12px}
.legend .lg{display:inline-flex;align-items:center;gap:6px;color:#6e6e73;font-size:12px}
.legend .lg i{width:10px;height:2px;border-radius:1px;display:inline-block}
.foot{color:#6e6e73;font-size:12px;text-align:center;margin-top:8px}
.sig-facts{display:flex;flex-wrap:wrap;gap:14px 30px;margin:0;padding:0}
.sig-facts div{display:flex;flex-direction:column;gap:2px;min-width:84px}
.sig-facts dt{color:#6e6e73;font-size:12px;margin:0}
.sig-facts dd{margin:0;font-size:17px;font-variant-numeric:tabular-nums}
.sig-list{border-top:1px solid #e6e6e3;margin-top:16px;padding-top:14px;display:grid;gap:8px}
.sig-list .row{display:flex;gap:10px;font-size:13px;line-height:1.5}
.sig-list .k{color:#6e6e73;min-width:44px;flex:none}
.sig-note{color:#6e6e73;font-size:12px;margin:14px 0 0}
.wrap.wide{max-width:1180px}
.cmp-title{font-size:18px;font-weight:600;margin:0 0 16px}
.cmp-title .muted{font-weight:400;color:#6e6e73;font-size:14px}
.cmp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;align-items:start}
.cmp-col{margin-bottom:0}
.cmp-head{margin-bottom:12px}
.cmp-name{font-size:16px;font-weight:600}
.cmp-name .sym{font-size:12px;color:#6e6e73;font-weight:400;margin-left:5px}
.cmp-price{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:6px}
.cmp-chg{font-size:13px;font-weight:500;font-variant-numeric:tabular-nums}
.cmp-fail{color:#d92b2b;font-size:13px;padding:6px 0}
.chart-wrap{position:relative}
.chart-tip{position:absolute;display:none;pointer-events:none;background:#1c1c1e;color:#fff;font-size:12px;line-height:1.55;padding:6px 9px;border-radius:6px;white-space:nowrap;z-index:3;box-shadow:0 2px 10px rgba(0,0,0,.18)}
.chart-tip .sw{display:inline-block;width:8px;height:8px;border-radius:1px;margin-right:5px;vertical-align:middle}
.cx{stroke:#c0c0c0;stroke-width:1;pointer-events:none}
`;

// 页面底部注入一次:给每张图绑鼠标事件,滑到哪根就移动竖线并弹出当天各线数值。纯原生 JS、无外链。
const INIT_SCRIPT = `<script>
(function(){
  function init(wrap){
    var svg=wrap.querySelector('svg'),tip=wrap.querySelector('.chart-tip'),cx=wrap.querySelector('.cx'),dataEl=wrap.querySelector('.chart-data');
    if(!svg||!tip||!cx||!dataEl)return;
    var d;try{d=JSON.parse(dataEl.textContent);}catch(e){return;}
    var vb=svg.viewBox.baseVal;
    function xAt(i){return d.n<=1?d.padL+d.plotW/2:d.padL+(i/(d.n-1))*d.plotW;}
    function move(ev){
      var rect=svg.getBoundingClientRect();if(!rect.width)return;
      var vx=(ev.clientX-rect.left)/rect.width*vb.width;
      var i=Math.round((vx-d.padL)/d.plotW*(d.n-1));
      if(i<0)i=0;if(i>d.n-1)i=d.n-1;
      var gx=xAt(i).toFixed(1);
      cx.setAttribute('x1',gx);cx.setAttribute('x2',gx);cx.style.display='block';
      var rows=d.series.map(function(s){var v=s.values[i];return '<span class="sw" style="background:'+s.color+'"></span>'+s.name+': '+(v==null?'-':Math.round(v*1000)/1000);}).join('<br>');
      tip.innerHTML='<b>'+d.dates[i]+'</b><br>'+rows;tip.style.display='block';
      var wr=wrap.getBoundingClientRect();
      var left=ev.clientX-wr.left+14;if(left>wr.width-150)left=ev.clientX-wr.left-150;
      tip.style.left=left+'px';tip.style.top=(ev.clientY-wr.top+14)+'px';
    }
    svg.addEventListener('mousemove',move);
    svg.addEventListener('mouseleave',function(){cx.style.display='none';tip.style.display='none';});
  }
  var w=document.querySelectorAll('.chart-wrap');for(var k=0;k<w.length;k++)init(w[k]);
})();
</script>`;

export function renderReport({ quote, kline, indicator, gold, signals } = {}) {
  const parts = [];
  if (quote) parts.push(quoteSection(quote));
  if (kline) parts.push(klineSection(kline));
  if (signals) parts.push(signalsSection(signals));
  if (indicator) parts.push(indicatorSection(indicator));
  if (gold) parts.push(goldSection(gold));
  const title = quote
    ? `${quote.name} ${quote.symbol}`
    : gold
      ? `${gold.instrument} 上海黄金交易所`
      : "market-analyzer 报告";
  const footer = `<footer class="foot">数据来自公开接口,仅供参考,不构成投资建议,盈亏自负。</footer>`;
  return htmlPage(title, `${parts.join("\n")}\n${footer}`);
}

// 页面骨架(doctype/head/内联CSS/body),renderReport 与 renderCompare 共用。
function htmlPage(title, inner, wrapClass = "wrap") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="${wrapClass}">
${inner}
</main>
${INIT_SCRIPT}
</body>
</html>`;
}

// 对比页的一栏:名称+现价 + 迷你走势图 + 关键统计。某只拉取失败则渲染失败栏,不连累其它栏。
function compareCard(item) {
  if (item && item.error) {
    return `
  <section class="panel cmp-col">
    <div class="cmp-head"><div class="cmp-name">${esc(item.code || "")}</div></div>
    <div class="cmp-fail">拉取失败:${esc(item.error)}</div>
  </section>`;
  }
  const { quote, kline, signals } = item;
  const q = quote || {};
  const market = (kline && kline.market) || q.market || "a";
  const c = colorsFor(market);
  const name = q.name || (kline && kline.symbol) || "";
  const symbol = q.symbol || (kline && kline.symbol) || "";
  const rising = Number(q.change) >= 0;
  const priceBlock = quote
    ? `<div class="cmp-price" style="color:${rising ? c.up : c.down}">${fmt(q.price)}</div>` +
      `<div class="cmp-chg" style="color:${rising ? c.up : c.down}">${rising ? "+" : ""}${fmt(q.change)} (${rising ? "+" : ""}${fmt(q.changePct)}%)</div>`
    : "";
  let chart = "";
  if (kline && kline.bars.length) {
    const closes = kline.bars.map((b) => b.close);
    const dates = kline.bars.map((b) => b.date);
    const net = closes[closes.length - 1] - closes[0];
    chart = svgChart(dates, [{ name: "收盘价", values: closes, color: net >= 0 ? c.up : c.down }]);
  }
  let stats = "";
  if (signals) {
    const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : "-");
    const retColor = signals.stats.rangeReturn >= 0 ? c.up : c.down;
    const rsiZone = signals.rsi == null ? "-" : signals.rsi >= 70 ? "超买" : signals.rsi <= 30 ? "超卖" : "中性";
    const cross = signals.macd.cross.type
      ? `${signals.macd.cross.type}${signals.macd.cross.date ? ` ${esc(signals.macd.cross.date)}` : ""}`
      : "无交叉";
    stats =
      `<dl class="sig-facts">` +
      `<div><dt>区间涨跌</dt><dd style="color:${retColor}">${pct(signals.stats.rangeReturn)}</dd></div>` +
      `<div><dt>最大回撤</dt><dd>${pct(signals.stats.maxDrawdown)}</dd></div>` +
      `<div><dt>年化波动</dt><dd>${pct(signals.stats.annualVol)}</dd></div>` +
      `</dl>` +
      `<div class="sig-list">` +
      `<div class="row"><span class="k">均线</span><span>MA5 ${signals.ma.aboveMa5 ? "上" : "下"} · MA20 ${signals.ma.aboveMa20 ? "上" : "下"}</span></div>` +
      `<div class="row"><span class="k">RSI</span><span>${fmt(signals.rsi)}(${rsiZone})</span></div>` +
      `<div class="row"><span class="k">MACD</span><span>最近${cross}</span></div>` +
      `</div>`;
  }
  return `
  <section class="panel cmp-col">
    <div class="cmp-head"><div class="cmp-name">${esc(name)} <span class="sym">${esc(symbol)}</span></div>${priceBlock}</div>
    ${chart}
    ${stats}
  </section>`;
}

export function renderCompare(items) {
  const names = items
    .map((it) => (it.error ? it.code : (it.quote && it.quote.name) || (it.kline && it.kline.symbol)) || "")
    .filter(Boolean)
    .join(" vs ");
  const inner =
    `<h1 class="cmp-title">并排对比 <span class="muted">${esc(names)}</span></h1>` +
    `<div class="cmp-grid">${items.map(compareCard).join("\n")}</div>` +
    `<footer class="foot">数据来自公开接口,仅供参考,不构成投资建议,盈亏自负。客观数据与指标状态,不预测涨跌。</footer>`;
  return htmlPage(`对比:${names}`, inner, "wrap wide");
}
