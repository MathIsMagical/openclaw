function normalizeSkuToken(text: string): string {
  return text.replace(/\s+/gi, " ").trim();
}

export type JiuyanExportIntent = {
  prefix: "/生产计划" | "/销量计算" | "/公式计算" | "/公式预测" | "/公式预测销量" | "/公式计算销量";
  months?: number;
  yesterdayTop?: number;
  lastMonthTop?: number;
  fileScope: boolean;
};

export type JiuyanImportIntent = {
  prefix:
    | "/导入数据库"
    | "/数据库导入"
    | "/更新数据库"
    | "/数据库更新"
    | "/导入数据"
    | "/更新数据"
    | "/导入"
    | "/更新";
};

type ParseJiuyanExportIntentOptions = {
  defaultFileScope?: boolean;
};

const JIUYAN_IMPORT_PREFIXES = [
  "/导入数据库",
  "/数据库导入",
  "/更新数据库",
  "/数据库更新",
  "/导入数据",
  "/更新数据",
  "/导入",
  "/更新",
] as const;

const JIUYAN_EXPORT_PREFIXES = [
  "/生产计划",
  "/销量计算",
  "/公式预测销量",
  "/公式计算销量",
  "/公式计算",
  "/公式预测",
] as const;

const JIUYAN_IMPORT_PREFIXES_BY_LENGTH = [...JIUYAN_IMPORT_PREFIXES].toSorted(
  (left, right) => right.length - left.length,
);
const JIUYAN_EXPORT_PREFIXES_BY_LENGTH = [...JIUYAN_EXPORT_PREFIXES].toSorted(
  (left, right) => right.length - left.length,
);

function findLongestMatchingPrefix<const TPrefix extends readonly string[]>(
  prefixes: TPrefix,
  text: string,
): TPrefix[number] | undefined {
  return prefixes.find((candidate) => text.startsWith(candidate));
}

export function parseJiuyanExportIntent(
  messageText: string,
  options: ParseJiuyanExportIntentOptions = {},
): JiuyanExportIntent | null {
  const trimmed = messageText.trim();
  const prefix = findLongestMatchingPrefix(JIUYAN_EXPORT_PREFIXES_BY_LENGTH, trimmed);
  if (!prefix) {
    return null;
  }

  const remainder = trimmed.slice(prefix.length).trim();
  const normalized = normalizeSkuToken(remainder);
  const hasExportIntent =
    normalized.length === 0 ||
    /计算需求|更新生产计划表|更新生产计划|计算销量/i.test(normalized) ||
    /top\s*\d+(?:\s*sku)?/i.test(normalized) ||
    /表中\s*sku/i.test(normalized) ||
    /未来?\s*\d+\s*个?月/i.test(normalized);
  if (!hasExportIntent) {
    return null;
  }

  const monthsMatch = normalized.match(/(?:未来\s*)?(\d+)\s*个?月/i);
  const yesterdayTopMatch = normalized.match(/昨天\s*top\s*(\d+)(?:\s*sku)?/i);
  const lastMonthTopMatch = normalized.match(/上个月\s*top\s*(\d+)(?:\s*sku)?/i);
  const plainTopMatch = normalized.match(/top\s*(\d+)(?:\s*sku)?/i);
  const fileScope =
    /表中\s*sku/i.test(normalized) || (options.defaultFileScope === true && prefix === "/生产计划");

  return {
    prefix,
    ...(monthsMatch ? { months: Number.parseInt(monthsMatch[1] ?? "", 10) } : {}),
    ...(yesterdayTopMatch
      ? { yesterdayTop: Number.parseInt(yesterdayTopMatch[1] ?? "", 10) }
      : lastMonthTopMatch
        ? { lastMonthTop: Number.parseInt(lastMonthTopMatch[1] ?? "", 10) }
        : plainTopMatch
          ? { yesterdayTop: Number.parseInt(plainTopMatch[1] ?? "", 10) }
          : {}),
    fileScope,
  };
}

export function parseJiuyanImportIntent(messageText: string): JiuyanImportIntent | null {
  const trimmed = messageText.trim();
  const prefix = findLongestMatchingPrefix(JIUYAN_IMPORT_PREFIXES_BY_LENGTH, trimmed);
  if (!prefix) {
    return null;
  }
  return { prefix };
}

export function hasJiuyanDirectOpsCommand(messageText: string): boolean {
  return (
    parseJiuyanImportIntent(messageText) !== null || parseJiuyanExportIntent(messageText) !== null
  );
}
