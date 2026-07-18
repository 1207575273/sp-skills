import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  parseArgs,
  loadConfig,
  resolveConfigPath,
  pickAdapter,
  formatTable,
  wrapConnectionError,
  wrapQueryError,
  wrapIntrospectError,
} from "./run-query.mjs";
import * as mysqlAdapter from "../lib/adapters/mysql.mjs";
import * as postgresAdapter from "../lib/adapters/postgres.mjs";
import * as oracleAdapter from "../lib/adapters/oracle.mjs";

describe("parseArgs", () => {
  it("解析 --key value 和布尔 flag", () => {
    const args = parseArgs(["--env", "mkdev01-mysql", "--sql", "SELECT 1", "--list-envs"]);
    expect(args.env).toBe("mkdev01-mysql");
    expect(args.sql).toBe("SELECT 1");
    expect(args["list-envs"]).toBe(true);
  });
});

describe("loadConfig", () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("读 yaml 拿到各 env 的字段(含 type)", () => {
    dir = mkdtempSync(join(tmpdir(), "db-analyzer-test-"));
    const configPath = join(dir, "environments.yaml");
    writeFileSync(
      configPath,
      [
        "mkdev01-mysql:",
        "  type: mysql",
        "  host: 127.0.0.1",
        "  port: 3306",
        "  database: biz",
        "  user: reader",
        "  password: secret",
        "",
      ].join("\n"),
      "utf8",
    );
    const config = loadConfig(configPath);
    expect(config["mkdev01-mysql"]).toEqual({
      type: "mysql",
      host: "127.0.0.1",
      port: "3306",
      database: "biz",
      user: "reader",
      password: "secret",
    });
  });
});

describe("resolveConfigPath", () => {
  it("--config 优先级最高", () => {
    expect(resolveConfigPath({ config: "/a/b.yaml" }, { DB_ANALYZER_CONFIG: "/env/c.yaml" })).toBe("/a/b.yaml");
  });

  it("没有 --config 时用 DB_ANALYZER_CONFIG 环境变量", () => {
    expect(resolveConfigPath({}, { DB_ANALYZER_CONFIG: "/env/c.yaml" })).toBe("/env/c.yaml");
  });

  it("两者都没有时回退到脚本旁边的默认 config 路径", () => {
    const p = resolveConfigPath({}, {});
    expect(p).toMatch(/environments\.yaml$/);
  });
});

describe("pickAdapter", () => {
  it("按 type 分发到对应适配器模块", () => {
    expect(pickAdapter("mysql")).toBe(mysqlAdapter);
    expect(pickAdapter("postgres")).toBe(postgresAdapter);
    expect(pickAdapter("oracle")).toBe(oracleAdapter);
  });

  it("未知 type 抛错", () => {
    expect(() => pickAdapter("mssql")).toThrow();
  });
});

describe("formatTable", () => {
  it("把 columns/rows 渲染成对齐的文本表格", () => {
    const text = formatTable({ columns: ["id", "name"], rows: [[1, "a"], [2, "bb"]] });
    expect(text).toContain("id");
    expect(text).toContain("name");
    expect(text).toContain("1");
    expect(text).toContain("bb");
  });

  it("空结果给出明确提示而不是空字符串", () => {
    const text = formatTable({ columns: ["id"], rows: [] });
    expect(text).toMatch(/0 行|无结果/);
  });
});

describe("wrapConnectionError", () => {
  it("包一层提示核对 config 凭证,同时保留原始错误信息", () => {
    const wrapped = wrapConnectionError(new Error("ECONNREFUSED"), "mkdev01-mysql");
    expect(wrapped.message).toMatch(/连接失败/);
    expect(wrapped.message).toMatch(/mkdev01-mysql/);
    expect(wrapped.message).toMatch(/ECONNREFUSED/);
  });
});

describe("wrapQueryError", () => {
  it("包一层提示可调 --timeout,同时保留原始错误信息", () => {
    const wrapped = wrapQueryError(new Error("Query read timeout"), 30000);
    expect(wrapped.message).toMatch(/--timeout/);
    expect(wrapped.message).toMatch(/30000/);
    expect(wrapped.message).toMatch(/Query read timeout/);
  });
});

describe("wrapIntrospectError", () => {
  it("包一层提示检查 schema/table 名或权限,同时保留原始错误信息", () => {
    const wrapped = wrapIntrospectError(new Error("ORA-00942: table or view does not exist"), "mkdev01-oracle", {
      schema: "BIZ",
      table: "ORDERS",
    });
    expect(wrapped.message).toMatch(/schema.*table/);
    expect(wrapped.message).toMatch(/BIZ/);
    expect(wrapped.message).toMatch(/ORDERS/);
    expect(wrapped.message).toMatch(/ORA-00942/);
  });
});
