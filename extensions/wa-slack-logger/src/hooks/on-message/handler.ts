/**
 * WhatsApp Message Hook Handler
 *
 * Triggered on every incoming WhatsApp message.
 * Logs to Slack thread and evaluates auto-reply.
 */

import type { WAMessageContext } from "../../config.js";
import type { SlackLoggerService } from "../../services/slack-logger.js";

/** Hook context provided by OpenClaw runtime */
export interface HookContext {
  /** The incoming message event */
  event: {
    chatJid: string;
    senderJid: string;
    senderName: string;
    groupName?: string;
    isGroup: boolean;
    text: string;
    timestamp: number;
    messageId: string;
    mediaType?: string;
    quotedMessage?: string;
  };
  /** Agent API for generating replies */
  agent: {
    message: (prompt: string) => Promise<{ text: string }>;
  };
  /** Reply to the original message */
  reply: (text: string) => Promise<void>;
  /** Logger */
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

/** Shared reference to the SlackLoggerService (injected by plugin) */
let slackLogger: SlackLoggerService | null = null;

/** Set the shared SlackLoggerService reference */
export function setSlackLogger(service: SlackLoggerService): void {
  slackLogger = service;
}

/** Main hook handler */
export async function handler(ctx: HookContext): Promise<void> {
  if (!slackLogger) {
    ctx.logger.error("SlackLoggerService not initialized");
    return;
  }

  // Build message context
  const waCtx: WAMessageContext = {
    chatJid: ctx.event.chatJid,
    senderJid: ctx.event.senderJid,
    senderName: ctx.event.senderName,
    groupName: ctx.event.groupName,
    isGroup: ctx.event.isGroup,
    text: ctx.event.text,
    timestamp: ctx.event.timestamp,
    messageId: ctx.event.messageId,
    mediaType: ctx.event.mediaType,
    quotedMessage: ctx.event.quotedMessage,
  };

  // Step 1: Always log incoming message to Slack
  await slackLogger.logIncomingMessage(waCtx);

  // Step 2: Evaluate auto-reply
  const { should, reason } = slackLogger.shouldAutoReply(waCtx);

  if (!should) {
    if (reason && reason !== "modo desactivado") {
      // Log skip reason (but not for disabled mode to reduce noise)
      await slackLogger.logSkippedReply(waCtx, reason);
    }
    return;
  }

  // Step 3: Generate contextual auto-reply via agent
  try {
    const prompt = buildReplyPrompt(waCtx);
    const response = await ctx.agent.message(prompt);

    if (!response.text || response.text.trim().length === 0) {
      await slackLogger.logSkippedReply(waCtx, "agente no genero respuesta");
      return;
    }

    // Step 4: Send reply to WhatsApp
    await ctx.reply(response.text);

    // Step 5: Log auto-reply to Slack
    await slackLogger.logAutoReply(waCtx, response.text);

    ctx.logger.info(
      `Auto-reply sent to ${waCtx.isGroup ? waCtx.groupName : waCtx.senderName}: ${response.text.slice(0, 50)}...`
    );
  } catch (err) {
    ctx.logger.error(`Auto-reply failed: ${err}`);
    await slackLogger.logError(
      `Auto-reply failed: ${err}`,
      `Chat: ${waCtx.chatJid}, Message: ${waCtx.text.slice(0, 100)}`
    );
  }
}

/** Build the prompt for the agent to generate a reply */
function buildReplyPrompt(ctx: WAMessageContext): string {
  const parts: string[] = [];

  parts.push("Genera una respuesta corta y natural para este mensaje de WhatsApp.");
  parts.push("");

  if (ctx.isGroup) {
    parts.push(`**Grupo**: ${ctx.groupName ?? ctx.chatJid}`);
    parts.push(`**Remitente**: ${ctx.senderName}`);
    parts.push("**Limite**: maximo 200 caracteres");
  } else {
    parts.push(`**Conversacion con**: ${ctx.senderName}`);
    parts.push("**Limite**: maximo 500 caracteres");
  }

  parts.push("");
  parts.push(`**Mensaje**: ${ctx.text}`);

  if (ctx.quotedMessage) {
    parts.push(`**Citando**: ${ctx.quotedMessage}`);
  }

  parts.push("");
  parts.push("Responde SOLO con el texto de la respuesta, sin explicaciones ni formato adicional.");
  parts.push("Responde en el mismo idioma del mensaje recibido.");

  return parts.join("\n");
}
