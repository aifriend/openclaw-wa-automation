/**
 * Slack Block Kit message formatter
 *
 * Formats WhatsApp messages, auto-replies, and summaries
 * using Slack's Block Kit for rich display.
 */

import type { WAMessageContext, ConversationConfig } from "../config.js";

const TIMEZONE = "America/Lima";
const MAX_TEXT_LENGTH = 2900; // Slack limit is 3000 per block, leave margin

/** Format a timestamp to Lima timezone */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("es-PE", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format a date to Lima timezone */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("es-PE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** Truncate text to fit Slack limits */
function truncate(text: string, max = MAX_TEXT_LENGTH): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

/** Create parent message for a new WhatsApp conversation thread */
export function formatThreadParent(ctx: WAMessageContext): {
  text: string;
  blocks: unknown[];
} {
  const icon = ctx.isGroup ? "\u{1f4f1}" : "\u{1f4ac}";
  const type = ctx.isGroup ? "Grupo" : "DM";
  const name = ctx.isGroup ? ctx.groupName ?? ctx.chatJid : ctx.senderName;

  const text = `${icon} ${type}: ${name}`;

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${icon} ${type}: ${name}`,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*JID:* \`${ctx.chatJid}\` | *Creado:* ${formatDate(Date.now())} ${formatTime(Date.now())}`,
        },
      ],
    },
    {
      type: "divider",
    },
  ];

  return { text, blocks };
}

/** Format an incoming WhatsApp message for Slack thread */
export function formatIncomingMessage(ctx: WAMessageContext): {
  text: string;
  blocks: unknown[];
} {
  const time = formatTime(ctx.timestamp);
  const sender = ctx.senderName || ctx.senderJid.split("@")[0];
  const body = truncate(ctx.text);

  const text = `[${time}] ${sender}: ${body}`;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${sender}* _${time}_\n${body}`,
      },
    },
  ];

  // Add media indicator if present
  if (ctx.mediaType) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `\u{1f4ce} _Adjunto: ${ctx.mediaType}_`,
        },
      ],
    } as (typeof blocks)[0]);
  }

  return { text, blocks };
}

/** Format an auto-reply for Slack thread */
export function formatAutoReply(
  replyText: string,
  originalCtx: WAMessageContext,
  confidence?: number
): {
  text: string;
  blocks: unknown[];
} {
  const time = formatTime(Date.now());
  const body = truncate(replyText);

  const text = `[${time}] \u{1f916} Auto: ${body}`;

  const confidenceText = confidence !== undefined ? ` | Confianza: ${Math.round(confidence * 100)}%` : "";

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `\u{1f916} *Auto-respuesta* _${time}_\n${body}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `En respuesta a: _${truncate(originalCtx.text, 100)}_${confidenceText}`,
        },
      ],
    },
  ];

  return { text, blocks };
}

/** Format a skipped auto-reply (logged but not sent) */
export function formatSkippedReply(reason: string, ctx: WAMessageContext): {
  text: string;
  blocks: unknown[];
} {
  const time = formatTime(ctx.timestamp);

  const text = `[${time}] \u{23ed}\u{fe0f} Omitido: ${reason}`;

  const blocks = [
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `\u{23ed}\u{fe0f} _${time}_ Auto-respuesta omitida: ${reason}`,
        },
      ],
    },
  ];

  return { text, blocks };
}

/** Format a daily summary for a conversation thread */
export function formatDailySummary(
  date: string,
  messageCount: number,
  autoReplyCount: number,
  topics: string[],
  summary: string
): {
  text: string;
  blocks: unknown[];
} {
  const text = `\u{1f4ca} Resumen ${date}: ${messageCount} mensajes, ${autoReplyCount} auto-respuestas`;

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `\u{1f4ca} Resumen Diario - ${date}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Mensajes:*\n${messageCount}`,
        },
        {
          type: "mrkdwn",
          text: `*Auto-respuestas:*\n${autoReplyCount}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Temas principales:*\n${topics.length > 0 ? topics.map((t) => `\u{2022} ${t}`).join("\n") : "_Sin temas destacados_"}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Resumen:*\n${truncate(summary)}`,
      },
    },
    {
      type: "divider",
    },
  ];

  return { text, blocks };
}

/** Format a weekly report (posted as new message in channel) */
export function formatWeeklyReport(
  weekStart: string,
  weekEnd: string,
  totalMessages: number,
  totalAutoReplies: number,
  activeConversations: number,
  topConversations: Array<{ name: string; count: number }>,
  highlights: string
): {
  text: string;
  blocks: unknown[];
} {
  const text = `\u{1f4c8} Reporte Semanal ${weekStart} - ${weekEnd}`;

  const topList = topConversations
    .slice(0, 5)
    .map((c, i) => `${i + 1}. ${c.name} (${c.count} msgs)`)
    .join("\n");

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `\u{1f4c8} Reporte Semanal: ${weekStart} \u{2192} ${weekEnd}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total Mensajes:*\n${totalMessages}` },
        { type: "mrkdwn", text: `*Auto-respuestas:*\n${totalAutoReplies}` },
        { type: "mrkdwn", text: `*Conversaciones Activas:*\n${activeConversations}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Conversaciones mas activas:*\n${topList || "_Sin datos_"}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Highlights:*\n${truncate(highlights)}`,
      },
    },
    {
      type: "divider",
    },
  ];

  return { text, blocks };
}

/** Format an error notification */
export function formatError(error: string, context?: string): {
  text: string;
  blocks: unknown[];
} {
  const time = formatTime(Date.now());

  const text = `\u{26a0}\u{fe0f} Error: ${error}`;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `\u{26a0}\u{fe0f} *Error* _${time}_\n\`\`\`${truncate(error, 500)}\`\`\``,
      },
    },
  ];

  if (context) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Contexto: ${truncate(context, 200)}`,
        },
      ],
    } as (typeof blocks)[0]);
  }

  return { text, blocks };
}

/** Format the default config pinned message */
export function formatConfigMessage(config: ConversationConfig): string {
  const parts = [
    `modo=${config.mode}`,
    `cooldown=${config.cooldownMinutes}min`,
    `idioma=${config.language}`,
  ];
  if (config.keywords.length > 0) {
    parts.push(`keywords=${config.keywords.join(",")}`);
  }
  if (config.notes) {
    parts.push(`notas=${config.notes}`);
  }
  return `\u{1f4cb} Config: ${parts.join(" | ")}`;
}
