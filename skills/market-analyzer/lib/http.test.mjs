import { test } from "node:test";
import assert from "node:assert/strict";
import { httpGetText } from "./http.mjs";

test("2xx 返回正文", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, text: async () => "hello" });
  assert.equal(await httpGetText("http://x", {}, fakeFetch), "hello");
});

test("非 2xx 抛出含状态码的错误", async () => {
  const fakeFetch = async () => ({ ok: false, status: 503, text: async () => "" });
  await assert.rejects(() => httpGetText("http://x", {}, fakeFetch), /503/);
});

test("超时/中断归一化为超时错误", async () => {
  const fakeFetch = async () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  };
  await assert.rejects(() => httpGetText("http://x", { timeoutMs: 10 }, fakeFetch), /超时/);
});

test("非 utf-8 编码走 arrayBuffer + TextDecoder 解码", async () => {
  const bytes = new TextEncoder().encode("hello"); // ASCII 在 gbk 中等价,验证走的是 arrayBuffer 分支
  const fakeFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer });
  assert.equal(await httpGetText("http://x", { encoding: "gbk" }, fakeFetch), "hello");
});
