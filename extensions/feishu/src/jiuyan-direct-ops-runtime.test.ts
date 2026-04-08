import { describe, expect, it } from "vitest";
import {
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
  it("appends the markdown diff report after AI workbook deliveries", () => {
    expect(
      buildJiuyanDirectExportDeliveryPlan({
        kind: "export",
        outcome: "success",
        workbookPaths: ["/tmp/ai-forecast.xlsx"],
        diffReportPath: "/tmp/20260409_20260408_diff_report.md",
        message: "AI 生产计划已生成，Excel 已发送。\nAI 差异报告已生成，Markdown 已发送。",
        scopeSummary: "默认范围",
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
        text: "AI 生产计划已生成，Excel 已发送。\nAI 差异报告已生成，Markdown 已发送。",
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
        scopeSummary: "默认范围",
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
