import { describe, expect, it, vi } from "vitest";
vi.mock("../../../src/config/bundled-channel-config-runtime.js", () => ({
  getBundledChannelConfigSchemaMap: () => new Map(),
  getBundledChannelRuntimeMap: () => new Map(),
}));

import {
  hasJiuyanDirectOpsCommand,
  parseJiuyanExportIntent,
  parseJiuyanImportIntent,
} from "openclaw/plugin-sdk/jiuyan-direct-ops";
import { maybeHandleJiuyanFeishuDirectOps } from "./jiuyan-data-ops.js";

describe("parseJiuyanExportIntent", () => {
  it("parses months and default top scope from /生产计划 commands", () => {
    expect(parseJiuyanExportIntent("/生产计划 计算未来 5 个月需求 top 100 SKU")).toEqual({
      prefix: "/生产计划",
      months: 5,
      yesterdayTop: 100,
      fileScope: false,
    });
    expect(parseJiuyanExportIntent("/生产计划 top 50")).toEqual({
      prefix: "/生产计划",
      yesterdayTop: 50,
      fileScope: false,
    });
  });

  it("parses last-month scope from /销量计算 commands", () => {
    expect(
      parseJiuyanExportIntent("/销量计算 更新上个月 top 800 sku，未来 6 个月生产计划表"),
    ).toEqual({
      prefix: "/销量计算",
      months: 6,
      lastMonthTop: 800,
      fileScope: false,
    });
  });

  it("marks 表中 sku commands as file-scope exports", () => {
    expect(parseJiuyanExportIntent("/生产计划 更新表中 sku，未来 6 个月的生产计划表")).toEqual({
      prefix: "/生产计划",
      months: 6,
      fileScope: true,
    });
  });

  it("defaults bare /生产计划 with a referenced file to file-scope exports", () => {
    expect(parseJiuyanExportIntent("/生产计划", { defaultFileScope: true })).toEqual({
      prefix: "/生产计划",
      fileScope: true,
    });
    expect(parseJiuyanExportIntent("/公式预测", { defaultFileScope: true })).toEqual({
      prefix: "/公式预测",
      fileScope: false,
    });
  });

  it("accepts formula-prefixed export commands", () => {
    expect(parseJiuyanExportIntent("/公式计算 计算未来 5 个月需求")).toEqual({
      prefix: "/公式计算",
      months: 5,
      fileScope: false,
    });
    expect(parseJiuyanExportIntent("/公式预测销量 计算未来 5 个月销量")).toEqual({
      prefix: "/公式预测销量",
      months: 5,
      fileScope: false,
    });
  });

  it("matches longer formula export prefixes before shorter variants", () => {
    expect(parseJiuyanExportIntent("/公式预测销量 更新生产计划")).toEqual({
      prefix: "/公式预测销量",
      fileScope: false,
    });
    expect(parseJiuyanExportIntent("/公式计算销量 计算销量")).toEqual({
      prefix: "/公式计算销量",
      fileScope: false,
    });
  });

  it("treats bare export prefixes as default exports", () => {
    expect(parseJiuyanExportIntent("/生产计划")).toEqual({
      prefix: "/生产计划",
      fileScope: false,
    });
    expect(parseJiuyanExportIntent("/公式预测")).toEqual({
      prefix: "/公式预测",
      fileScope: false,
    });
  });

  it("ignores unrelated commands without Jiuyan export intent", () => {
    expect(parseJiuyanExportIntent("/生产计划 hi")).toBeNull();
    expect(parseJiuyanExportIntent("计算需求")).toBeNull();
  });

  it("parses Jiuyan import command prefixes", () => {
    expect(parseJiuyanImportIntent("/导入数据库")).toEqual({ prefix: "/导入数据库" });
    expect(parseJiuyanImportIntent("/数据库更新 导入今天文件")).toEqual({
      prefix: "/数据库更新",
    });
    expect(parseJiuyanImportIntent("/更新")).toEqual({ prefix: "/更新" });
    expect(parseJiuyanImportIntent("导入数据库")).toBeNull();
  });

  it("detects explicit Jiuyan command prefixes only", () => {
    expect(hasJiuyanDirectOpsCommand("/生产计划")).toBe(true);
    expect(hasJiuyanDirectOpsCommand("/导入数据库")).toBe(true);
    expect(hasJiuyanDirectOpsCommand("请帮我分析这个表格")).toBe(false);
    expect(hasJiuyanDirectOpsCommand("financials.xlsx")).toBe(false);
  });
});

describe("maybeHandleJiuyanFeishuDirectOps", () => {
  it("does not run direct Jiuyan handlers when command authorization denies commands", async () => {
    await expect(
      maybeHandleJiuyanFeishuDirectOps({
        cfg: {} as never,
        messageText: "/生产计划",
        chatId: "oc_test_chat",
        replyToMessageId: "om_test_msg",
        replyInThread: false,
        commandAuthorized: false,
        commandAuthorizationConfigured: true,
        mediaList: [],
      }),
    ).resolves.toBe(false);
  });

  it("does not treat unconfigured command authorization as a hard stop", async () => {
    await expect(
      maybeHandleJiuyanFeishuDirectOps({
        cfg: {} as never,
        messageText: "/更新数据",
        chatId: "oc_test_chat",
        replyToMessageId: "om_test_msg",
        replyInThread: false,
        commandAuthorized: false,
        commandAuthorizationConfigured: false,
        mediaList: [],
      }),
    ).resolves.toBe(true);
  });

  it("ignores non-command spreadsheet uploads so agent dispatch can continue", async () => {
    await expect(
      maybeHandleJiuyanFeishuDirectOps({
        cfg: {} as never,
        messageText: "Q1-sales.csv",
        chatId: "oc_test_chat",
        replyToMessageId: "om_test_msg",
        replyInThread: false,
        mediaList: [
          {
            path: "/tmp/Q1-sales.csv",
          } as never,
        ],
      }),
    ).resolves.toBe(false);
  });
});
