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
  },
  plan: JiuyanDirectDeliveryPlan,
): Promise<void> {
  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: plan.startMessage,
    accountId: params.accountId,
  });

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
      mediaLocalRoots: [JIUYAN_EXPORTS_DIR],
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
  if (!parseJiuyanExportIntent(params.messageText, { defaultFileScope: hasDefaultScopeFile })) {
    return false;
  }

  params.log?.(`feishu[${params.accountId ?? "default"}]: handling Jiuyan export directly`);
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
