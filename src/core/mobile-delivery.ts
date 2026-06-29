export const MOBILE_RESPONSE_MAX_CHARS = 1200;
export const MOBILE_CHANNEL_PREVIEW_MAX_CHARS = 900;
export const DEFAULT_MOBILE_CHANNEL = "work";
export const MOBILE_OUTBOX_NAMESPACE = "ag_bridge/outbox";

export type MobileDeliveryReason = "ok" | "large" | "code-heavy";

export interface MobileDeliveryMessage {
  delivered: string;
  originalLength: number;
  reason: MobileDeliveryReason;
  truncated: boolean;
}

const CODE_FENCE_RE = /```/;
const CODE_LIKE_LINE_RE = /^\s*(?:[+\-]{3}|@@|\+|\-|import\s|export\s|const\s|let\s|var\s|function\s|class\s|interface\s|type\s|return\s|if\s*\(|for\s*\(|while\s*\(|try\s*\{|catch\s*\(|[}\])];?\s*$|[A-Za-z_$][\w$]*\s*[:=]\s*[^,]+[;,]?\s*$)/;

export type MobileOutboxWriteInput = {
  content: string;
  coordinates: { namespace: string };
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export function mobileSafeResponse(message: string): MobileDeliveryMessage {
  const normalized = normalizeWhitespace(message);
  const reason = classifyMobilePayload(normalized);

  if (reason === "ok" && normalized.length <= MOBILE_RESPONSE_MAX_CHARS) {
    return {
      delivered: normalized,
      originalLength: message.length,
      reason,
      truncated: false,
    };
  }

  if (reason === "code-heavy") {
    const preview = truncateText(nonCodePreview(normalized), MOBILE_RESPONSE_MAX_CHARS);
    return {
      delivered: [
        `Mobile-safe notice: the agent response was ${message.length} characters and appears to contain code or diff output.`,
        "Open the desktop agent for the full delivery.",
        preview ? `Preview:\n${preview}` : undefined,
      ].filter(Boolean).join("\n\n"),
      originalLength: message.length,
      reason,
      truncated: true,
    };
  }

  return {
    delivered: [
      `Mobile-safe preview: the full agent response was ${message.length} characters.`,
      "Open the desktop agent for the complete details.",
      truncateText(normalized, MOBILE_RESPONSE_MAX_CHARS),
    ].join("\n\n"),
    originalLength: message.length,
    reason: "large",
    truncated: true,
  };
}

export function mobileSafeOutboxWrite<T extends MobileOutboxWriteInput>(input: T): T {
  if (input.coordinates.namespace !== MOBILE_OUTBOX_NAMESPACE || input.metadata?.mobileDelivery) {
    return input;
  }

  const mobileMessage = mobileSafeResponse(input.content);
  return {
    ...input,
    content: mobileMessage.delivered,
    tags: ensureTags(input.tags, ["unread", "ag_bridge"]),
    metadata: {
      ...(input.metadata ?? {}),
      status: typeof input.metadata?.status === "string" ? input.metadata.status : "unread",
      mobileDelivery: {
        originalLength: mobileMessage.originalLength,
        deliveredLength: mobileMessage.delivered.length,
        reason: mobileMessage.reason,
        truncated: mobileMessage.truncated,
      },
    },
  };
}

export function mobileChannelPreview(message: string): string {
  return truncateText(normalizeWhitespace(message), MOBILE_CHANNEL_PREVIEW_MAX_CHARS);
}

export function normalizeMobileChannel(channel: unknown, fallback = DEFAULT_MOBILE_CHANNEL): string {
  const fallbackChannel = fallback.trim() || DEFAULT_MOBILE_CHANNEL;
  if (typeof channel !== "string" || !channel.trim()) {
    return fallbackChannel;
  }

  const normalized = channel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return normalized || fallbackChannel;
}

function classifyMobilePayload(message: string): MobileDeliveryReason {
  if (CODE_FENCE_RE.test(message)) {
    return "code-heavy";
  }

  const lines = message.split("\n");
  const codeLikeLines = lines.filter((line) => CODE_LIKE_LINE_RE.test(line)).length;
  const nonBlankLines = lines.filter((line) => line.trim()).length;
  if (codeLikeLines >= 3 && codeLikeLines / Math.max(nonBlankLines, 1) >= 0.35) {
    return "code-heavy";
  }

  if (message.length > 600 && codeLikeLines >= 8) {
    return "code-heavy";
  }

  return message.length > MOBILE_RESPONSE_MAX_CHARS ? "large" : "ok";
}

function nonCodePreview(message: string): string {
  const lines = message
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !CODE_FENCE_RE.test(trimmed) && !CODE_LIKE_LINE_RE.test(trimmed);
    });

  return lines.slice(0, 12).join("\n");
}

function normalizeWhitespace(message: string): string {
  return message.replace(/\r\n/g, "\n").trim();
}

function truncateText(message: string, maxChars: number): string {
  if (message.length <= maxChars) {
    return message;
  }
  return `${message.slice(0, maxChars - 3).trimEnd()}...`;
}

function ensureTags(tags: string[] | undefined, required: string[]): string[] {
  return Array.from(new Set([...(tags ?? []), ...required]));
}
