import {
  hasJiuyanDirectOpsCommand,
  parseJiuyanExportIntent,
  parseJiuyanImportIntent,
} from "openclaw/plugin-sdk/jiuyan-direct-ops";
import type { ClawdbotConfig } from "../runtime-api.js";
import {
  buildJiuyanDirectExportDeliveryPlan,
  buildJiuyanDirectImportDeliveryPlan,
  executeJiuyanDirectExport,
  executeJiuyanDirectImport,
  isJiuyanScopeInputPath,
  JIUYAN_EXPORTS_DIR,
  TIMESFM_OUTPUTS_DIR,
  type JiuyanDirectDeliveryPlan,
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

async function sendJiuyanFeishuDeliveryPlan(
  params: {
    cfg: ClawdbotConfig;
    accountId?: string;
    chatId: string;
    replyToMessageId: string;
    replyInThread: boolean;
    skipStartMessage?: boolean;
  },
  plan: JiuyanDirectDeliveryPlan,
): Promise<void> {
  if (!params.skipStartMessage) {
    await sendMessageFeishu({
      cfg: params.cfg,
      to: `chat:${params.chatId}`,
      text: plan.startMessage,
      accountId: params.accountId,
    });
  }

  for (const delivery of plan.deliveries) {
    if (delivery.kind === "text") {
      await sendMessageFeishu({
        cfg: params.cfg,
        to: `chat:${params.chatId}`,
        text: delivery.text,
        replyToMessageId: params.replyToMessageId,
        replyInThread: params.replyInThread,
        accountId: params.accountId,
      });
      continue;
    }
    await sendMediaFeishu({
      cfg: params.cfg,
      to: `chat:${params.chatId}`,
      mediaUrl: delivery.filePath,
      replyToMessageId: params.replyToMessageId,
      replyInThread: params.replyInThread,
      accountId: params.accountId,
      mediaLocalRoots: [JIUYAN_EXPORTS_DIR, TIMESFM_OUTPUTS_DIR],
    });
    if (delivery.text) {
      await sendMessageFeishu({
        cfg: params.cfg,
        to: `chat:${params.chatId}`,
        text: delivery.text,
        replyToMessageId: params.replyToMessageId,
        replyInThread: params.replyInThread,
        accountId: params.accountId,
      });
    }
  }
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
  const result = await executeJiuyanDirectImport({
    messageText: params.messageText,
    inputPaths: collectInputPaths(params.mediaList, params.quotedMediaList),
  });
  if (!result) {
    return false;
  }

  await sendJiuyanFeishuDeliveryPlan(
    {
      cfg: params.cfg,
      accountId: params.accountId,
      chatId: params.chatId,
      replyToMessageId: params.replyToMessageId,
      replyInThread: params.replyInThread,
    },
    buildJiuyanDirectImportDeliveryPlan(result),
  );
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
    text:
      intent.prefix === "/AI生产计划"
        ? "正在准备 AI 生产计划，完成后立刻会把结果文件发给你。"
        : "正在准备生产计划，完成后立刻会把结果文件发给你。",
    accountId: params.accountId,
  });
  const result = await executeJiuyanDirectExport({
    messageText: params.messageText,
    inputPaths,
  });
  if (!result) {
    return false;
  }

  await sendJiuyanFeishuDeliveryPlan(
    {
      cfg: params.cfg,
      accountId: params.accountId,
      chatId: params.chatId,
      replyToMessageId: params.replyToMessageId,
      replyInThread: params.replyInThread,
      skipStartMessage: true,
    },
    buildJiuyanDirectExportDeliveryPlan(result),
  );
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
  commandAuthorizationConfigured?: boolean;
  mediaList: readonly FeishuMediaInfo[];
  quotedMediaList?: readonly FeishuMediaInfo[];
  log?: (message: string) => void;
}): Promise<boolean> {
  if (params.commandAuthorizationConfigured && params.commandAuthorized === false) {
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
