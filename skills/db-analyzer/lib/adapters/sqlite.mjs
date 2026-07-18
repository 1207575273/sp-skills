import { DatabaseSync } from "node:sqlite";
import { isRowsetStatement } from "../safety-gate.mjs";
import { wrapForLimit, shapeRowset } from "../adapter-utils.mjs";

// MySQL/PostgreSQL/SQLite 的 LIMIT 包装语法一致,共用 adapter-utils 里的默认实现。
// 重新导出,方便测试文件和之前一样直接 `import { wrapForLimit } from "./sqlite.mjs"`。
export { wrapForLimit };

// PRAGMA table_info(<表名>) 不支持把表名当参数绑定,只能内联进 SQL 文本,
// 所以表名必须在这里做标识符转义(双引号包起来,内部双引号双写),不能走 buildIntrospectQuery 的 params。
export function escapeIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

export function buildIntrospectQuery(kind, opts) {
  switch (kind) {
    case "schemas":
      // SQLite 是单文件,没有 MySQL/PostgreSQL/Oracle 那种 schema/database 概念,
      // 这里不报错,返回一个空查询 + 说明文字,CLI 层直接把 note 当结果打印。
      return { sql: null, params: [], note: "SQLite 是单文件数据库,没有 schema/database 概念,不需要这一步。" };
    case "tables":
      return { sql: "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name", params: [] };
    case "columns":
      if (!opts.table) throw new Error("columns 需要 table");
      return { sql: `PRAGMA table_info(${escapeIdent(opts.table)})`, params: [] };
    case "ddl":
      if (!opts.table) throw new Error("ddl 需要 table");
      return { sql: "SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?", params: ["table", opts.table] };
    default:
      throw new Error(`未知的 introspect kind: ${kind}`);
  }
}

export async function connect(envConfig) {
  // 只读性从打开文件这一刻就成立(SQLITE_OPEN_READONLY),不是"打开后再申请只读"——
  // 已实测确认这个模式下 DML 和 DDL 都会被拒绝,比其它三个方言的"连接后发只读事务指令"更彻底。
  return new DatabaseSync(envConfig.path, { readOnly: true });
}

// SQLite 的只读性在 connect() 时通过 { readOnly: true } 已经生效,这里没有额外动作可做——
// 保留这个函数只是为了和其它三个适配器的调用签名保持一致,CLI 层不用为 SQLite 特判。
export async function enforceReadOnly(conn) {
  void conn;
}

export async function runQuery(conn, sql, { limit }) {
  // node:sqlite 是同步本地文件访问,没有网络往返,不存在真正意义上的"查询超时"这个概念,
  // timeoutMs 这里不使用(和其它三个方言的签名保持一致,但故意不解构它,避免误导以为生效了)。
  const isRowset = isRowsetStatement(sql);
  const wrapped = isRowset ? wrapForLimit(sql, limit) : sql;
  const rows = conn.prepare(wrapped).all();
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return shapeRowset({ isRowset, limit, columns, rawRows: rows });
}

export async function introspect(conn, kind, opts) {
  const { sql, params, note } = buildIntrospectQuery(kind, opts);
  // schemas 这个 kind 没有真正的查询,直接把提示文字标成 text 结果带回去。
  if (!sql) return { kind: "text", content: note };
  const rows = conn.prepare(sql).all(...params);
  if (kind === "ddl") {
    return { kind: "text", content: rows[0]?.sql ?? "(未找到该表,检查表名是否正确)" };
  }
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { kind: "table", columns, rows: rows.map((r) => columns.map((c) => r[c])) };
}

export async function close(conn) {
  conn.close();
}
