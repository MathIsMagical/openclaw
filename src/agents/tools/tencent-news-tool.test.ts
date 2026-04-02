import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveTencentNewsCommand, resolveTencentNewsSkillDir } from "./tencent-news-tool.js";

describe("resolveTencentNewsCommand", () => {
  it("defaults empty input to hot", () => {
    expect(resolveTencentNewsCommand("")).toEqual({ argv: ["hot"] });
  });

  it("maps simple subcommands directly", () => {
    expect(resolveTencentNewsCommand("hot")).toEqual({ argv: ["hot"] });
    expect(resolveTencentNewsCommand("morning")).toEqual({ argv: ["morning"] });
    expect(resolveTencentNewsCommand("evening")).toEqual({ argv: ["evening"] });
  });

  it("maps ai-daily with an optional query", () => {
    expect(resolveTencentNewsCommand("ai-daily")).toEqual({ argv: ["ai-daily"] });
    expect(resolveTencentNewsCommand("ai-daily 微信更新")).toEqual({
      argv: ["ai-daily", "--query", "微信更新"],
    });
  });

  it("rejects unsupported subcommands", () => {
    expect(() => resolveTencentNewsCommand("latest")).toThrow(
      /Unsupported \/tencent-news subcommand/,
    );
  });
});

describe("resolveTencentNewsSkillDir", () => {
  it("resolves the skill directory from the OpenClaw package root", () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/Users/andychan/Documents/openclaw");
    try {
      expect(resolveTencentNewsSkillDir()).toBe(
        path.join("/Users/andychan/Documents/openclaw", "skills", "tencent-news"),
      );
    } finally {
      cwdSpy.mockRestore();
    }
  });
});
