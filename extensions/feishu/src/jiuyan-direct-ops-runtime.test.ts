import { describe, expect, it } from "vitest";
import {
  buildJiuyanDirectExportStartMessagePreview,
  buildSalesImportSuccessMessage,
  buildSkusImportSuccessMessage,
  buildJiuyanDirectExportDeliveryPlan,
  buildJiuyanDirectImportDeliveryPlan,
} from "./jiuyan-direct-ops-runtime.js";

describe("buildJiuyanDirectImportDeliveryPlan", () => {
  it("skips the optimistic start message when input is missing", () => {
    expect(
      buildJiuyanDirectImportDeliveryPlan({
        kind: "import",
        outcome: "needs_input",
        message: "未找到可用于数据库导入的 Excel、CSV 或 ZIP 文件，请附上或引用文件后再试。",
      }).startMessage,
    ).toBe("");
  });

  it("keeps the start message for successful imports", () => {
    expect(
      buildJiuyanDirectImportDeliveryPlan({
        kind: "import",
        outcome: "success",
        message: "销售数据更新成功！",
      }).startMessage,
    ).toBe("文件已收到，正在准备导入数据，导入完成后会提醒你。");
  });
});

describe("buildJiuyanDirectExportDeliveryPlan", () => {
  it("uses the long AI start message when more than 500 skus are being processed", () => {
    expect(
      buildJiuyanDirectExportDeliveryPlan({
        kind: "export",
        outcome: "success",
        workbookPaths: ["/tmp/ai-forecast.xlsx"],
        skuCount: 666,
        message: "AI 生产计划已生成，Excel 已发送。",
        scopeSummary: "全量 SKU",
        completionIntro: "AI 生产计划已生成，Excel 已发送。",
      }).startMessage,
    ).toBe(
      "正在准备 AI 生产计划，总共有 666 个 sku 需要处理，需要的时间较长，请耐心等待，完成后我会把结果文件发给你。",
    );
  });

  it("keeps the original AI start message when 500 or fewer skus are being processed", () => {
    expect(
      buildJiuyanDirectExportDeliveryPlan({
        kind: "export",
        outcome: "success",
        workbookPaths: ["/tmp/ai-forecast.xlsx"],
        skuCount: 500,
        message: "AI 生产计划已生成，Excel 已发送。",
        scopeSummary: "全量 SKU",
        completionIntro: "AI 生产计划已生成，Excel 已发送。",
      }).startMessage,
    ).toBe("正在准备 AI 生产计划，完成后立刻会把结果文件发给你。");
  });

  it("uses 全量 SKU as the default scope label in completion messages", () => {
    expect(
      buildJiuyanDirectExportDeliveryPlan({
        kind: "export",
        outcome: "success",
        workbookPaths: ["/tmp/ai-forecast.xlsx"],
        message:
          "AI 生产计划已生成，Excel 已发送。\n需求月份：未来 5 个月\nSKU 范围：全量 SKU\n输出 生产计划文件：1 个",
        scopeSummary: "全量 SKU",
        completionIntro: "AI 生产计划已生成，Excel 已发送。",
      }).deliveries.at(0),
    ).toEqual({
      kind: "file",
      filePath: "/tmp/ai-forecast.xlsx",
      text:
        "AI 生产计划已生成，Excel 已发送。\n需求月份：未来 5 个月\nSKU 范围：全量 SKU\n输出 生产计划文件：1 个",
    });
  });

  it("appends the markdown diff report after AI workbook deliveries", () => {
    expect(
      buildJiuyanDirectExportDeliveryPlan({
        kind: "export",
        outcome: "success",
        workbookPaths: ["/tmp/ai-forecast.xlsx"],
        diffReportPath: "/tmp/20260409_20260408_diff_report.md",
        message:
          "AI 生产计划已生成，Excel 已发送。\n需求月份：未来 5 个月\nSKU 范围：全量 SKU\n输出 生产计划文件：1 个\n较上一份 AI 生产计划的差异报告已生成，Markdown 文件已发送。",
        scopeSummary: "全量 SKU",
        completionIntro: "AI 生产计划已生成，Excel 已发送。",
      }).deliveries,
    ).toEqual([
      {
        kind: "file",
        filePath: "/tmp/ai-forecast.xlsx",
      },
      {
        kind: "file",
        filePath: "/tmp/20260409_20260408_diff_report.md",
        text:
          "AI 生产计划已生成，Excel 已发送。\n需求月份：未来 5 个月\nSKU 范围：全量 SKU\n输出 生产计划文件：1 个\n较上一份 AI 生产计划的差异报告已生成，Markdown 文件已发送。",
      },
    ]);
  });

  it("stays silent when the diff report is not generated", () => {
    expect(
      buildJiuyanDirectExportDeliveryPlan({
        kind: "export",
        outcome: "success",
        workbookPath: "/tmp/ai-forecast.xlsx",
        message: "AI 生产计划已生成，Excel 已发送。",
        scopeSummary: "全量 SKU",
        completionIntro: "AI 生产计划已生成，Excel 已发送。",
      }).deliveries,
    ).toEqual([
      {
        kind: "file",
        filePath: "/tmp/ai-forecast.xlsx",
        text: "AI 生产计划已生成，Excel 已发送。",
      },
    ]);
  });
});

describe("buildJiuyanDirectExportStartMessagePreview", () => {
  it("uses the long AI start message for default full-sku AI exports", async () => {
    await expect(
      buildJiuyanDirectExportStartMessagePreview({
        messageText: "/AI生产计划 5个月",
        inputPaths: [],
      }),
    ).resolves.toContain("总共有");
  });

  it("keeps the short message for bounded top-N AI exports", async () => {
    await expect(
      buildJiuyanDirectExportStartMessagePreview({
        messageText: "/AI生产计划 top 100 sku 5 个月",
        inputPaths: [],
      }),
    ).resolves.toBe("正在准备 AI 生产计划，完成后立刻会把结果文件发给你。");
  });
});

describe("buildSalesImportSuccessMessage", () => {
  it("matches the streamlined sales import wording", () => {
    expect(
      buildSalesImportSuccessMessage({
        kind: "sales",
        file_rows: 14998,
        file_sku_count: 2329,
        new_rows: 0,
        new_sku_count: 0,
        updated_rows: 14998,
        current_sales_date: "2026-04-07",
        new_sales_volume: 0,
        new_date_range: {},
        doc_updates: [],
      }),
    ).toBe(
      [
        "销售数据更新成功！",
        "新增销售记录：0 条",
        "覆盖更新记录：14998 条",
        "当前销售数据更新到：2026-04-07",
      ].join("\n"),
    );
  });

  it("omits sales-side detail sections beyond the four core lines", () => {
    expect(
      buildSalesImportSuccessMessage({
        kind: "sales",
        file_rows: 14998,
        file_sku_count: 2329,
        new_rows: 0,
        new_sku_count: 0,
        updated_rows: 14998,
        current_sales_date: "2026-04-07",
        new_sales_volume: 0,
        new_date_range: {
          start: "2026-04-07",
          end: "2026-04-08",
        },
        new_sku_sales: [
          {
            barcode: "6941770827104",
            family: "尤尼吉可|线组",
            sales_volume: 221,
          },
        ],
        doc_updates: [{ file: "foo", count: 1 }],
      }),
    ).toBe(
      [
        "销售数据更新成功！",
        "新增销售记录：0 条",
        "覆盖更新记录：14998 条",
        "当前销售数据更新到：2026-04-07",
      ].join("\n"),
    );
  });

  it("shows a combined skipped invalid data line when invalid rows exist", () => {
    expect(
      buildSalesImportSuccessMessage({
        kind: "sales",
        file_rows: 18302,
        file_sku_count: 3119,
        new_rows: 14638,
        new_sku_count: 0,
        updated_rows: 14997,
        invalid_barcode_count: 7,
        current_sales_date: "2026-04-09",
        new_sales_volume: 0,
        new_date_range: {},
        skipped_new_skus: [{ barcode: "6099040855945", reason: "商品名称为空" }],
        doc_updates: [],
      }),
    ).toBe(
      [
        "销售数据更新成功！",
        "新增销售记录：14638 条",
        "覆盖更新记录：14997 条",
        "跳过无效数据：8 行",
        "当前销售数据更新到：2026-04-09",
      ].join("\n"),
    );
  });
});

describe("buildSkusImportSuccessMessage", () => {
  it("uses the requested inventory update label", () => {
    expect(
      buildSkusImportSuccessMessage({
        kind: "skus",
        processed_rows: 200,
        inventory_updated_sku_count: 200,
        new_sku_count: 5,
        updated_sku_count: 195,
        inventory_snapshot_date: "2026-04-09",
        doc_updates: [],
      }),
    ).toContain("上次库存和在途数据更新时间：2026-04-09");
  });
});
