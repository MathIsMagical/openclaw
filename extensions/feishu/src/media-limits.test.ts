import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEISHU_MEDIA_MAX_MB,
  JIUYAN_DIRECT_OPS_MEDIA_MIN_MB,
  resolveInboundFeishuMediaMaxMb,
} from "./media-limits.js";

describe("resolveInboundFeishuMediaMaxMb", () => {
  it("keeps the configured limit for non-Jiuyan messages", () => {
    expect(
      resolveInboundFeishuMediaMaxMb({
        messageText: "普通聊天消息",
        configuredMaxMb: 45,
      }),
    ).toBe(45);
  });

  it("raises Jiuyan direct-ops downloads to at least 100MB", () => {
    expect(
      resolveInboundFeishuMediaMaxMb({
        messageText: "/更新数据",
        configuredMaxMb: DEFAULT_FEISHU_MEDIA_MAX_MB,
      }),
    ).toBe(JIUYAN_DIRECT_OPS_MEDIA_MIN_MB);
  });

  it("preserves larger explicit limits for Jiuyan direct-ops downloads", () => {
    expect(
      resolveInboundFeishuMediaMaxMb({
        messageText: "/AI生产计划",
        configuredMaxMb: 160,
      }),
    ).toBe(160);
  });
});
