import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "../util/logger.js";
import {
  parseJiuyanExportIntent,
  parseJiuyanImportIntent,
  type JiuyanExportIntent,
} from "./jiuyan-data-ops-intent.js";
import { sendWeixinMediaFile } from "./send-media.js";
import { sendMessageWeixin } from "./send.js";

const execFileAsync = promisify(execFile);

const JIUYAN_ROOT = "/Users/andychan/Documents/jiuyan";
const JIUYAN_UTILS_DIR = path.join(JIUYAN_ROOT, "utils");
const JIUYAN_EXPORTS_DIR = path.join(JIUYAN_ROOT, "exports");
const JIUYAN_SCOPE_INPUTS_DIR = path.join(JIUYAN_EXPORTS_DIR, "_scope_inputs");
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

type WeixinJiuyanParams = {
  messageText: string;
  mediaPath?: string;
  to: string;
  contextToken?: string;
  baseUrl: string;
  token?: string;
  cdnBaseUrl: string;
  accountId: string;
  log?: (message: string) => void;
};

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

function buildCommonOpts(params: WeixinJiuyanParams) {
  return {
    baseUrl: params.baseUrl,
    token: params.token,
    contextToken: params.contextToken,
  };
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
  await fs.rm(dirPath, { force: true, recursive: true });
  await fs.mkdir(dirPath, { recursive: true });
}

function isImportInputFile(filePath: string): boolean {
  return /\.(xlsx|xls|csv|zip)$/i.test(filePath);
}

function isScopeInputFile(filePath: string): boolean {
  return /\.(xlsx|xls|csv)$/i.test(filePath);
}

async function stageImportInputFile(sourcePath: string): Promise<void> {
  if (!isImportInputFile(sourcePath)) {
    throw new Error("未找到可用于数据库导入的 Excel、CSV 或 ZIP 文件，请附上或引用文件后再试。");
  }
  await runJiuyanPython([CLEAR_FOLDERS_SCRIPT, "--upload"]);
  await fs.mkdir(JIUYAN_UPLOAD_DIR, { recursive: true });
  const targetPath = path.join(JIUYAN_UPLOAD_DIR, path.basename(sourcePath));
  await fs.copyFile(sourcePath, targetPath);
  if (/\.zip$/i.test(targetPath)) {
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", targetPath, JIUYAN_UPLOAD_DIR], {
      cwd: JIUYAN_ROOT,
      maxBuffer: 10 * 1024 * 1024,
    });
  }
}

async function stageScopeInputFile(sourcePath: string): Promise<string> {
  if (!isScopeInputFile(sourcePath)) {
    throw new Error("未找到可用于“表中 SKU”范围的 Excel 或 CSV 文件，请附上或引用文件后再试。");
  }
  await recreateDir(JIUYAN_SCOPE_INPUTS_DIR);
  const targetPath = path.join(JIUYAN_SCOPE_INPUTS_DIR, path.basename(sourcePath));
  await fs.copyFile(sourcePath, targetPath);
  return targetPath;
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

function extractExportedWorkbookPath(output: string): string | null {
  const matches = output.match(/\/[^\s]+formula-forecast-\d{8}_\d{6}\.xlsx/g);
  return matches?.at(-1) ?? null;
}

function buildScopeArgs(intent: JiuyanExportIntent, stagedScopeFiles: readonly string[]): string[] {
  if (intent.fileScope) {
    return ["--from-file", stagedScopeFiles[0] ?? ""];
  }
  if (intent.lastMonthTop) {
    return ["--last-month-top", String(intent.lastMonthTop)];
  }
  if (intent.yesterdayTop) {
    return ["--yesterday-top", String(intent.yesterdayTop)];
  }
  return [];
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
  return "所有 SKU（未指定特别范围）";
}

function buildCompletionIntro(intent: JiuyanExportIntent): string {
  const monthLabel = intent.months ? `${intent.months}个月` : "";
  if (intent.prefix.includes("销量")) {
    return monthLabel
      ? `销量计算已完成，已为您导出${monthLabel}结果表。`
      : "销量计算已完成，已为您导出结果表。";
  }
  return monthLabel
    ? `需求计算已完成，已为您导出${monthLabel}生产计划表。`
    : "需求计算已完成，已为您导出生产计划表。";
}

async function maybeHandleJiuyanWeixinDirectImport(params: WeixinJiuyanParams): Promise<boolean> {
  const intent = parseJiuyanImportIntent(params.messageText);
  if (!intent) {
    return false;
  }

  params.log?.(`weixin[${params.accountId}]: handling Jiuyan import directly`);
  await sendMessageWeixin({
    to: params.to,
    text: "文件已收到，正在准备导入数据，导入完成后会提醒你。",
    opts: buildCommonOpts(params),
  });
  if (!params.mediaPath) {
    await sendMessageWeixin({
      to: params.to,
      text: "未找到可用于数据库导入的 Excel、CSV 或 ZIP 文件，请附上或引用文件后再试。",
      opts: buildCommonOpts(params),
    });
    return true;
  }

  try {
    await stageImportInputFile(params.mediaPath);

    const salesResult = await runJiuyanPython([IMPORT_SALES_SCRIPT]);
    const skusResult = await runJiuyanPython([IMPORT_SKUS_SCRIPT]);
    const salesOk = importOutputLooksSuccessful(salesResult.combined, "sales");
    const skusOk = importOutputLooksSuccessful(skusResult.combined, "skus");
    const salesSummary = extractImportSummary(salesResult.combined);
    const skusSummary = extractImportSummary(skusResult.combined);

    if (!salesOk && !skusOk) {
      await sendMessageWeixin({
        to: params.to,
        text: buildImportFailureSummary({
          salesOutput: salesResult.combined,
          skusOutput: skusResult.combined,
        }),
        opts: buildCommonOpts(params),
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
    const body = summaryLines.length > 0 ? summaryLines.join("\n\n") : "导入已完成。";
    await sendMessageWeixin({
      to: params.to,
      text: body,
      opts: buildCommonOpts(params),
    });
    return true;
  } catch (error) {
    logger.error(`weixin Jiuyan import failed: ${String(error)}`);
    await sendMessageWeixin({
      to: params.to,
      text: `Jiuyan 导入失败：${error instanceof Error ? error.message : String(error)}`,
      opts: buildCommonOpts(params),
    });
    return true;
  }
}

async function maybeHandleJiuyanWeixinDirectExport(params: WeixinJiuyanParams): Promise<boolean> {
  const hasDefaultScopeFile = params.mediaPath ? isScopeInputFile(params.mediaPath) : false;
  const intent = parseJiuyanExportIntent(params.messageText, {
    defaultFileScope: hasDefaultScopeFile,
  });
  if (!intent) {
    return false;
  }

  params.log?.(`weixin[${params.accountId}]: handling Jiuyan export directly`);
  await sendMessageWeixin({
    to: params.to,
    text: "正在准备生产计划，完成后立刻会把结果文件发给你。",
    opts: buildCommonOpts(params),
  });
  try {
    await runJiuyanPython([CLEAR_FOLDERS_SCRIPT, "--exports"]);

    const stagedScopeFiles: string[] = [];
    if (intent.fileScope) {
      if (!params.mediaPath) {
        await sendMessageWeixin({
          to: params.to,
          text: "未找到可用于“表中 SKU”范围的 Excel 或 CSV 文件，请附上或引用文件后再试。",
          opts: buildCommonOpts(params),
        });
        return true;
      }
      stagedScopeFiles.push(await stageScopeInputFile(params.mediaPath));
    }

    const scopeArgs = buildScopeArgs(intent, stagedScopeFiles);
    let scopeWorkbookPath: string | undefined;
    if (scopeArgs.length > 0) {
      const scopeResult = await runJiuyanPython([SELECT_EXPORT_SKUS_SCRIPT, ...scopeArgs]);
      scopeWorkbookPath = extractExportedWorkbookPath(scopeResult.combined) ?? undefined;
      if (!scopeWorkbookPath) {
        throw new Error(
          `Jiuyan scope export did not return an .xlsx path.\n${scopeResult.combined}`,
        );
      }
    }

    const exportArgs = [EXPORT_FORECAST_SCRIPT];
    if (intent.months) {
      exportArgs.push("--months", String(intent.months));
    }
    if (scopeWorkbookPath) {
      exportArgs.push("--sku-scope-file", scopeWorkbookPath);
    }
    const exportResult = await runJiuyanPython(exportArgs);
    const workbookPath = extractExportedWorkbookPath(exportResult.combined);
    if (!workbookPath) {
      throw new Error(`Jiuyan export did not return an .xlsx path.\n${exportResult.combined}`);
    }

    await sendWeixinMediaFile({
      filePath: workbookPath,
      to: params.to,
      text: [
        buildCompletionIntro(intent),
        `计算范围：${buildScopeSummary(intent)}`,
        intent.months ? `月份：未来 ${intent.months} 个月` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      opts: buildCommonOpts(params),
      cdnBaseUrl: params.cdnBaseUrl,
    });
    return true;
  } catch (error) {
    logger.error(`weixin Jiuyan export failed: ${String(error)}`);
    await sendMessageWeixin({
      to: params.to,
      text: `Jiuyan 导出失败：${error instanceof Error ? error.message : String(error)}`,
      opts: buildCommonOpts(params),
    });
    return true;
  }
}

export async function maybeHandleJiuyanWeixinDirectOps(
  params: WeixinJiuyanParams,
): Promise<boolean> {
  if (await maybeHandleJiuyanWeixinDirectImport(params)) {
    return true;
  }
  return await maybeHandleJiuyanWeixinDirectExport(params);
}
