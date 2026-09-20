import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGold, fetchGold } from "./sge.mjs";

const sample = {
  times: ["20:00", "20:01", "20:02"],
  data: ["872.48", "872.50", "873.10"],
  min: 867, // 图表轴边界(应被忽略)
  max: 877,
  heyue: "Au99.99",
  delaystr: "2026年07月20日 02:29:55",
};

test("parseGold 解析结构,高低从分时数据实算(不用 json.min/max 轴边界)", () => {
  const g = parseGold(sample, "Au99.99");
  assert.equal(g.instrument, "Au99.99");
  assert.equal(g.price, 873.1); // 末点
  assert.equal(g.low, 872.48); // 数据实算,非 json.min 867
  assert.equal(g.high, 873.1); // 数据实算,非 json.max 877
  assert.equal(g.series.length, 3);
  assert.deepEqual(g.series[0], { time: "20:00", price: 872.48 });
  assert.match(g.time, /2026/);
});

test("parseGold 空数据报错", () => {
  assert.throws(() => parseGold({ times: [], data: [] }, "Au99.99"), /无行情/);
});

test("fetchGold 用注入的 httpGetJson 返回结构", async () => {
  const g = await fetchGold("Au99.99", { httpGetJson: async () => sample });
  assert.equal(g.instrument, "Au99.99");
  assert.equal(g.price, 873.1);
});
