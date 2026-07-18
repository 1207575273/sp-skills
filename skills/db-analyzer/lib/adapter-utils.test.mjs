import { describe, it, expect } from "vitest";
import { wrapForLimit, shapeRowset } from "./adapter-utils.mjs";

describe("wrapForLimit", () => {
  it("用子查询包一层并把 limit+1 作为 LIMIT", () => {
    expect(wrapForLimit("SELECT * FROM t", 200)).toBe(
      "SELECT * FROM (SELECT * FROM t) AS db_analyzer_sub LIMIT 201",
    );
  });
});

describe("shapeRowset", () => {
  it("行数不超过 limit 时不截断", () => {
    const result = shapeRowset({
      isRowset: true,
      limit: 200,
      columns: ["id", "name"],
      rawRows: [{ id: 1, name: "a" }],
    });
    expect(result).toEqual({ kind: "table", columns: ["id", "name"], rows: [[1, "a"]], truncated: false });
  });

  it("行数超过 limit 时截断到 limit 条", () => {
    const rawRows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = shapeRowset({ isRowset: true, limit: 2, columns: ["id"], rawRows });
    expect(result.truncated).toBe(true);
    expect(result.rows).toEqual([[1], [2]]);
  });

  it("isRowset 为 false 时(EXPLAIN/SHOW 等)即便超过 limit 也不标记截断", () => {
    const rawRows = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const result = shapeRowset({ isRowset: false, limit: 2, columns: ["x"], rawRows });
    expect(result.truncated).toBe(false);
    expect(result.rows).toEqual([[1], [2], [3]]);
  });
});
