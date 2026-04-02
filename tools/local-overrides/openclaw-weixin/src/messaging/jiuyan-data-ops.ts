import {
  parseJiuyanExportIntent,
  parseJiuyanImportIntent,
} from "openclaw/plugin-sdk/jiuyan-direct-ops";
import { logger } from "../util/logger.js";
import {
  executeJiuyanDirectExport,
  executeJiuyanDirectImport,
  isJiuyanScopeInputPath,
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

async function maybeHandleJiuyanWeixinDirectImport(params: WeixinJiuyanParams): Promise<boolean> {
  if (!parseJiuyanImportIntent(params.messageText)) {
    return false;
  }

  params.log?.(`weixin[${params.accountId}]: handling Jiuyan import directly`);
  await sendMessageWeixin({
    to: params.to,
    text: "文件已收到，正在准备导入数据，导入完成后会提醒你。",
    opts: buildCommonOpts(params),
  });

  try {
    const result = await executeJiuyanDirectImport({
      messageText: params.messageText,
      inputPaths: collectInputPaths(params.mediaPath),
    });
    if (!result) {
      return false;
    }

    await sendMessageWeixin({
      to: params.to,
      text: result.message,
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
  const inputPaths = collectInputPaths(params.mediaPath);
  const hasDefaultScopeFile = inputPaths.some((inputPath) => isJiuyanScopeInputPath(inputPath));
  if (!parseJiuyanExportIntent(params.messageText, { defaultFileScope: hasDefaultScopeFile })) {
    return false;
  }

  params.log?.(`weixin[${params.accountId}]: handling Jiuyan export directly`);
  await sendMessageWeixin({
    to: params.to,
    text: "正在准备生产计划，完成后立刻会把结果文件发给你。",
    opts: buildCommonOpts(params),
  });

  try {
    const result = await executeJiuyanDirectExport({
      messageText: params.messageText,
      inputPaths,
    });
    if (!result) {
      return false;
    }
    if (result.outcome === "needs_input") {
      await sendMessageWeixin({
        to: params.to,
        text: result.message,
        opts: buildCommonOpts(params),
      });
      return true;
    }

    await sendWeixinMediaFile({
      filePath: result.workbookPath,
      to: params.to,
      text: result.message,
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
