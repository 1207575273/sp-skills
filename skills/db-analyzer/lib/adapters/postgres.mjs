import pg from "pg";
import { isRowsetStatement } from "../safety-gate.mjs";
import { wrapForLimit, shapeRowset } from "../adapter-utils.mjs";

const { Client } = pg;

// MySQL/PostgreSQL/SQLite 的 LIMIT 包装语法一致,共用 adapter-utils 里的默认实现。
// 重新导出,方便测试文件和之前一样直接 `import { wrapForLimit } from "./postgres.mjs"`。
export { wrapForLimit };

export function buildIntrospectQuery(kind, opts) {
  const schema = opts.schema || "public";
  switch (kind) {
    case "schemas":
      return { sql: "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name", params: [] };
    case "tables":
      return {
        sql:
          "SELECT table_name, table_type FROM information_schema.tables " +
          "WHERE table_schema = $1 ORDER BY table_name",
        params: [schema],
      };
    case "columns":
      if (!opts.table) throw new Error("columns 需要 table");
      return {
        sql:
          "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
          "WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        params: [schema, opts.table],
      };
    case "ddl":
      if (!opts.table) throw new Error("ddl 需要 table");
      return {
        columnsQuery: {
          sql:
            "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
            "WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
          params: [schema, opts.table],
        },
        indexesQuery: {
          sql: "SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2",
          params: [schema, opts.table],
        },
        constraintsQuery: {
          sql:
            "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint " +
            "WHERE conrelid = ($1 || '.' || $2)::regclass",
          params: [schema, opts.table],
        },
      };
    default:
      throw new Error(`未知的 introspect kind: ${kind}`);
  }
}

export function formatDdlFromRows({ schema, table, columns, indexes, constraints }) {
  const columnLines = columns.map((c) => {
    const notNull = c.is_nullable === "NO" ? " NOT NULL" : "";
    const def = c.column_default ? ` DEFAULT ${c.column_default}` : "";
    return `  ${c.column_name} ${c.data_type}${notNull}${def}`;
  });
  const lines = [
    `-- 尽力还原,不保证与 pg_dump 逐字节一致,足够用于理解结构`,
    `CREATE TABLE ${schema}.${table} (`,
    columnLines.join(",\n"),
    ");",
    "",
    "-- 索引",
    ...indexes.map((i) => i.indexdef + ";"),
    "",
    "-- 约束",
    ...constraints.map((c) => `-- ${c.conname}: ${c.definition}`),
  ];
  return lines.join("\n");
}

export async function connect(envConfig) {
  const client = new Client({
    host: envConfig.host,
    port: Number(envConfig.port), // config 是从 yaml 读出来的字符串,驱动要数字
    database: envConfig.database,
    user: envConfig.user,
    password: envConfig.password,
  });
  await client.connect();
  return client;
}

export async function enforceReadOnly(conn) {
  await conn.query("SET default_transaction_read_only = on");
}

export async function runQuery(conn, sql, { limit, timeoutMs }) {
  const isRowset = isRowsetStatement(sql);
  const wrapped = isRowset ? wrapForLimit(sql, limit) : sql;
  await conn.query(`SET statement_timeout = ${timeoutMs}`);
  const result = await conn.query(wrapped);
  const columns = result.fields.map((f) => f.name);
  return shapeRowset({ isRowset, limit, columns, rawRows: result.rows });
}

export async function introspect(conn, kind, opts) {
  if (kind === "ddl") {
    const q = buildIntrospectQuery("ddl", opts);
    // pg.Client 是单连接,不支持同一连接上并发查询(Promise.all 会触发废弃警告,
    // 未来版本直接报错),这三条查询必须顺序执行。
    const columnsRes = await conn.query(q.columnsQuery.sql, q.columnsQuery.params);
    const indexesRes = await conn.query(q.indexesQuery.sql, q.indexesQuery.params);
    const constraintsRes = await conn.query(q.constraintsQuery.sql, q.constraintsQuery.params);
    const ddl = formatDdlFromRows({
      schema: opts.schema || "public",
      table: opts.table,
      columns: columnsRes.rows,
      indexes: indexesRes.rows,
      constraints: constraintsRes.rows,
    });
    return { kind: "text", content: ddl };
  }
  const { sql, params } = buildIntrospectQuery(kind, opts);
  const result = await conn.query(sql, params);
  const columns = result.fields.map((f) => f.name);
  return { kind: "table", columns, rows: result.rows.map((r) => columns.map((c) => r[c])) };
}

export async function close(conn) {
  await conn.end();
}
