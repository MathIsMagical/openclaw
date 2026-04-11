import { describe, expect, it } from "vitest";
import { resolveVisibleSessionsYieldReply } from "./attempt.sessions-yield.js";

describe("resolveVisibleSessionsYieldReply", () => {
  it("extracts explicit final content from sessions_yield messages", () => {
    expect(
      resolveVisibleSessionsYieldReply(
        '<think>internal notes</think><final>为您播报最新的 NBA 新闻。</final>',
      ),
    ).toBe("为您播报最新的 NBA 新闻。");
  });

  it("drops reply directives before delivering visible yield replies", () => {
    expect(
      resolveVisibleSessionsYieldReply(
        "<final>[[reply_to_current]]我已生成深度销售数据分析。</final>",
      ),
    ).toBe("我已生成深度销售数据分析。");
  });

  it("does not surface ordinary yield status messages", () => {
    expect(resolveVisibleSessionsYieldReply("Turn yielded.")).toBeUndefined();
  });
});
