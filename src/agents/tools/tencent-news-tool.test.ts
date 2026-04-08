import { describe, expect, it, vi } from "vitest";

const runExecMock = vi.fn();

vi.mock("../../process/exec.js", () => ({
  runExec: (...args: unknown[]) => runExecMock(...args),
}));

describe("createTencentNewsTool", () => {
  it("returns help text for slash-command help without shelling out", async () => {
    const { createTencentNewsTool } = await import("./tencent-news-tool.js");
    const tool = createTencentNewsTool();

    const result = await tool.execute?.("call_1", {
      command: "help",
      commandName: "tencent_news",
      skillName: "tencent-news",
    });

    expect(runExecMock).not.toHaveBeenCalled();
    expect(result?.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Tencent News Skill Help"),
      }),
    ]);
  });

  it("parses raw slash-command search args onto the dedicated tool path", async () => {
    runExecMock.mockResolvedValueOnce({ stdout: "search results", stderr: "" });
    const { createTencentNewsTool } = await import("./tencent-news-tool.js");
    const tool = createTencentNewsTool({
      binaryPath: "/custom/tencent-news-cli",
    });

    const result = await tool.execute?.("call_2", {
      command: "search NBA playoffs",
      commandName: "tencent_news",
      skillName: "tencent-news",
    });

    expect(runExecMock).toHaveBeenCalledWith("/custom/tencent-news-cli", ["search", "NBA playoffs"], {
      timeoutMs: 15_000,
    });
    expect(result?.content).toEqual([
      {
        type: "text",
        text: "search results",
      },
    ]);
  });
});
