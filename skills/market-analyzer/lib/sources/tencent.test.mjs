import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchQuote } from "./tencent.mjs";

// 按实跑确认的字段索引构造样本:[1]名称 [3]现价 [4]昨收 [30]时间 [31]涨跌 [32]涨跌% [33]高 [34]低。
function sample(code, fields) {
  const arr = new Array(40).fill("0");
  for (const [i, v] of Object.entries(fields)) arr[i] = v;
  return `v_${code}="${arr.join("~")}";`;
}

test("解析腾讯 A股报价为统一 Quote", async () => {
  const text = sample("sh600000", {
    1: "浦发银行", 3: "8.87", 4: "8.85", 30: "20260717161445", 31: "0.02", 32: "0.23", 33: "8.97", 34: "8.82",
  });
  const q = await fetchQuote("sh600000", "a", { httpGetText: async () => text });
  assert.equal(q.symbol, "sh600000");
  assert.equal(q.market, "a");
  assert.equal(q.name, "浦发银行");
  assert.equal(q.price, 8.87);
  assert.equal(q.prevClose, 8.85);
  assert.equal(q.change, 0.02);
  assert.equal(q.changePct, 0.23);
  assert.equal(q.high, 8.97);
  assert.equal(q.low, 8.82);
  assert.equal(q.time, "20260717161445");
});

test("空响应/代码不存在时报错", async () => {
  await assert.rejects(
    () => fetchQuote("sh999999", "a", { httpGetText: async () => `v_sh999999="";` }),
    /不存在|字段/,
  );
});
