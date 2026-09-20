// 唯一出网点:带超时 + 日志打点的公开接口 GET。其它模块不直接 fetch。
// fetchImpl 末位可注入,便于测试不真出网。

function trace(msg, extra) {
  process.stderr.write(`[market-analyzer] ${msg}${extra ? " " + JSON.stringify(extra) : ""}\n`);
}

export async function httpGetText(url, { timeoutMs = 8000, headers = {}, encoding = "utf-8" } = {}, fetchImpl = globalThis.fetch) {
  const started = Date.now();
  trace("http.get", { url });
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "market-analyzer/1.0", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      trace("http.fail", { url, status: res.status, ms: Date.now() - started });
      throw new Error(`HTTP ${res.status}:数据源返回异常 ${url}`);
    }
    // 腾讯行情等接口是 GBK,默认 res.text() 按 UTF-8 会乱码;非 utf-8 走 arrayBuffer + TextDecoder。
    const text =
      encoding === "utf-8" ? await res.text() : new TextDecoder(encoding).decode(await res.arrayBuffer());
    trace("http.ok", { url, status: res.status, ms: Date.now() - started, bytes: text.length });
    return text;
  } catch (err) {
    if (err && (err.name === "AbortError" || err.name === "TimeoutError")) {
      trace("http.timeout", { url, ms: Date.now() - started });
      throw new Error(`请求超时(${timeoutMs}ms),可调大 timeout:${url}`);
    }
    throw err;
  }
}

export async function httpGetJson(url, opts, fetchImpl = globalThis.fetch) {
  return JSON.parse(await httpGetText(url, opts, fetchImpl));
}
