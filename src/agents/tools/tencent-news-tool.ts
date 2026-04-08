import { Type } from "@sinclair/typebox";
import { runExec } from "../../process/exec.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";

const TencentNewsToolSchema = Type.Object({
  command: Type.String({
    description: "Command to run: 'help', 'evening', 'hot', 'morning', or 'search'.",
  }),
  query: Type.Optional(
    Type.String({ description: "Optional query string if the command is 'search'." }),
  ),
});

const TENCENT_NEWS_HELP_TEXT = [
  "**Tencent News Skill Help**",
  "",
  "Commands:",
  "- `morning`: Fetch the Daily Morning News.",
  "- `evening`: Fetch the Daily Evening News.",
  "- `hot`: Fetch the latest hot rankings.",
  "- `search <topic>`: Search for a specific topic.",
  "",
  "If direct CLI execution fails in a service environment, set `tools.tencentNews.binaryPath` to the absolute `tencent-news-cli` path.",
].join("\n");

function parseDispatchedTencentNewsArgs(
  params: Record<string, unknown>,
): { command: string; query?: string } {
  const raw = readStringParam(params, "command", { required: true }) ?? "";
  const explicitQuery = readStringParam(params, "query");
  const commandName = readStringParam(params, "commandName");
  const trimmed = raw.trim();

  // Slash-command dispatch sends the raw argument string in `command`; parse it
  // here so `/tencent-news search NBA` stays on the dedicated tool path.
  if (commandName && commandName.trim()) {
    const [first = "", ...rest] = trimmed.split(/\s+/).filter(Boolean);
    const command = first.toLowerCase() || "help";
    const query = explicitQuery ?? (rest.length > 0 ? rest.join(" ") : undefined);
    return { command, query };
  }

  return { command: trimmed.toLowerCase(), query: explicitQuery };
}

export function createTencentNewsTool(config?: { binaryPath?: string }): AnyAgentTool {
  const binary = config?.binaryPath || "tencent-news-cli";
  return {
    label: "Tencent News",
    name: "tencent_news",
    displaySummary: "Retrieve news using tencent-news-cli",
    description: "Fetch Tencent news (morning, evening, hot, search) via the CLI tool.",
    parameters: TencentNewsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const { command, query } = parseDispatchedTencentNewsArgs(params);

      if (command === "help") {
        return {
          content: [{ type: "text", text: TENCENT_NEWS_HELP_TEXT }],
          details: { error: null },
        };
      }

      const cliArgs = [command];
      if (command === "search" && query) {
        cliArgs.push(query);
      }

      try {
        const { stdout, stderr } = await runExec(binary, cliArgs, {
          timeoutMs: 15_000,
        });

        const output = stdout.trim() || stderr.trim() || "Success (no output)";
        return {
          content: [{ type: "text", text: output }],
          details: { error: stderr || null },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error running ${binary}: ${(err as Error).message}` }],
          details: { error: (err as Error).message },
        };
      }
    },
  };
}
