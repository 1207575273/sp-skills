import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchKline } from "./eastmoney.mjs";

test("解析东财K线为统一 Kline(字段顺序 日期,开,收,高,低,量)", async () => {
  const j = { data: { code: "600000", klines: ["2026-07-17,8.85,8.87,8.97,8.82,796240"] } };
  const kl = await fetchKline("sh600000", "a", { limit: 10 }, { httpGetJson: async () => j });
  assert.equal(kl.symbol, "sh600000");
  assert.equal(kl.market, "a");
  assert.equal(kl.bars.length, 1);
  assert.deepEqual(kl.bars[0], { date: "2026-07-17", open: 8.85, high: 8.97, low: 8.82, close: 8.87, volume: 796240 });
});

test("secid 前缀映射:sh->1. sz->0.", async () => {
  const j = { data: { klines: ["2026-01-01,1,1,1,1,1"] } };
  let captured;
  const spy = async (url) => {
    captured = url;
    return j;
  };
  await fetchKline("sh600000", "a", {}, { httpGetJson: spy });
  assert.match(captured, /secid=1\.600000/);
  await fetchKline("sz000001", "a", {}, { httpGetJson: spy });
  assert.match(captured, /secid=0\.000001/);
});

test("无数据时报错", async () => {
  await assert.rejects(
    () => fetchKline("sh000000", "a", {}, { httpGetJson: async () => ({ data: { klines: [] } }) }),
    /不存在|无K线/,
  );
});
