import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
const JIUYAN_VENV_PYTHON_CANDIDATES = [
  path.join(JIUYAN_ROOT, ".venv", "bin", "python"),
  path.join(JIUYAN_ROOT, "sales_filtered_database", ".venv", "bin", "python"),
] as const;
const JIUYAN_VENV_PYTHON =
  JIUYAN_VENV_PYTHON_CANDIDATES.find((candidate) => existsSync(candidate)) ??
  JIUYAN_VENV_PYTHON_CANDIDATES[0];
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

type JiuyanDocUpdate = {
  file: string;
  count: number;
  items?: string[];
};

type JiuyanSalesImportSummary = {
  kind: "sales";
  file_rows: number;
  file_sku_count: number;
  file_date_range?: {
    start?: string | null;
    end?: string | null;
  };
  new_rows: number;
  new_sku_count: number;
  updated_rows: number;
  new_sales_volume: number;
  new_date_range?: {
    start?: string | null;
    end?: string | null;
  };
  new_sku_sales?: Array<{
    barcode: string;
    family: string;
    sales_volume: number;
  }>;
  skipped_new_skus?: Array<{
    barcode: string;
    reason: string;
  }>;
  doc_updates?: JiuyanDocUpdate[];
};

type JiuyanSkusImportSummary = {
  kind: "skus";
  processed_rows: number;
  inventory_updated_sku_count: number;
  new_sku_count: number;
  updated_sku_count: number;
  invalid_barcode_count?: number;
  filtered_out_by_category_count?: number;
  new_skus?: Array<{
    barcode: string;
    name: string;
    family: string;
  }>;
  doc_updates?: JiuyanDocUpdate[];
};

type JiuyanImportSummary = JiuyanSalesImportSummary | JiuyanSkusImportSummary;

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
        (/^[-•]/.test(line) ||
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

function extractImportSummary(output: string): JiuyanImportSummary | null {
  const marker = "OPENCLAW_IMPORT_SUMMARY:";
  const summaryLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .toReversed()
    .find((line) => line.startsWith(marker));
  if (!summaryLine) {
    return null;
  }
  try {
    return JSON.parse(summaryLine.slice(marker.length)) as JiuyanImportSummary;
  } catch {
    return null;
  }
}

function formatDocUpdateLines(docUpdates: readonly JiuyanDocUpdate[] | undefined): string[] {
  return (docUpdates ?? []).map((update) => {
    const preview = (update.items ?? []).slice(0, 8).join("、");
    const suffix =
      update.items && update.items.length > 8
        ? ` 等 ${update.count} 项`
        : preview
          ? `：${preview}`
          : "";
    return `- 已更新 ${update.file}：${update.count} 项${suffix}`;
  });
}

function buildSalesImportSuccessMessage(summary: JiuyanSalesImportSummary): string {
  const lines = ["销售数据更新成功！", `新增 SKU：${summary.new_sku_count} 个`];
  const skippedNewSkus = summary.skipped_new_skus ?? [];
  if (skippedNewSkus.length > 0) {
    lines.push(`跳过新增 SKU：${skippedNewSkus.length} 个`);
    lines.push("跳过条码列表：");
    for (const item of skippedNewSkus.slice(0, 20)) {
      lines.push(`${item.barcode} | ${item.reason}`);
    }
    if (skippedNewSkus.length > 20) {
      lines.push(`其余 ${skippedNewSkus.length - 20} 个条码已省略`);
    }
  }
  const newSkuSales = summary.new_sku_sales ?? [];
  if (newSkuSales.length > 0) {
    lines.push("新增 SKU 列表：");
    for (const item of newSkuSales.slice(0, 12)) {
      lines.push(`${item.barcode} | ${item.family} | ${item.sales_volume}`);
    }
    if (newSkuSales.length > 12) {
      lines.push(`其余 ${newSkuSales.length - 12} 个 SKU 已省略`);
    }
  }
  lines.push(`新增销售记录：${summary.new_rows} 条`);
  lines.push(
    summary.new_date_range?.start || summary.new_date_range?.end
      ? `新增时间范围：${summary.new_date_range?.start ?? "未知"} ~ ${summary.new_date_range?.end ?? "未知"}`
      : "新增时间范围：无新增数据",
  );
  lines.push(`文件包含 SKU：${summary.file_sku_count} 个`);
  lines.push(`文件包含销售记录：${summary.file_rows} 条`);
  lines.push(
    summary.file_date_range?.start || summary.file_date_range?.end
      ? `文件时间范围：${summary.file_date_range?.start ?? "未知"} ~ ${summary.file_date_range?.end ?? "未知"}`
      : "文件时间范围：未知",
  );
  lines.push(...formatDocUpdateLines(summary.doc_updates));
  return lines.join("\n");
}

function buildSkusImportSuccessMessage(summary: JiuyanSkusImportSummary): string {
  const lines = [
    `${summary.inventory_updated_sku_count} 个 SKU 的库存和在途数据更新成功！`,
    `- 其中新增 ${summary.new_sku_count} 个 SKU，更新已有 ${summary.updated_sku_count} 个 SKU`,
  ];
  if (summary.filtered_out_by_category_count) {
    lines.push(`- 分类过滤掉 ${summary.filtered_out_by_category_count} 条记录`);
  }
  if (summary.invalid_barcode_count) {
    lines.push(`- 非法条码过滤掉 ${summary.invalid_barcode_count} 条记录`);
  }
  const newSkus = summary.new_skus ?? [];
  if (newSkus.length > 0) {
    lines.push("- 新增 SKU 列表：");
    for (const item of newSkus.slice(0, 12)) {
      lines.push(`  ${item.barcode} | ${item.family} | ${item.name}`);
    }
    if (newSkus.length > 12) {
      lines.push(`  其余 ${newSkus.length - 12} 个 SKU 已省略`);
    }
  }
  lines.push(...formatDocUpdateLines(summary.doc_updates));
  return lines.join("\n");
}

function buildImportFailureSummary(results: { salesOutput: string; skusOutput: string }): string {
  const lines = ["文件中缺少必要的数据字段，无法导入。"];
  const salesHasSalesOnly = results.salesOutput.includes("销售数量/净销量/销量");
  lines.push("销售数据导入：");
  lines.push(
    "- 必选字段：店铺、省份、城市、日期、商品编码、商品名称、产品分类、基本售价、市场吊牌价、所属站点、销售数量/净销量/销量、已付金额/支付金额/净销售额/销售金额",
  );
  lines.push("- 可选字段：实际可用数、采购在途");
  if (salesHasSalesOnly) {
    lines.push("- 说明：不接受只有“销售单数”但没有“销售数量/净销量/销量”的文件");
  }
  lines.push("库存数据导入：");
  lines.push("- 必选字段：商品编码、商品名/商品名称、产品分类/商品分类、实际可用数、采购在途");
  lines.push("- 可选字段：供应商、基本售价/基础售价、市场|吊牌价/市场吊牌价/吊牌价、商品创建日期");
  return lines.join("\n");
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

  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: "文件已收到，正在准备导入数据，导入完成后会提醒你。",
    accountId: params.accountId,
  });

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
  const salesSummary = extractImportSummary(salesResult.combined);
  const skusSummary = extractImportSummary(skusResult.combined);

  if (!salesOk && !skusOk) {
    await sendMessageFeishu({
      cfg: params.cfg,
      to: `chat:${params.chatId}`,
      text: buildImportFailureSummary({
        salesOutput: salesResult.combined,
        skusOutput: skusResult.combined,
      }),
      replyToMessageId: params.replyToMessageId,
      replyInThread: params.replyInThread,
      accountId: params.accountId,
    });
    return true;
  }

  const summaryLines = [];
  if (salesOk && salesSummary?.kind === "sales") {
    summaryLines.push(buildSalesImportSuccessMessage(salesSummary));
  } else if (salesOk) {
    summaryLines.push(...summarizeImportOutput(salesResult.combined).slice(0, 12));
  }
  if (skusOk && skusSummary?.kind === "skus") {
    summaryLines.push(buildSkusImportSuccessMessage(skusSummary));
  } else if (skusOk) {
    summaryLines.push(...summarizeImportOutput(skusResult.combined).slice(0, 12));
  }
  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: summaryLines.join("\n\n"),
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
  const scopeSourceMedia = [...params.mediaList, ...(params.quotedMediaList ?? [])];
  const hasDefaultScopeFile = scopeSourceMedia.some((media) => isScopeInputFile(media.path));
  const intent = parseJiuyanExportIntent(params.messageText, {
    defaultFileScope: hasDefaultScopeFile,
  });
  if (!intent) {
    return false;
  }

  params.log?.(`feishu[${params.accountId ?? "default"}]: handling Jiuyan export directly`);

  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: "正在准备生产计划，完成后立刻会把结果文件发给你。",
    accountId: params.accountId,
  });

  await runShellCommand(buildJiuyanPythonCommand([CLEAR_FOLDERS_SCRIPT, "--exports"]));

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
  commandAuthorized?: boolean;
  mediaList: readonly FeishuMediaInfo[];
  quotedMediaList?: readonly FeishuMediaInfo[];
  log?: (message: string) => void;
}): Promise<boolean> {
  if (params.commandAuthorized === false) {
    return false;
  }
  if (await maybeHandleJiuyanFeishuDirectImport(params)) {
    return true;
  }
  return await maybeHandleJiuyanFeishuDirectExport(params);
}
