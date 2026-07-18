// 只读语句门禁:数据库无关的第一道防线,执行前拦截。
// 注意这不是完整的 SQL 解析器,是尽力而为的结构性检查——真正兜底的是每个适配器
// 连接后下发的引擎级只读事务指令(见 adapters/*.mjs 的 enforceReadOnly),
// 这里的作用是"绝大多数误用/明显违规在发出网络请求前就被挡掉,报错也更好懂"。

const STRING_LITERAL = /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"/g;
const LINE_COMMENT = /--[^\n]*/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

function stripNoise(sql) {
  return sql.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, " ").replace(STRING_LITERAL, "''");
}

const LEADING_ALLOWED = /^\s*(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE|DESC)\b/i;
const LEADING_ROWSET = /^\s*(SELECT|WITH)\b/i;
// "SHOW CREATE TABLE/VIEW ..." 是合法只读内省语句(查看建表语句用),
// 但它字面包含 CREATE 一词,会被下面的 FORBIDDEN 扫描误伤,查 FORBIDDEN 前先把这个固定搭配挖掉。
const SHOW_CREATE_IDIOM = /\bSHOW\s+CREATE\b/gi;
const FORBIDDEN = new RegExp(
  "\\b(" +
    [
      "INSERT",
      "UPDATE",
      "DELETE",
      "DROP",
      "ALTER",
      "TRUNCATE",
      "CREATE",
      "GRANT",
      "REVOKE",
      "MERGE",
      "CALL",
      "EXEC",
      "EXECUTE",
      "REPLACE",
      "SET",
      "LOCK",
      "UNLOCK",
      "COMMIT",
      "ROLLBACK",
      "SAVEPOINT",
      "BEGIN",
      "VACUUM",
      "COPY",
      "DO",
    ].join("|") +
    ")\\b",
  "i",
);

export function validateReadOnlySql(rawSql) {
  const sql = typeof rawSql === "string" ? rawSql.trim() : "";
  if (!sql) return { ok: false, reason: "SQL 为空" };

  const clean = stripNoise(sql).trim();
  const withoutTrailingSemicolon = clean.replace(/;\s*$/, "");

  if (withoutTrailingSemicolon.includes(";")) {
    return { ok: false, reason: "仅支持单条只读语句,检测到多条语句(分号分隔)" };
  }
  if (!LEADING_ALLOWED.test(withoutTrailingSemicolon)) {
    return { ok: false, reason: "仅支持只读查询(SELECT/WITH/EXPLAIN/SHOW/DESCRIBE 开头)" };
  }
  const forbiddenCheckText = withoutTrailingSemicolon.replace(SHOW_CREATE_IDIOM, "SHOW_CREATE_IDIOM_OK");
  if (FORBIDDEN.test(forbiddenCheckText)) {
    return { ok: false, reason: "仅支持只读查询,检测到写操作或事务/会话控制关键字" };
  }
  return { ok: true };
}

export function isRowsetStatement(rawSql) {
  const sql = typeof rawSql === "string" ? rawSql.trim() : "";
  const clean = stripNoise(sql).trim();
  return LEADING_ROWSET.test(clean);
}
