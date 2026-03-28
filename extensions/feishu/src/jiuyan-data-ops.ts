import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ClawdbotConfig } from "../runtime-api.js";
import {
  parseJiuyanExportIntent,
  parseJiuyanImportIntent,
  type JiuyanExportIntent,
  type JiuyanImportIntent,
} from "./jiuyan-data-ops-intent.js";
import { sendMediaFeishu } from "./media.js";
import { sendMessageFeishu } from "./send.js";
import type { FeishuMediaInfo } from "./types.js";

const JIUYAN_ROOT = "/Users/andychan/Documents/jiuyan";
const JIUYAN_UTILS_DIR = path.join(JIUYAN_ROOT, "utils");
const JIUYAN_EXPORTS_DIR = path.join(JIUYAN_ROOT, "exports");
const JIUYAN_SCOPE_INPUT_DIR = path.join(JIUYAN_EXPORTS_DIR, "_scope_inputs");
const JIUYAN_UPLOAD_DIR = path.join(JIUYAN_ROOT, "upload");
const JIUYAN_VENV_PYTHON = path.join(
  JIUYAN_ROOT,
  "sales_filtered_database",
  ".venv",
  "bin",
  "python",
);
const CLEAR_FOLDERS_SCRIPT = path.join(JIUYAN_UTILS_DIR, "clear_folders.py");
const SELECT_EXPORT_SKUS_SCRIPT = path.join(JIUYAN_UTILS_DIR, "select_export_skus.py");
const EXPORT_FORECAST_SCRIPT = path.join(JIUYAN_UTILS_DIR, "export_forecast.py");
const IMPORT_SALES_SCRIPT = path.join(JIUYAN_UTILS_DIR, "import_sales.py");
const IMPORT_SKUS_SCRIPT = path.join(JIUYAN_UTILS_DIR, "import_skus.py");

type ShellCommandResult = {
  stdout: string;
  stderr: string;
  combined: string;
};

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildJiuyanPythonCommand(args: readonly string[]): string {
  return [JIUYAN_VENV_PYTHON, ...args].map(shellEscape).join(" ");
}

async function runShellCommand(command: string): Promise<ShellCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("/bin/zsh", ["-lc", command], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, combined: `${stdout}${stderr}`.trim() });
        return;
      }
      const err = new Error(`${command}\n${`${stdout}${stderr}`.trim()}`.trim());
      reject(err);
    });
  });
}

function isScopeInputFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".xlsx" || ext === ".xls" || ext === ".csv";
}

function isImportInputFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".xlsx" || ext === ".xls" || ext === ".csv" || ext === ".zip";
}

function resolveExportWorkbookPath(output: string): string | null {
  const match = output.match(/(\/[^\s]+\.xlsx)/);
  return match?.[1] ?? null;
}

async function clearScopeInputDir() {
  await fs.rm(JIUYAN_SCOPE_INPUT_DIR, { recursive: true, force: true });
  await fs.mkdir(JIUYAN_SCOPE_INPUT_DIR, { recursive: true });
}

async function clearUploadDir() {
  await runShellCommand(buildJiuyanPythonCommand([CLEAR_FOLDERS_SCRIPT, "--upload"]));
  await fs.mkdir(JIUYAN_UPLOAD_DIR, { recursive: true });
}

async function extractZipToUpload(zipPath: string) {
  await runShellCommand(
    `/usr/bin/ditto -x -k ${shellEscape(zipPath)} ${shellEscape(JIUYAN_UPLOAD_DIR)}`,
  );
}

async function stageImportInputFiles(mediaList: readonly FeishuMediaInfo[]): Promise<string[]> {
  await clearUploadDir();
  const stagedPaths: string[] = [];
  for (const media of mediaList) {
    if (!isImportInputFile(media.path)) {
      continue;
    }
    const destination = path.join(JIUYAN_UPLOAD_DIR, path.basename(media.path));
    await fs.copyFile(media.path, destination);
    stagedPaths.push(destination);
    if (path.extname(destination).toLowerCase() === ".zip") {
      await extractZipToUpload(destination);
    }
  }
  return stagedPaths;
}

function importOutputLooksSuccessful(output: string, kind: "sales" | "skus"): boolean {
  return kind === "sales"
    ? output.includes("销售数据导入统计") || output.includes("数据库总览")
    : output.includes("SKU 档案导入统计");
}

function summarizeImportOutput(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        (/^[\-•]/.test(line) ||
          line.startsWith("📊") ||
          line.startsWith("🏠") ||
          line.startsWith("📦") ||
          line.startsWith("✨") ||
          line.startsWith("⚠️") ||
          line.startsWith("❌") ||
          line.startsWith("处理总行数") ||
          line.startsWith("文件解析总行数") ||
          line.startsWith("实际新增记录") ||
          line.startsWith("覆盖更新记录") ||
          line.startsWith("新增商品数") ||
          line.startsWith("已有商品更新")),
    );
}

function buildImportFailureSummary(outputs: readonly string[]): string {
  const hints = outputs
    .flatMap((output) =>
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("❌") || line.startsWith("⚠️")),
    )
    .slice(0, 4);
  return hints.length > 0
    ? `文件不合法，无法导入 Jiuyan 数据库。\n${hints.join("\n")}`
    : "文件不合法，无法导入 Jiuyan 数据库。";
}

async function maybeHandleJiuyanFeishuDirectImport(params: {
  cfg: ClawdbotConfig;
  accountId?: string;
  messageText: string;
  chatId: string;
  replyToMessageId: string;
  replyInThread: boolean;
  mediaList: readonly FeishuMediaInfo[];
  quotedMediaList?: readonly FeishuMediaInfo[];
  log?: (message: string) => void;
}): Promise<boolean> {
  const intent = parseJiuyanImportIntent(params.messageText);
  if (!intent) {
    return false;
  }

  params.log?.(`feishu[${params.accountId ?? "default"}]: handling Jiuyan import directly`);

  const importSourceMedia = [...params.mediaList, ...(params.quotedMediaList ?? [])];
  const stagedFiles = await stageImportInputFiles(importSourceMedia);
  if (stagedFiles.length === 0) {
    await sendMessageFeishu({
      cfg: params.cfg,
      to: `chat:${params.chatId}`,
      text: "未找到可用于数据库导入的 Excel、CSV 或 ZIP 文件，请附上或引用文件后再试。",
      replyToMessageId: params.replyToMessageId,
      replyInThread: params.replyInThread,
      accountId: params.accountId,
    });
    return true;
  }

  const salesResult = await runShellCommand(buildJiuyanPythonCommand([IMPORT_SALES_SCRIPT]));
  const skusResult = await runShellCommand(buildJiuyanPythonCommand([IMPORT_SKUS_SCRIPT]));
  const salesOk = importOutputLooksSuccessful(salesResult.combined, "sales");
  const skusOk = importOutputLooksSuccessful(skusResult.combined, "skus");

  if (!salesOk && !skusOk) {
    await sendMessageFeishu({
      cfg: params.cfg,
      to: `chat:${params.chatId}`,
      text: buildImportFailureSummary([salesResult.combined, skusResult.combined]),
      replyToMessageId: params.replyToMessageId,
      replyInThread: params.replyInThread,
      accountId: params.accountId,
    });
    return true;
  }

  const summaryLines = [
    `${intent.prefix} 已完成。`,
    ...new Set(
      [salesResult.combined, skusResult.combined]
        .flatMap((output) => summarizeImportOutput(output))
        .slice(0, 12),
    ),
  ];
  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: summaryLines.join("\n"),
    replyToMessageId: params.replyToMessageId,
    replyInThread: params.replyInThread,
    accountId: params.accountId,
  });
  return true;
}

async function stageScopeInputFiles(mediaList: readonly FeishuMediaInfo[]): Promise<string[]> {
  await clearScopeInputDir();
  const stagedPaths: string[] = [];
  for (const media of mediaList) {
    if (!isScopeInputFile(media.path)) {
      continue;
    }
    const destination = path.join(JIUYAN_SCOPE_INPUT_DIR, path.basename(media.path));
    await fs.copyFile(media.path, destination);
    stagedPaths.push(destination);
  }
  return stagedPaths;
}

function buildScopeArgs(intent: JiuyanExportIntent, stagedScopeFiles: readonly string[]): string[] {
  const args: string[] = [];
  if (intent.yesterdayTop) {
    args.push("--yesterday-top", String(intent.yesterdayTop));
  }
  if (intent.lastMonthTop) {
    args.push("--last-month-top", String(intent.lastMonthTop));
  }
  for (const filePath of stagedScopeFiles) {
    args.push("--from-file", filePath);
  }
  return args;
}

function buildScopeSummary(intent: JiuyanExportIntent): string {
  if (intent.fileScope) {
    return "表中 SKU";
  }
  if (intent.lastMonthTop) {
    return `上个月 Top ${intent.lastMonthTop} SKU`;
  }
  if (intent.yesterdayTop) {
    return `昨天 Top ${intent.yesterdayTop} SKU`;
  }
  return "默认范围";
}

function buildCompletionIntro(intent: JiuyanExportIntent): string {
  return intent.prefix === "/销量计算"
    ? "销量计算已完成，Excel 已发送。"
    : "生产计划已更新，Excel 已发送。";
}

export async function maybeHandleJiuyanFeishuDirectExport(params: {
  cfg: ClawdbotConfig;
  accountId?: string;
  messageText: string;
  chatId: string;
  replyToMessageId: string;
  replyInThread: boolean;
  mediaList: readonly FeishuMediaInfo[];
  quotedMediaList?: readonly FeishuMediaInfo[];
  log?: (message: string) => void;
}): Promise<boolean> {
  const intent = parseJiuyanExportIntent(params.messageText);
  if (!intent) {
    return false;
  }

  params.log?.(`feishu[${params.accountId ?? "default"}]: handling Jiuyan export directly`);

  await runShellCommand(buildJiuyanPythonCommand([CLEAR_FOLDERS_SCRIPT, "--exports"]));

  const scopeSourceMedia = [...params.mediaList, ...(params.quotedMediaList ?? [])];
  const stagedScopeFiles = intent.fileScope ? await stageScopeInputFiles(scopeSourceMedia) : [];
  if (intent.fileScope && stagedScopeFiles.length === 0) {
    await sendMessageFeishu({
      cfg: params.cfg,
      to: `chat:${params.chatId}`,
      text: "未找到可用于“表中 SKU”范围的 Excel 或 CSV 文件，请引用一个包含 SKU 列的文件后再试。",
      replyToMessageId: params.replyToMessageId,
      replyInThread: params.replyInThread,
      accountId: params.accountId,
    });
    return true;
  }

  const scopeArgs = buildScopeArgs(intent, stagedScopeFiles);
  let scopeWorkbookPath: string | undefined;
  if (scopeArgs.length > 0) {
    const scopeCommand = buildJiuyanPythonCommand([SELECT_EXPORT_SKUS_SCRIPT, ...scopeArgs]);
    const scopeResult = await runShellCommand(scopeCommand);
    scopeWorkbookPath = resolveExportWorkbookPath(scopeResult.combined) ?? undefined;
    if (!scopeWorkbookPath) {
      throw new Error(`Jiuyan scope export did not return an .xlsx path.\n${scopeResult.combined}`);
    }
  }

  const exportArgs = [
    EXPORT_FORECAST_SCRIPT,
    ...(intent.months ? ["--months", String(intent.months)] : []),
    ...(scopeWorkbookPath ? ["--sku-scope-file", scopeWorkbookPath] : []),
  ];
  const exportResult = await runShellCommand(buildJiuyanPythonCommand(exportArgs));
  const workbookPath = resolveExportWorkbookPath(exportResult.combined);
  if (!workbookPath) {
    throw new Error(`Jiuyan export did not return an .xlsx path.\n${exportResult.combined}`);
  }

  await sendMediaFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    mediaUrl: workbookPath,
    replyToMessageId: params.replyToMessageId,
    replyInThread: params.replyInThread,
    accountId: params.accountId,
    mediaLocalRoots: [JIUYAN_EXPORTS_DIR],
  });

  const summary = [
    buildCompletionIntro(intent),
    intent.months ? `需求月份：未来 ${intent.months} 个月` : undefined,
    `SKU 范围：${buildScopeSummary(intent)}`,
  ]
    .filter(Boolean)
    .join("\n");
  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: summary,
    replyToMessageId: params.replyToMessageId,
    replyInThread: params.replyInThread,
    accountId: params.accountId,
  });

  return true;
}

export async function maybeHandleJiuyanFeishuDirectOps(params: {
  cfg: ClawdbotConfig;
  accountId?: string;
  messageText: string;
  chatId: string;
  replyToMessageId: string;
  replyInThread: boolean;
  mediaList: readonly FeishuMediaInfo[];
  quotedMediaList?: readonly FeishuMediaInfo[];
  log?: (message: string) => void;
}): Promise<boolean> {
  if (await maybeHandleJiuyanFeishuDirectImport(params)) {
    return true;
  }
  return await maybeHandleJiuyanFeishuDirectExport(params);
}
