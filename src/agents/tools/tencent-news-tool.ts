import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import { resolveOpenClawPackageRootSync } from "../../infra/openclaw-root.js";
import type { AnyAgentTool } from "./common.js";
import { failedTextResult, readStringParam, textResult } from "./common.js";

const TencentNewsToolSchema = Type.Object({
  command: Type.Optional(
    Type.String({
      description:
        "Raw /tencent-news arguments, for example 'hot', 'morning', 'evening', or 'ai-daily 微信更新'",
    }),
  ),
  commandName: Type.Optional(Type.String()),
  skillName: Type.Optional(Type.String()),
});

const API_KEY_ENV = "TENCENT_NEWS_APIKEY";
export function resolveTencentNewsSkillDir(): string {
  const packageRoot =
    resolveOpenClawPackageRootSync({
      cwd: process.cwd(),
      moduleUrl: import.meta.url,
    }) ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
  return path.join(packageRoot, "skills", "tencent-news");
}

const SKILL_DIR = resolveTencentNewsSkillDir();
const CLI_PATH = path.join(
  SKILL_DIR,
  process.platform === "win32" ? "tencent-news-cli.exe" : "tencent-news-cli",
);
const CONFIG_PATH = path.join(os.homedir(), ".config", "tencent-news-cli", "config.json");

type TencentNewsResolvedCommand =
  | { argv: ["help"] }
  | { argv: ["hot"] }
  | { argv: ["morning"] }
  | { argv: ["evening"] }
  | { argv: ["ai-daily"] }
  | { argv: ["ai-daily", "--query", string] };

function normalizeTopic(raw: string): string {
  return raw.replace(/^["']|["']$/g, "").trim();
}

export function resolveTencentNewsCommand(rawCommand: string): TencentNewsResolvedCommand {
  const trimmed = rawCommand.trim();
  if (!trimmed) {
    return { argv: ["hot"] };
  }

  const [head, ...rest] = trimmed.split(/\s+/);
  const subcommand = head.trim().toLowerCase();
  const remainder = normalizeTopic(rest.join(" "));

  switch (subcommand) {
    case "help":
      return { argv: ["help"] };
    case "hot":
      return { argv: ["hot"] };
    case "morning":
      return { argv: ["morning"] };
    case "evening":
      return { argv: ["evening"] };
    case "ai-daily":
      return remainder ? { argv: ["ai-daily", "--query", remainder] } : { argv: ["ai-daily"] };
    default:
      throw new Error(
        `Unsupported /tencent-news subcommand "${subcommand}". Use help, hot, morning, evening, or ai-daily [topic].`,
      );
  }
}

async function readConfiguredApiKey(): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[API_KEY_ENV];
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export async function buildTencentNewsEnv(baseEnv: NodeJS.ProcessEnv = process.env) {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const configuredApiKey = await readConfiguredApiKey();
  if (configuredApiKey) {
    // Prefer the persisted config file so stale launchd env does not break the CLI.
    env[API_KEY_ENV] = configuredApiKey;
  }
  return env;
}

async function runTencentNewsCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(CLI_PATH, argv, {
      cwd: SKILL_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export function createTencentNewsTool(): AnyAgentTool {
  return {
    name: "tencent_news",
    label: "Tencent News",
    description:
      "Run the bundled Tencent News CLI deterministically for /tencent-news commands (help, hot, morning, evening, ai-daily).",
    parameters: TencentNewsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const rawCommand = readStringParam(params, "command", { allowEmpty: true }) ?? "";
      const resolved = resolveTencentNewsCommand(rawCommand);

      try {
        await fs.access(CLI_PATH);
      } catch {
        return failedTextResult(`❌ 未找到 tencent-news-cli：${CLI_PATH}`, {
          status: "failed" as const,
          exitCode: 127,
          cwd: SKILL_DIR,
          command: CLI_PATH,
        });
      }

      const env = await buildTencentNewsEnv();
      const result = await runTencentNewsCli([...resolved.argv], env);
      const output = result.stdout || result.stderr || "(no output)";
      if (result.exitCode !== 0) {
        return failedTextResult(output, {
          status: "failed" as const,
          exitCode: result.exitCode,
          cwd: SKILL_DIR,
          command: `${CLI_PATH} ${resolved.argv.join(" ")}`.trim(),
        });
      }
      return textResult(output, {
        status: "completed" as const,
        exitCode: result.exitCode,
        cwd: SKILL_DIR,
        command: `${CLI_PATH} ${resolved.argv.join(" ")}`.trim(),
      });
    },
  };
}
