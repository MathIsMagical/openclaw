import {
  parseJiuyanExportIntent,
  parseJiuyanImportIntent,
} from "openclaw/plugin-sdk/jiuyan-direct-ops";
import { logger } from "../util/logger.js";
import {
  buildJiuyanDirectExportDeliveryPlan,
  buildJiuyanDirectImportDeliveryPlan,
  executeJiuyanDirectExport,
  executeJiuyanDirectImport,
  isJiuyanScopeInputPath,
  type JiuyanDirectDeliveryPlan,
} from "./jiuyan-direct-ops-runtime.js";
import { sendWeixinMediaFile } from "./send-media.js";
import { sendMessageWeixin } from "./send.js";

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
  skipStartMessage?: boolean;
};

function buildCommonOpts(params: WeixinJiuyanParams) {
  return {
    baseUrl: params.baseUrl,
    token: params.token,
    contextToken: params.contextToken,
  };
}

function collectInputPaths(mediaPath?: string): string[] {
  return mediaPath ? [mediaPath] : [];
}

async function sendJiuyanWeixinDeliveryPlan(
  params: WeixinJiuyanParams,
  plan: JiuyanDirectDeliveryPlan,
): Promise<void> {
  if (params.skipStartMessage !== true) {
    await sendMessageWeixin({
      to: params.to,
      text: plan.startMessage,
      opts: buildCommonOpts(params),
    });
  }

  for (const delivery of plan.deliveries) {
    if (delivery.kind === "text") {
      await sendMessageWeixin({
        to: params.to,
        text: delivery.text,
        opts: buildCommonOpts(params),
      });
      continue;
    }
    await sendWeixinMediaFile({
      filePath: delivery.filePath,
      to: params.to,
      text: delivery.text,
      opts: buildCommonOpts(params),
      cdnBaseUrl: params.cdnBaseUrl,
    });
  }
}

async function maybeHandleJiuyanWeixinDirectImport(params: WeixinJiuyanParams): Promise<boolean> {
  if (!parseJiuyanImportIntent(params.messageText)) {
    return false;
  }

  params.log?.(`weixin[${params.accountId}]: handling Jiuyan import directly`);
  try {
    const result = await executeJiuyanDirectImport({
      messageText: params.messageText,
      inputPaths: collectInputPaths(params.mediaPath),
    });
    if (!result) {
      return false;
    }

    await sendJiuyanWeixinDeliveryPlan(params, buildJiuyanDirectImportDeliveryPlan(result));
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
  const inputPaths = collectInputPaths(params.mediaPath);
  const hasDefaultScopeFile = inputPaths.some((inputPath) => isJiuyanScopeInputPath(inputPath));
  const intent = parseJiuyanExportIntent(params.messageText, {
    defaultFileScope: hasDefaultScopeFile,
  });
  if (!intent) {
    return false;
  }

  params.log?.(`weixin[${params.accountId}]: handling Jiuyan export directly`);
  try {
    await sendMessageWeixin({
      to: params.to,
      text:
        intent.prefix === "/AI生产计划"
          ? "正在准备 AI 生产计划，完成后立刻会把结果文件发给你。"
          : "正在准备生产计划，完成后立刻会把结果文件发给你。",
      opts: buildCommonOpts(params),
    });
    const result = await executeJiuyanDirectExport({
      messageText: params.messageText,
      inputPaths,
    });
    if (!result) {
      return false;
    }
    await sendJiuyanWeixinDeliveryPlan(
      { ...params, skipStartMessage: true },
      buildJiuyanDirectExportDeliveryPlan(result),
    );
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
