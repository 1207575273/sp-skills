import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { wrapForLimit, buildIntrospectQuery } from "./oracle.mjs";

describe("oracle wrapForLimit", () => {
  it("用子查询包一层并用 FETCH FIRST N ROWS ONLY(limit+1)", () => {
    expect(wrapForLimit("SELECT * FROM t", 200)).toBe(
      "SELECT * FROM (SELECT * FROM t) db_analyzer_sub FETCH FIRST 201 ROWS ONLY",
    );
  });
});

describe("oracle buildIntrospectQuery", () => {
  it("schemas: 查 ALL_TABLES 里的 DISTINCT OWNER", () => {
    const { sql, binds } = buildIntrospectQuery("schemas", {});
    expect(sql).toMatch(/ALL_TABLES/);
    expect(binds).toEqual({});
  });

  it("tables: 按 schema(OWNER)过滤,用命名绑定变量", () => {
    const { sql, binds } = buildIntrospectQuery("tables", { schema: "BIZ" });
    expect(sql).toMatch(/ALL_TABLES/);
    expect(sql).toMatch(/:schema/);
    expect(binds).toEqual({ schema: "BIZ" });
  });

  it("columns: 按 schema + table 过滤,绑定变量名不用 :table(TABLE 是 Oracle 保留字,会报 ORA-01745)", () => {
    const { sql, binds } = buildIntrospectQuery("columns", { schema: "BIZ", table: "ORDERS" });
    expect(sql).toMatch(/ALL_TAB_COLUMNS/);
    expect(sql).not.toMatch(/:table\b/i);
    expect(binds).toEqual({ schema: "BIZ", tname: "ORDERS" });
  });

  it("ddl: 用 DBMS_METADATA.GET_DDL,同样不用 :table 这个绑定变量名", () => {
    const { sql, binds } = buildIntrospectQuery("ddl", { schema: "BIZ", table: "ORDERS" });
    expect(sql).toMatch(/DBMS_METADATA\.GET_DDL/);
    expect(sql).not.toMatch(/:table\b/i);
    expect(binds).toEqual({ objectType: "TABLE", tname: "ORDERS", schema: "BIZ" });
  });

  it("缺必填参数时抛错", () => {
    expect(() => buildIntrospectQuery("tables", {})).toThrow();
    expect(() => buildIntrospectQuery("columns", { schema: "BIZ" })).toThrow();
    expect(() => buildIntrospectQuery("ddl", { schema: "BIZ" })).toThrow();
  });
});

describe("Thin 模式约束", () => {
  it("adapter 源文件的实际代码里不出现 initOracleClient 调用(否则会切到需要本地 Instant Client 的 Thick 模式)", () => {
    const src = readFileSync(fileURLToPath(new URL("./oracle.mjs", import.meta.url)), "utf8");
    // 去掉行注释再查——允许注释里提醒"不要调这个函数",但代码本身绝对不能调用它。
    const withoutLineComments = src.replace(/\/\/[^\n]*/g, "");
    expect(withoutLineComments).not.toMatch(/initOracleClient/);
  });
});
