import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../src/config/bundled-channel-config-runtime.js", () => ({
  getBundledChannelConfigSchemaMap: () => new Map(),
  getBundledChannelRuntimeMap: () => new Map(),
}));
vi.mock("./jiuyan-direct-ops-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jiuyan-direct-ops-runtime.js")>();
  return {
    ...actual,
    executeJiuyanDirectImport: vi.fn(async (params: { inputPaths: readonly string[] }) => ({
      kind: "import" as const,
      outcome: params.inputPaths.length > 0 ? ("success" as const) : ("needs_input" as const),
      message:
        params.inputPaths.length > 0
          ? "销售数据更新成功！"
          : "未找到可用于数据库导入的 Excel、CSV 或 ZIP 文件，请附上或引用文件后再试。",
    })),
  };
});
vi.mock("./send.js", () => ({
  sendMessageFeishu: vi.fn(async () => ({ messageId: "om_test_reply", chatId: "oc_test_chat" })),
}));
vi.mock("./media.js", () => ({
  sendMediaFeishu: vi.fn(async () => ({ messageId: "om_test_media", chatId: "oc_test_chat" })),
}));

import {
  hasJiuyanDirectOpsCommand,
  parseJiuyanExportIntent,
  parseJiuyanImportIntent,
} from "openclaw/plugin-sdk/jiuyan-direct-ops";
import { maybeHandleJiuyanFeishuDirectOps } from "./jiuyan-data-ops.js";
import { sendMessageFeishu } from "./send.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseJiuyanExportIntent", () => {
  it("parses months and default top scope from /生产计划 commands", () => {
    expect(parseJiuyanExportIntent("/生产计划 计算未来 5 个月需求 top 100 SKU")).toEqual({
      prefix: "/生产计划",
      months: 5,
      yesterdayTop: 100,
      fileScope: false,
    });
    expect(parseJiuyanExportIntent("/AI生产计划 计算未来 5 个月需求 top 100 SKU")).toEqual({
      prefix: "/AI生产计划",
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
    expect(parseJiuyanExportIntent("/AI生产计划", { defaultFileScope: true })).toEqual({
      prefix: "/AI生产计划",
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
    expect(parseJiuyanExportIntent("/AI生产计划")).toEqual({
      prefix: "/AI生产计划",
      fileScope: false,
    });
    expect(parseJiuyanExportIntent("/AI 生产计划")).toEqual({
      prefix: "/AI生产计划",
      fileScope: false,
    });
    expect(parseJiuyanExportIntent("/ai 生产计划")).toEqual({
      prefix: "/AI生产计划",
      fileScope: false,
    });
    expect(parseJiuyanExportIntent("/公式预测")).toEqual({
      prefix: "/公式预测",
      fileScope: false,
    });
  });

  it("ignores unrelated commands without Jiuyan export intent", () => {
    expect(parseJiuyanExportIntent("/生产计划 hi")).toBeNull();
    expect(parseJiuyanExportIntent("/AI生产计划 hi")).toBeNull();
    expect(parseJiuyanExportIntent("/AI 生产计划 hi")).toBeNull();
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
    expect(hasJiuyanDirectOpsCommand("/AI生产计划")).toBe(true);
    expect(hasJiuyanDirectOpsCommand("/AI 生产计划")).toBe(true);
    expect(hasJiuyanDirectOpsCommand("/ai生产计划")).toBe(true);
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

  it("sends an immediate import start message when input files are present", async () => {
    await expect(
      maybeHandleJiuyanFeishuDirectOps({
        cfg: {} as never,
        messageText: "/更新数据",
        chatId: "oc_test_chat",
        replyToMessageId: "om_test_msg",
        replyInThread: false,
        mediaList: [{ path: "/tmp/Q1-sales.csv" } as never],
      }),
    ).resolves.toBe(true);

    const messages = vi.mocked(sendMessageFeishu).mock.calls.map((call) => call[0]?.text);
    expect(messages).toEqual([
      "文件已收到，正在准备导入数据，导入完成后会提醒你。",
      "销售数据更新成功！",
    ]);
  });

  it("does not send the optimistic import start message when no input files exist", async () => {
    await expect(
      maybeHandleJiuyanFeishuDirectOps({
        cfg: {} as never,
        messageText: "/更新数据",
        chatId: "oc_test_chat",
        replyToMessageId: "om_test_msg",
        replyInThread: false,
        mediaList: [],
      }),
    ).resolves.toBe(true);

    const messages = vi.mocked(sendMessageFeishu).mock.calls.map((call) => call[0]?.text);
    expect(messages).toEqual([
      "未找到可用于数据库导入的 Excel、CSV 或 ZIP 文件，请附上或引用文件后再试。",
    ]);
  });
});
