import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchKline } from "./yahoo.mjs";

function chart(quote, ts = [1781789400]) {
  return { chart: { result: [{ meta: { symbol: "X", currency: "USD" }, timestamp: ts, indicators: { quote: [quote] } }] } };
}

test("解析 Yahoo K线为统一 Kline,日期为 YYYY-MM-DD", async () => {
  const j = chart({ open: [298.11], high: [300.57], low: [295.62], close: [298.01], volume: [85962200] });
  const kl = await fetchKline("usAAPL", "us", { limit: 10 }, { httpGetJson: async () => j });
  assert.equal(kl.bars.length, 1);
  assert.equal(kl.bars[0].close, 298.01);
  assert.equal(kl.bars[0].open, 298.11);
  assert.match(kl.bars[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test("港股代码转换 hk00700 -> 0700.HK", async () => {
  let captured;
  const j = chart({ open: [1], high: [1], low: [1], close: [1], volume: [1] }, [1781659800]);
  await fetchKline("hk00700", "hk", {}, {
    httpGetJson: async (u) => {
      captured = u;
      return j;
    },
  });
  assert.match(captured, /0700\.HK/);
});

test("美股代码转换 usAAPL -> AAPL", async () => {
  let captured;
  const j = chart({ open: [1], high: [1], low: [1], close: [1], volume: [1] });
  await fetchKline("usAAPL", "us", {}, {
    httpGetJson: async (u) => {
      captured = u;
      return j;
    },
  });
  assert.match(captured, /chart\/AAPL\?/);
});

test("无数据时报错", async () => {
  await assert.rejects(
    () => fetchKline("usZZZZ", "us", {}, { httpGetJson: async () => ({ chart: { result: [null] } }) }),
    /不存在|无K线/,
  );
});
