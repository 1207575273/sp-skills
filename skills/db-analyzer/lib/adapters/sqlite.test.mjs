import { describe, it, expect } from "vitest";
import { wrapForLimit, buildIntrospectQuery, escapeIdent } from "./sqlite.mjs";

describe("sqlite wrapForLimit", () => {
  it("用子查询包一层并把 limit+1 作为 LIMIT", () => {
    expect(wrapForLimit("SELECT * FROM t", 200)).toBe(
      "SELECT * FROM (SELECT * FROM t) AS db_analyzer_sub LIMIT 201",
    );
  });
});

describe("sqlite escapeIdent", () => {
  it("双引号转义标识符,内部双引号双写", () => {
    expect(escapeIdent('weird"name')).toBe('"weird""name"');
  });
});

describe("sqlite buildIntrospectQuery", () => {
  it("schemas: SQLite 没有 schema 概念,返回固定提示而不是报错", () => {
    const { sql, params, note } = buildIntrospectQuery("schemas", {});
    expect(sql).toBeNull();
    expect(params).toEqual([]);
    expect(note).toMatch(/没有.*schema|不区分/);
  });

  it("tables: 查 sqlite_schema", () => {
    const { sql, params } = buildIntrospectQuery("tables", {});
    expect(sql).toMatch(/sqlite_schema/);
    expect(sql).toMatch(/type\s*=\s*'table'/i);
    expect(params).toEqual([]);
  });

  it("columns: 用 PRAGMA table_info,表名内联转义(PRAGMA 不支持参数化表名)", () => {
    const { sql, params } = buildIntrospectQuery("columns", { table: "orders" });
    expect(sql).toBe('PRAGMA table_info("orders")');
    expect(params).toEqual([]);
  });

  it("ddl: 查 sqlite_schema.sql,用绑定参数(这里是值不是标识符,可以参数化)", () => {
    const { sql, params } = buildIntrospectQuery("ddl", { table: "orders" });
    expect(sql).toMatch(/sqlite_schema/);
    expect(params).toEqual(["table", "orders"]);
  });

  it("columns/ddl 缺 table 时抛错", () => {
    expect(() => buildIntrospectQuery("columns", {})).toThrow();
    expect(() => buildIntrospectQuery("ddl", {})).toThrow();
  });
});
