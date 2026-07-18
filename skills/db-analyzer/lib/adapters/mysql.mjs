import mysql from "mysql2/promise";
import { isRowsetStatement } from "../safety-gate.mjs";
import { wrapForLimit, shapeRowset } from "../adapter-utils.mjs";

// MySQL/PostgreSQL/SQLite 的 LIMIT 包装语法一致,共用 adapter-utils 里的默认实现
// (只对 SELECT/WITH 这类行集语句调用,EXPLAIN/SHOW/DESCRIBE 不走这条路径)。
// 重新导出,方便测试文件和之前一样直接 `import { wrapForLimit } from "./mysql.mjs"`。
export { wrapForLimit };

function escapeIdent(name) {
  return "`" + String(name).replace(/`/g, "``") + "`";
}

export function buildIntrospectQuery(kind, opts) {
  switch (kind) {
    case "schemas":
      return {
        sql: "SELECT SCHEMA_NAME AS schema_name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
        params: [],
      };
    case "tables":
      if (!opts.schema) throw new Error("tables 需要 schema");
      return {
        sql:
          "SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type FROM information_schema.TABLES " +
          "WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
        params: [opts.schema],
      };
    case "columns":
      if (!opts.schema || !opts.table) throw new Error("columns 需要 schema 和 table");
      return {
        sql:
          "SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable, " +
          "COLUMN_DEFAULT AS column_default FROM information_schema.COLUMNS " +
          "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
        params: [opts.schema, opts.table],
      };
    case "ddl":
      if (!opts.table) throw new Error("ddl 需要 table");
      return { sql: `SHOW CREATE TABLE ${escapeIdent(opts.table)}`, params: [] };
    default:
      throw new Error(`未知的 introspect kind: ${kind}`);
  }
}

export async function connect(envConfig) {
  return mysql.createConnection({
    host: envConfig.host,
    port: Number(envConfig.port), // config 是从 yaml 读出来的字符串,驱动要数字
    database: envConfig.database,
    user: envConfig.user,
    password: envConfig.password,
  });
}

export async function enforceReadOnly(conn) {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
}

export async function runQuery(conn, sql, { limit, timeoutMs }) {
  const isRowset = isRowsetStatement(sql);
  const wrapped = isRowset ? wrapForLimit(sql, limit) : sql;
  const [rows, fields] = await conn.query({ sql: wrapped, timeout: timeoutMs });
  const columns = fields ? fields.map((f) => f.name) : [];
  return shapeRowset({ isRowset, limit, columns, rawRows: rows });
}

export async function introspect(conn, kind, opts) {
  const { sql, params } = buildIntrospectQuery(kind, opts);
  const [rows, fields] = await conn.query(sql, params);
  if (kind === "ddl") {
    const row = rows[0] || {};
    return { kind: "text", content: row["Create Table"] ?? row["create table"] ?? "" };
  }
  const columns = fields.map((f) => f.name);
  return { kind: "table", columns, rows: rows.map((r) => columns.map((c) => r[c])) };
}

export async function close(conn) {
  await conn.end();
}
