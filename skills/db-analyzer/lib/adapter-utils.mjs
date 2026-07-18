// 四个适配器共用的纯函数:LIMIT 包装的默认实现(MySQL/PostgreSQL/SQLite 语法一致,
// Oracle 用 FETCH FIRST 语法不同,单独在 oracle.mjs 里保留自己的实现)、
// 以及查询结果的截断/整形逻辑(四个适配器的 runQuery 结尾都是同一套步骤)。

export function wrapForLimit(sql, limit) {
  return `SELECT * FROM (${sql}) AS db_analyzer_sub LIMIT ${limit + 1}`;
}

// isRowset 由调用方传入(而不是在这里重新调用 isRowsetStatement(sql))——
// 调用方已经算过一次用于决定要不要包 LIMIT,这里复用同一个结果,不重复跑那套字符串扫描。
export function shapeRowset({ isRowset, limit, columns, rawRows }) {
  const truncated = isRowset && rawRows.length > limit;
  const finalRows = truncated ? rawRows.slice(0, limit) : rawRows;
  return { kind: "table", columns, rows: finalRows.map((r) => columns.map((c) => r[c])), truncated };
}
