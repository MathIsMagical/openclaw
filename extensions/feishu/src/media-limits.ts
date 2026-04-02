import { hasJiuyanDirectOpsCommand } from "openclaw/plugin-sdk/jiuyan-direct-ops";

export const DEFAULT_FEISHU_MEDIA_MAX_MB = 30;
export const JIUYAN_DIRECT_OPS_MEDIA_MIN_MB = 100;

export function resolveInboundFeishuMediaMaxMb(params: {
  messageText: string;
  configuredMaxMb?: number;
}): number {
  const baseMaxMb = params.configuredMaxMb ?? DEFAULT_FEISHU_MEDIA_MAX_MB;
  return hasJiuyanDirectOpsCommand(params.messageText)
    ? Math.max(baseMaxMb, JIUYAN_DIRECT_OPS_MEDIA_MIN_MB)
    : baseMaxMb;
}
