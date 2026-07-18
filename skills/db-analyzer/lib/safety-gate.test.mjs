import { describe, it, expect } from "vitest";
import { validateReadOnlySql, isRowsetStatement } from "./safety-gate.mjs";

describe("validateReadOnlySql", () => {
  it("放行普通 SELECT", () => {
    expect(validateReadOnlySql("SELECT * FROM t WHERE id = 1")).toEqual({ ok: true });
  });

  it("放行 WITH(CTE)只读查询", () => {
    expect(
      validateReadOnlySql("WITH a AS (SELECT id FROM t) SELECT * FROM a"),
    ).toEqual({ ok: true });
  });

  it("放行 EXPLAIN/SHOW/DESCRIBE", () => {
    expect(validateReadOnlySql("EXPLAIN SELECT * FROM t")).toEqual({ ok: true });
    expect(validateReadOnlySql("SHOW CREATE TABLE t")).toEqual({ ok: true });
    expect(validateReadOnlySql("DESCRIBE t")).toEqual({ ok: true });
    expect(validateReadOnlySql("DESC t")).toEqual({ ok: true });
  });

  it("不区分大小写、允许前导空白", () => {
    expect(validateReadOnlySql("  select 1")).toEqual({ ok: true });
  });

  it("允许一个可选的结尾分号", () => {
    expect(validateReadOnlySql("SELECT 1;")).toEqual({ ok: true });
  });

  it("拒绝空 SQL", () => {
    expect(validateReadOnlySql("").ok).toBe(false);
    expect(validateReadOnlySql("   ").ok).toBe(false);
  });

  it("拒绝分号分隔的多条语句", () => {
    const r = validateReadOnlySql("SELECT 1; DROP TABLE t;");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/多条语句/);
  });

  it("不把注释里的分号误判成多语句(注释本身对数据库也是惰性的)", () => {
    expect(validateReadOnlySql("SELECT 1; -- DROP TABLE x").ok).toBe(true);
    expect(validateReadOnlySql("SELECT 1 /* ; DROP TABLE x */").ok).toBe(true);
  });

  it("拒绝非只读开头的语句", () => {
    expect(validateReadOnlySql("INSERT INTO t VALUES (1)").ok).toBe(false);
    expect(validateReadOnlySql("UPDATE t SET x = 1").ok).toBe(false);
    expect(validateReadOnlySql("DELETE FROM t").ok).toBe(false);
    expect(validateReadOnlySql("DROP TABLE t").ok).toBe(false);
    expect(validateReadOnlySql("CREATE TABLE t (id INT)").ok).toBe(false);
    expect(validateReadOnlySql("ALTER TABLE t ADD COLUMN x INT").ok).toBe(false);
    expect(validateReadOnlySql("TRUNCATE TABLE t").ok).toBe(false);
    expect(validateReadOnlySql("GRANT SELECT ON t TO u").ok).toBe(false);
  });

  it("拒绝把写操作藏进 CTE 里(WITH 开头但内部有 DELETE)", () => {
    const r = validateReadOnlySql(
      "WITH t AS (DELETE FROM x RETURNING *) SELECT * FROM t",
    );
    expect(r.ok).toBe(false);
  });

  it("拒绝用户 SQL 里出现 SET/COMMIT/ROLLBACK 等会话与事务控制语句", () => {
    expect(validateReadOnlySql("SET SESSION TRANSACTION READ ONLY").ok).toBe(false);
    expect(validateReadOnlySql("COMMIT").ok).toBe(false);
  });

  it("不误伤名字里带 update/create 等词的普通列(单词边界判断)", () => {
    expect(
      validateReadOnlySql("SELECT update_time, create_by FROM t").ok,
    ).toBe(true);
  });

  it("拒绝字符串里包含分号但结构上仍是单语句的情况要放行(不误伤)", () => {
    expect(validateReadOnlySql("SELECT * FROM t WHERE name = 'a;b'").ok).toBe(true);
  });
});

describe("isRowsetStatement", () => {
  it("SELECT/WITH 是可包 LIMIT 的行集语句", () => {
    expect(isRowsetStatement("SELECT * FROM t")).toBe(true);
    expect(isRowsetStatement("WITH a AS (SELECT 1) SELECT * FROM a")).toBe(true);
  });

  it("EXPLAIN/SHOW/DESCRIBE 不是", () => {
    expect(isRowsetStatement("EXPLAIN SELECT * FROM t")).toBe(false);
    expect(isRowsetStatement("SHOW CREATE TABLE t")).toBe(false);
    expect(isRowsetStatement("DESCRIBE t")).toBe(false);
  });
});
