import oracledb from "oracledb";
import { isRowsetStatement } from "../safety-gate.mjs";
import { shapeRowset } from "../adapter-utils.mjs";

// 全局只设一次:DBMS_METADATA.GET_DDL 返回 CLOB,不设这个会拿到 Lob 流对象而不是字符串。
// 不调用 oracledb.initOracleClient() —— 一旦调用会切到需要本地装 Oracle Instant Client 的
// Thick 模式,违反本 skill"免装数据库客户端"的前提,任何改动这个文件的人都不要加这行。
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

// 别名不能以下划线开头 —— Oracle 裸标识符必须以字母开头,"_xxx" 会报 ORA-00911: invalid character
// (MySQL/PostgreSQL 不管这个,三个方言统一不用下划线开头是为了避免以后又踩一次)。
export function wrapForLimit(sql, limit) {
  return `SELECT * FROM (${sql}) db_analyzer_sub FETCH FIRST ${limit + 1} ROWS ONLY`;
}

export function buildIntrospectQuery(kind, opts) {
  switch (kind) {
    case "schemas":
      return { sql: "SELECT DISTINCT OWNER AS schema_name FROM ALL_TABLES ORDER BY OWNER", binds: {} };
    case "tables":
      if (!opts.schema) throw new Error("tables 需要 schema");
      return {
        sql: "SELECT TABLE_NAME AS table_name FROM ALL_TABLES WHERE OWNER = :schema ORDER BY TABLE_NAME",
        binds: { schema: opts.schema },
      };
    case "columns":
      // 绑定变量名不能叫 :table —— TABLE 是 Oracle 保留字,即使带冒号前缀也会报
      // ORA-01745: invalid host/bind variable name,改叫 :tname。
      if (!opts.schema || !opts.table) throw new Error("columns 需要 schema 和 table");
      return {
        sql:
          "SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, NULLABLE AS nullable, " +
          "DATA_DEFAULT AS data_default FROM ALL_TAB_COLUMNS " +
          "WHERE OWNER = :schema AND TABLE_NAME = :tname ORDER BY COLUMN_ID",
        binds: { schema: opts.schema, tname: opts.table },
      };
    case "ddl":
      if (!opts.schema || !opts.table) throw new Error("ddl 需要 schema 和 table");
      return {
        sql: "SELECT DBMS_METADATA.GET_DDL(:objectType, :tname, :schema) AS ddl FROM DUAL",
        binds: { objectType: "TABLE", tname: opts.table, schema: opts.schema },
      };
    default:
      throw new Error(`未知的 introspect kind: ${kind}`);
  }
}

export async function connect(envConfig) {
  return oracledb.getConnection({
    connectString: `${envConfig.host}:${envConfig.port}/${envConfig.serviceName}`,
    user: envConfig.user,
    password: envConfig.password,
  });
}

export async function enforceReadOnly(conn) {
  await conn.execute("SET TRANSACTION READ ONLY");
  // 已实测:Oracle 的只读事务只挡 DML(INSERT/UPDATE/DELETE,ORA-01456),挡不住 DDL——
  // DDL 语句会隐式提交当前事务、另起一个默认可写的新事务,SET TRANSACTION READ ONLY 管不到它。
  // 这意味着对 Oracle 来说,应用层语句门禁(safety-gate.mjs)是防 DDL 的唯一真实防线,
  // 账号本身有没有 DDL 权限就变得至关重要——这里主动查一下当前账号有没有明显的 DDL 权限并提醒使用者。
  const ddlPrivs = await conn.execute(
    "SELECT PRIVILEGE FROM SESSION_PRIVS WHERE PRIVILEGE IN ('CREATE TABLE','CREATE ANY TABLE','DROP ANY TABLE','ALTER ANY TABLE')",
  );
  if ((ddlPrivs.rows || []).length > 0) {
    const privs = ddlPrivs.rows.map((r) => r.PRIVILEGE ?? r.privilege).join(", ");
    process.stderr.write(
      `[db-analyzer] 警告:当前 Oracle 账号拥有 DDL 权限(${privs})。Oracle 的只读事务不拦截 DDL,` +
        `本工具的应用层语句门禁是防 DDL 的唯一防线——建议改用无 DDL 权限的账号以获得真正的纵深防御。\n`,
    );
  }
}

export async function runQuery(conn, sql, { limit, timeoutMs }) {
  const isRowset = isRowsetStatement(sql);
  const wrapped = isRowset ? wrapForLimit(sql, limit) : sql;
  const result = await conn.execute(wrapped, [], { callTimeout: timeoutMs });
  const columns = (result.metaData || []).map((f) => f.name);
  return shapeRowset({ isRowset, limit, columns, rawRows: result.rows || [] });
}

export async function introspect(conn, kind, opts) {
  const { sql, binds } = buildIntrospectQuery(kind, opts);
  const result = await conn.execute(sql, binds);
  if (kind === "ddl") {
    const row = result.rows[0] || {};
    return { kind: "text", content: row.DDL ?? row.ddl ?? "" };
  }
  const columns = (result.metaData || []).map((f) => f.name);
  return { kind: "table", columns, rows: result.rows.map((r) => columns.map((c) => r[c])) };
}

export async function close(conn) {
  await conn.close();
}
