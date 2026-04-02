import {
  hasJiuyanDirectOpsCommand,
  parseJiuyanExportIntent,
  parseJiuyanImportIntent,
} from "openclaw/plugin-sdk/jiuyan-direct-ops";
import type { ClawdbotConfig } from "../runtime-api.js";
import {
  executeJiuyanDirectExport,
  executeJiuyanDirectImport,
  isJiuyanScopeInputPath,
  JIUYAN_EXPORTS_DIR,
} from "./jiuyan-direct-ops-runtime.js";
import { sendMediaFeishu } from "./media.js";
import { sendMessageFeishu } from "./send.js";
import type { FeishuMediaInfo } from "./types.js";

function collectInputPaths(
  mediaList: readonly FeishuMediaInfo[],
  quotedMediaList?: readonly FeishuMediaInfo[],
): string[] {
  return [...mediaList, ...(quotedMediaList ?? [])].map((media) => media.path);
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
  if (!parseJiuyanImportIntent(params.messageText)) {
    return false;
  }

  params.log?.(`feishu[${params.accountId ?? "default"}]: handling Jiuyan import directly`);
  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: "文件已收到，正在准备导入数据，导入完成后会提醒你。",
    accountId: params.accountId,
  });

  const result = await executeJiuyanDirectImport({
    messageText: params.messageText,
    inputPaths: collectInputPaths(params.mediaList, params.quotedMediaList),
  });
  if (!result) {
    return false;
  }

  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: result.message,
    replyToMessageId: params.replyToMessageId,
    replyInThread: params.replyInThread,
    accountId: params.accountId,
  });
  return true;
}

async function maybeHandleJiuyanFeishuDirectExport(params: {
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
  const inputPaths = collectInputPaths(params.mediaList, params.quotedMediaList);
  const hasDefaultScopeFile = inputPaths.some((inputPath) => isJiuyanScopeInputPath(inputPath));
  if (!parseJiuyanExportIntent(params.messageText, { defaultFileScope: hasDefaultScopeFile })) {
    return false;
  }

  params.log?.(`feishu[${params.accountId ?? "default"}]: handling Jiuyan export directly`);
  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: "正在准备生产计划，完成后立刻会把结果文件发给你。",
    accountId: params.accountId,
  });

  const result = await executeJiuyanDirectExport({
    messageText: params.messageText,
    inputPaths,
  });
  if (!result) {
    return false;
  }
  if (result.outcome === "needs_input") {
    await sendMessageFeishu({
      cfg: params.cfg,
      to: `chat:${params.chatId}`,
      text: result.message,
      replyToMessageId: params.replyToMessageId,
      replyInThread: params.replyInThread,
      accountId: params.accountId,
    });
    return true;
  }

  await sendMediaFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    mediaUrl: result.workbookPath,
    replyToMessageId: params.replyToMessageId,
    replyInThread: params.replyInThread,
    accountId: params.accountId,
    mediaLocalRoots: [JIUYAN_EXPORTS_DIR],
  });
  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: result.message,
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
  if (!hasJiuyanDirectOpsCommand(params.messageText)) {
    return false;
  }
  if (await maybeHandleJiuyanFeishuDirectImport(params)) {
    return true;
  }
  return await maybeHandleJiuyanFeishuDirectExport(params);
}
