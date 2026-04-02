import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  parseJiuyanExportIntent,
  parseJiuyanImportIntent,
  type JiuyanExportIntent,
} from "openclaw/plugin-sdk/jiuyan-direct-ops";

const execFileAsync = promisify(execFile);

export const JIUYAN_ROOT = "/Users/andychan/Documents/jiuyan";
const JIUYAN_UTILS_DIR = path.join(JIUYAN_ROOT, "utils");
export const JIUYAN_EXPORTS_DIR = path.join(JIUYAN_ROOT, "exports");
const JIUYAN_SCOPE_INPUT_DIR = path.join(JIUYAN_EXPORTS_DIR, "_scope_inputs");
const JIUYAN_UPLOAD_DIR = path.join(JIUYAN_ROOT, "upload");
const JIUYAN_PYTHON_CANDIDATES = [
  path.join(JIUYAN_ROOT, ".venv", "bin", "python"),
  path.join(JIUYAN_ROOT, "sales_filtered_database", ".venv", "bin", "python"),
] as const;
const JIUYAN_PYTHON =
  JIUYAN_PYTHON_CANDIDATES.find((candidate) => existsSync(candidate)) ??
  JIUYAN_PYTHON_CANDIDATES[0];
const CLEAR_FOLDERS_SCRIPT = path.join(JIUYAN_UTILS_DIR, "clear_folders.py");
const SELECT_EXPORT_SKUS_SCRIPT = path.join(JIUYAN_UTILS_DIR, "select_export_skus.py");
const EXPORT_FORECAST_SCRIPT = path.join(JIUYAN_UTILS_DIR, "export_forecast.py");
const IMPORT_SALES_SCRIPT = path.join(JIUYAN_UTILS_DIR, "import_sales.py");
const IMPORT_SKUS_SCRIPT = path.join(JIUYAN_UTILS_DIR, "import_skus.py");

type ShellResult = {
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

export type JiuyanDirectImportExecutionResult =
  | {
      kind: "import";
      outcome: "needs_input";
      message: string;
    }
  | {
      kind: "import";
      outcome: "failure";
      message: string;
    }
  | {
      kind: "import";
      outcome: "success";
      message: string;
    };

export type JiuyanDirectExportExecutionResult =
  | {
      kind: "export";
      outcome: "needs_input";
      message: string;
    }
  | {
      kind: "export";
      outcome: "success";
      workbookPath: string;
      message: string;
      scopeSummary: string;
      completionIntro: string;
      months?: number;
    };

export type JiuyanDirectDeliveryItem =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "file";
      filePath: string;
      text?: string;
    };

export type JiuyanDirectDeliveryPlan = {
  startMessage: string;
  deliveries: JiuyanDirectDeliveryItem[];
};

export function isJiuyanScopeInputPath(filePath: string): boolean {
  return /\.(xlsx|xls|csv)$/i.test(filePath);
}

function isJiuyanImportInputPath(filePath: string): boolean {
  return /\.(xlsx|xls|csv|zip)$/i.test(filePath);
}

async function runJiuyanPython(args: readonly string[]): Promise<ShellResult> {
  const { stdout, stderr } = await execFileAsync(JIUYAN_PYTHON, [...args], {
    cwd: JIUYAN_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    stdout,
    stderr,
    combined: [stdout, stderr].filter(Boolean).join("\n").trim(),
  };
}

async function recreateDir(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
  await fs.mkdir(dirPath, { recursive: true });
}

async function clearUploadDir(): Promise<void> {
  await runJiuyanPython([CLEAR_FOLDERS_SCRIPT, "--upload"]);
  await fs.mkdir(JIUYAN_UPLOAD_DIR, { recursive: true });
}

async function clearScopeInputDir(): Promise<void> {
  await recreateDir(JIUYAN_SCOPE_INPUT_DIR);
}

async function extractZipToUpload(zipPath: string): Promise<void> {
  await execFileAsync("/usr/bin/ditto", ["-x", "-k", zipPath, JIUYAN_UPLOAD_DIR], {
    cwd: JIUYAN_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function stageImportInputFiles(inputPaths: readonly string[]): Promise<string[]> {
  await clearUploadDir();
  const stagedPaths: string[] = [];
  for (const inputPath of inputPaths) {
    if (!isJiuyanImportInputPath(inputPath)) {
      continue;
    }
    const destination = path.join(JIUYAN_UPLOAD_DIR, path.basename(inputPath));
    await fs.copyFile(inputPath, destination);
    stagedPaths.push(destination);
    if (/\.zip$/i.test(destination)) {
      await extractZipToUpload(destination);
    }
  }
  return stagedPaths;
}

async function stageScopeInputFiles(inputPaths: readonly string[]): Promise<string[]> {
  await clearScopeInputDir();
  const stagedPaths: string[] = [];
  for (const inputPath of inputPaths) {
    if (!isJiuyanScopeInputPath(inputPath)) {
      continue;
    }
    const destination = path.join(JIUYAN_SCOPE_INPUT_DIR, path.basename(inputPath));
    await fs.copyFile(inputPath, destination);
    stagedPaths.push(destination);
  }
  return stagedPaths;
}

function resolveExportWorkbookPath(output: string): string | null {
  const match = output.match(/(\/[^\s]+\.xlsx)/);
  return match?.[1] ?? null;
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
  lines.push(...formatDocUpdateLines(summary.doc_updates));
  return lines.join("\n");
}

function buildSkusImportSuccessMessage(summary: JiuyanSkusImportSummary): string {
  const lines = ["SKU 数据更新成功！", `新增 SKU：${summary.new_sku_count} 个`];
  const newSkus = summary.new_skus ?? [];
  if (newSkus.length > 0) {
    lines.push("新增 SKU 列表：");
    for (const item of newSkus.slice(0, 20)) {
      lines.push(`${item.barcode} | ${item.family} | ${item.name}`);
    }
    if (newSkus.length > 20) {
      lines.push(`其余 ${newSkus.length - 20} 个 SKU 已省略`);
    }
  }
  lines.push(`更新库存 SKU：${summary.inventory_updated_sku_count} 个`);
  if (typeof summary.invalid_barcode_count === "number" && summary.invalid_barcode_count > 0) {
    lines.push(`跳过无效条码：${summary.invalid_barcode_count} 行`);
  }
  if (
    typeof summary.filtered_out_by_category_count === "number" &&
    summary.filtered_out_by_category_count > 0
  ) {
    lines.push(`分类过滤跳过：${summary.filtered_out_by_category_count} 行`);
  }
  lines.push(...formatDocUpdateLines(summary.doc_updates));
  return lines.join("\n");
}

function buildImportFailureSummary(results: { salesOutput: string; skusOutput: string }): string {
  const lines = ["导入失败，请检查文件列名后重新上传。"];
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

export async function executeJiuyanDirectImport(params: {
  messageText: string;
  inputPaths: readonly string[];
}): Promise<JiuyanDirectImportExecutionResult | null> {
  if (!parseJiuyanImportIntent(params.messageText)) {
    return null;
  }

  const stagedFiles = await stageImportInputFiles(params.inputPaths);
  if (stagedFiles.length === 0) {
    return {
      kind: "import",
      outcome: "needs_input",
      message: "未找到可用于数据库导入的 Excel、CSV 或 ZIP 文件，请附上或引用文件后再试。",
    };
  }

  const salesResult = await runJiuyanPython([IMPORT_SALES_SCRIPT]);
  const skusResult = await runJiuyanPython([IMPORT_SKUS_SCRIPT]);
  const salesOk = importOutputLooksSuccessful(salesResult.combined, "sales");
  const skusOk = importOutputLooksSuccessful(skusResult.combined, "skus");
  const salesSummary = extractImportSummary(salesResult.combined);
  const skusSummary = extractImportSummary(skusResult.combined);

  if (!salesOk && !skusOk) {
    return {
      kind: "import",
      outcome: "failure",
      message: buildImportFailureSummary({
        salesOutput: salesResult.combined,
        skusOutput: skusResult.combined,
      }),
    };
  }

  const summaryLines: string[] = [];
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

  return {
    kind: "import",
    outcome: "success",
    message: summaryLines.join("\n\n"),
  };
}

export async function executeJiuyanDirectExport(params: {
  messageText: string;
  inputPaths: readonly string[];
}): Promise<JiuyanDirectExportExecutionResult | null> {
  const hasDefaultScopeFile = params.inputPaths.some((inputPath) =>
    isJiuyanScopeInputPath(inputPath),
  );
  const intent = parseJiuyanExportIntent(params.messageText, {
    defaultFileScope: hasDefaultScopeFile,
  });
  if (!intent) {
    return null;
  }

  await runJiuyanPython([CLEAR_FOLDERS_SCRIPT, "--exports"]);

  const stagedScopeFiles = intent.fileScope ? await stageScopeInputFiles(params.inputPaths) : [];
  if (intent.fileScope && stagedScopeFiles.length === 0) {
    return {
      kind: "export",
      outcome: "needs_input",
      message:
        "未找到可用于“表中 SKU”范围的 Excel 或 CSV 文件，请引用一个包含 SKU 列的文件后再试。",
    };
  }

  const scopeArgs = buildScopeArgs(intent, stagedScopeFiles);
  let scopeWorkbookPath: string | undefined;
  if (scopeArgs.length > 0) {
    const scopeResult = await runJiuyanPython([SELECT_EXPORT_SKUS_SCRIPT, ...scopeArgs]);
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
  const exportResult = await runJiuyanPython(exportArgs);
  const workbookPath = resolveExportWorkbookPath(exportResult.combined);
  if (!workbookPath) {
    throw new Error(`Jiuyan export did not return an .xlsx path.\n${exportResult.combined}`);
  }

  const scopeSummary = buildScopeSummary(intent);
  const completionIntro = buildCompletionIntro(intent);
  const message = [
    completionIntro,
    intent.months ? `需求月份：未来 ${intent.months} 个月` : undefined,
    `SKU 范围：${scopeSummary}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    kind: "export",
    outcome: "success",
    workbookPath,
    message,
    scopeSummary,
    completionIntro,
    ...(intent.months ? { months: intent.months } : {}),
  };
}

export function buildJiuyanDirectImportDeliveryPlan(
  result: JiuyanDirectImportExecutionResult,
): JiuyanDirectDeliveryPlan {
  return {
    startMessage: "文件已收到，正在准备导入数据，导入完成后会提醒你。",
    deliveries: [{ kind: "text", text: result.message }],
  };
}

export function buildJiuyanDirectExportDeliveryPlan(
  result: JiuyanDirectExportExecutionResult,
): JiuyanDirectDeliveryPlan {
  return {
    startMessage: "正在准备生产计划，完成后立刻会把结果文件发给你。",
    deliveries:
      result.outcome === "needs_input"
        ? [{ kind: "text", text: result.message }]
        : [{ kind: "file", filePath: result.workbookPath, text: result.message }],
  };
}
