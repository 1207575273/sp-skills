import { describe, it, expect } from "vitest";
import { wrapForLimit, buildIntrospectQuery } from "./mysql.mjs";

describe("mysql wrapForLimit", () => {
  it("用子查询包一层并把 limit+1 作为 LIMIT,用于判断是否截断", () => {
    expect(wrapForLimit("SELECT * FROM t", 200)).toBe(
      "SELECT * FROM (SELECT * FROM t) AS db_analyzer_sub LIMIT 201",
    );
  });
});

describe("mysql buildIntrospectQuery", () => {
  it("schemas: 查 information_schema.SCHEMATA", () => {
    const { sql, params } = buildIntrospectQuery("schemas", {});
    expect(sql).toMatch(/information_schema\.SCHEMATA/i);
    expect(params).toEqual([]);
  });

  it("tables: 按 schema 过滤", () => {
    const { sql, params } = buildIntrospectQuery("tables", { schema: "biz" });
    expect(sql).toMatch(/information_schema\.TABLES/i);
    expect(params).toEqual(["biz"]);
  });

  it("columns: 按 schema + table 过滤", () => {
    const { sql, params } = buildIntrospectQuery("columns", { schema: "biz", table: "orders" });
    expect(sql).toMatch(/information_schema\.COLUMNS/i);
    expect(params).toEqual(["biz", "orders"]);
  });

  it("ddl: 用 SHOW CREATE TABLE,反引号转义表名里的反引号", () => {
    const { sql, params } = buildIntrospectQuery("ddl", { table: "weird`name" });
    expect(sql).toBe("SHOW CREATE TABLE `weird``name`");
    expect(params).toEqual([]);
  });

  it("缺必填参数时抛错而不是拼出坏 SQL", () => {
    expect(() => buildIntrospectQuery("tables", {})).toThrow();
    expect(() => buildIntrospectQuery("columns", { schema: "biz" })).toThrow();
    expect(() => buildIntrospectQuery("ddl", {})).toThrow();
  });
});
