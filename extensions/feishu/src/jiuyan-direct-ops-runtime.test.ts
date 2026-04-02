import { describe, expect, it } from "vitest";
import { buildJiuyanDirectImportDeliveryPlan } from "./jiuyan-direct-ops-runtime.js";

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
