import { describe, it, expect } from "vitest";
import { wrapForLimit, buildIntrospectQuery, formatDdlFromRows } from "./postgres.mjs";

describe("postgres wrapForLimit", () => {
  it("用子查询包一层并把 limit+1 作为 LIMIT", () => {
    expect(wrapForLimit("SELECT * FROM t", 200)).toBe(
      "SELECT * FROM (SELECT * FROM t) AS db_analyzer_sub LIMIT 201",
    );
  });
});

describe("postgres buildIntrospectQuery", () => {
  it("schemas: 查 information_schema.schemata", () => {
    const { sql, params } = buildIntrospectQuery("schemas", {});
    expect(sql).toMatch(/information_schema\.schemata/i);
    expect(params).toEqual([]);
  });

  it("tables: schema 缺省为 public", () => {
    const { sql, params } = buildIntrospectQuery("tables", {});
    expect(sql).toMatch(/information_schema\.tables/i);
    expect(params).toEqual(["public"]);
  });

  it("tables: 显式传 schema 时用传入值", () => {
    const { params } = buildIntrospectQuery("tables", { schema: "biz" });
    expect(params).toEqual(["biz"]);
  });

  it("columns: 需要 table,schema 缺省 public", () => {
    const { sql, params } = buildIntrospectQuery("columns", { table: "orders" });
    expect(sql).toMatch(/information_schema\.columns/i);
    expect(params).toEqual(["public", "orders"]);
  });

  it("ddl: 返回三条独立查询(columns/indexes/constraints)供拼装", () => {
    const q = buildIntrospectQuery("ddl", { table: "orders" });
    expect(q.columnsQuery.params).toEqual(["public", "orders"]);
    expect(q.indexesQuery.params).toEqual(["public", "orders"]);
    expect(q.constraintsQuery.params).toEqual(["public", "orders"]);
  });

  it("缺必填参数时抛错", () => {
    expect(() => buildIntrospectQuery("columns", {})).toThrow();
    expect(() => buildIntrospectQuery("ddl", {})).toThrow();
  });
});

describe("postgres formatDdlFromRows", () => {
  it("拼出可读的建表还原文本,包含列/索引/约束", () => {
    const text = formatDdlFromRows({
      schema: "public",
      table: "orders",
      columns: [
        { column_name: "id", data_type: "integer", is_nullable: "NO", column_default: null },
        { column_name: "name", data_type: "character varying", is_nullable: "YES", column_default: null },
      ],
      indexes: [{ indexdef: "CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)" }],
      constraints: [{ conname: "orders_pkey", definition: "PRIMARY KEY (id)" }],
    });
    expect(text).toContain("public.orders");
    expect(text).toContain("id integer NOT NULL");
    expect(text).toContain("name character varying");
    expect(text).toContain("orders_pkey");
    expect(text).toContain("PRIMARY KEY (id)");
    expect(text).toContain("尽力还原");
  });
});
