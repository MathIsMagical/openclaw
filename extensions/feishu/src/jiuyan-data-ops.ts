import {
  hasJiuyanDirectOpsCommand,
  parseJiuyanExportIntent,
  parseJiuyanImportIntent,
} from "openclaw/plugin-sdk/jiuyan-direct-ops";
import type { ClawdbotConfig } from "../runtime-api.js";
import {
  buildJiuyanDirectExportStartMessagePreview,
  buildJiuyanDirectExportDeliveryPlan,
  buildJiuyanDirectImportDeliveryPlan,
  executeJiuyanDirectExport,
  executeJiuyanDirectImport,
  isJiuyanImportInputPath,
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

function isStandaloneJiuyanFileMessage(
  messageText: string,
  mediaList: readonly FeishuMediaInfo[],
): boolean {
  if (mediaList.length === 0) {
    return false;
  }
  if (!mediaList.some((media) => isJiuyanImportInputPath(media.path))) {
    return false;
  }

  const trimmed = messageText.trim();
  if (!trimmed) {
    return true;
  }
  if (/\.(xlsx|xls|csv|zip)$/i.test(trimmed)) {
    return true;
  }

  try {
    const parsed = JSON.parse(trimmed) as { file_key?: unknown; file_name?: unknown };
    return typeof parsed.file_key === "string" && typeof parsed.file_name === "string";
  } catch {
    return false;
  }
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
  if (!params.skipStartMessage && plan.startMessage.trim()) {
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
  const inputPaths = collectInputPaths(params.mediaList, params.quotedMediaList);
  const startedImport = inputPaths.length > 0;
  if (startedImport) {
    await sendMessageFeishu({
      cfg: params.cfg,
      to: `chat:${params.chatId}`,
      text: "文件已收到，正在准备导入数据，导入完成后会提醒你。",
      accountId: params.accountId,
    });
  }
  const result = await executeJiuyanDirectImport({
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
      skipStartMessage: startedImport,
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
  const startMessage = await buildJiuyanDirectExportStartMessagePreview({
    messageText: params.messageText,
    inputPaths,
  });
  await sendMessageFeishu({
    cfg: params.cfg,
    to: `chat:${params.chatId}`,
    text: startMessage,
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
  if (isStandaloneJiuyanFileMessage(params.messageText, params.mediaList)) {
    await sendMessageFeishu({
      cfg: params.cfg,
      to: `chat:${params.chatId}`,
      text: "文件已收到。请回复 /更新数据 开始导入，或回复 /生产计划 使用表中 SKU 生成生产计划。",
      replyToMessageId: params.replyToMessageId,
      replyInThread: params.replyInThread,
      accountId: params.accountId,
    });
    params.log?.(`feishu[${params.accountId ?? "default"}]: intercepted standalone Jiuyan file message`);
    return true;
  }
  if (!hasJiuyanDirectOpsCommand(params.messageText)) {
    return false;
  }
  if (await maybeHandleJiuyanFeishuDirectImport(params)) {
    return true;
  }
  return await maybeHandleJiuyanFeishuDirectExport(params);
}
