import { parseInlineDirectives } from "../../utils/directive-tags.js";

const REPLY_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]\s*/gi;
const LEAKED_THINKING_PREFIX_RE = /^\s*(?:think\b|<think\b|<thinking\b|<thought\b)/i;

function cleanReplyTextAfterLeakedThinkingPrefix(
  text: string | undefined,
  cleaned: string,
  hasReplyTag: boolean,
  currentMessageId: string | undefined,
): string {
  if (!text || !hasReplyTag || !LEAKED_THINKING_PREFIX_RE.test(text)) {
    return cleaned;
  }

  let lastReplyTagEnd: number | undefined;
  for (const match of text.matchAll(REPLY_TAG_RE)) {
    lastReplyTagEnd = (match.index ?? 0) + match[0].length;
  }

  if (lastReplyTagEnd === undefined) {
    return cleaned;
  }

  return parseInlineDirectives(text.slice(lastReplyTagEnd), {
    currentMessageId,
    stripAudioTag: false,
  }).text;
}

export function extractReplyToTag(
  text?: string,
  currentMessageId?: string,
): {
  cleaned: string;
  replyToId?: string;
  replyToCurrent: boolean;
  hasTag: boolean;
} {
  const result = parseInlineDirectives(text, {
    currentMessageId,
    stripAudioTag: false,
  });
  return {
    cleaned: cleanReplyTextAfterLeakedThinkingPrefix(
      text,
      result.text,
      result.hasReplyTag,
      currentMessageId,
    ),
    replyToId: result.replyToId,
    replyToCurrent: result.replyToCurrent,
    hasTag: result.hasReplyTag,
  };
}
