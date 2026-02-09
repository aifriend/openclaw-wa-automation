/**
 * Slack Logger Background Service
 *
 * Manages the message queue, batch writes to Slack,
 * and coordinates with the thread registry.
 */

import type { PluginConfig, QueuedSlackMessage, WAMessageContext } from "../config.js";
import { SlackClient } from "../slack/client.js";
import {
  formatIncomingMessage,
  formatAutoReply,
  formatSkippedReply,
  formatError,
  formatDailySummary,
} from "../slack/formatter.js";
import { ThreadRegistry } from "./thread-registry.js";

export interface SlackLoggerOptions {
  pluginConfig: PluginConfig;
  slackClient: SlackClient;
  threadRegistry: ThreadRegistry;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export class SlackLoggerService {
  private queue: QueuedSlackMessage[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private config: PluginConfig;
  private slack: SlackClient;
  private registry: ThreadRegistry;
  private logger: SlackLoggerOptions["logger"];
  private lastReplyTime: Map<string, number> = new Map();
  private running = false;

  constructor(options: SlackLoggerOptions) {
    this.config = options.pluginConfig;
    this.slack = options.slackClient;
    this.registry = options.threadRegistry;
    this.logger = options.logger;
  }

  /** Start the background service */
  async start(): Promise<void> {
    this.logger.info("SlackLoggerService: Starting...");

    // Load thread registry from disk
    await this.registry.load();
    this.logger.info(`SlackLoggerService: Loaded ${this.registry.size} threads`);

    // Verify Slack connection
    const connected = await this.slack.testConnection();
    if (!connected) {
      this.logger.error("SlackLoggerService: Failed to connect to Slack!");
      throw new Error("Slack connection failed. Check SLACK_BOT_TOKEN.");
    }
    this.logger.info("SlackLoggerService: Slack connection verified");

    // Start batch flush interval
    this.flushInterval = setInterval(
      () => this.flushQueue().catch((e) => this.logger.error(`Flush error: ${e}`)),
      this.config.batchFlushIntervalMs
    );

    // Persist registry every 30 seconds
    this.saveInterval = setInterval(
      () => this.registry.save().catch((e) => this.logger.error(`Save error: ${e}`)),
      30_000
    );

    this.running = true;
    this.logger.info("SlackLoggerService: Ready");
  }

  /** Stop the background service */
  async stop(): Promise<void> {
    this.logger.info("SlackLoggerService: Stopping...");
    this.running = false;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    // Final flush
    await this.flushQueue();
    await this.registry.save();

    this.logger.info("SlackLoggerService: Stopped");
  }

  /** Log an incoming WhatsApp message to Slack */
  async logIncomingMessage(ctx: WAMessageContext): Promise<void> {
    try {
      const thread = await this.registry.getOrCreateThread(ctx);
      const { text, blocks } = formatIncomingMessage(ctx);

      this.enqueue({
        threadTs: thread.slackThreadTs,
        text,
        blocks,
        timestamp: ctx.timestamp,
      });

      this.registry.updateAfterMessage(ctx.chatJid);
    } catch (err) {
      this.logger.error(`logIncomingMessage error: ${err}`);
    }
  }

  /** Log an auto-reply to Slack */
  async logAutoReply(
    ctx: WAMessageContext,
    replyText: string,
    confidence?: number
  ): Promise<void> {
    try {
      const thread = this.registry.getThread(ctx.chatJid);
      if (!thread) return;

      const { text, blocks } = formatAutoReply(replyText, ctx, confidence);

      this.enqueue({
        threadTs: thread.slackThreadTs,
        text,
        blocks,
        timestamp: Date.now(),
      });

      // Track last reply time for cooldown
      this.lastReplyTime.set(ctx.chatJid, Date.now());
    } catch (err) {
      this.logger.error(`logAutoReply error: ${err}`);
    }
  }

  /** Log a skipped reply to Slack */
  async logSkippedReply(ctx: WAMessageContext, reason: string): Promise<void> {
    try {
      const thread = this.registry.getThread(ctx.chatJid);
      if (!thread) return;

      const { text, blocks } = formatSkippedReply(reason, ctx);

      this.enqueue({
        threadTs: thread.slackThreadTs,
        text,
        blocks,
        timestamp: Date.now(),
      });
    } catch (err) {
      this.logger.error(`logSkippedReply error: ${err}`);
    }
  }

  /** Log an error to Slack channel (not thread) */
  async logError(error: string, context?: string): Promise<void> {
    try {
      const { text, blocks } = formatError(error, context);
      await this.slack.createThread(text, blocks);
    } catch (err) {
      this.logger.error(`logError error: ${err}`);
    }
  }

  /** Post a daily summary to a conversation's thread */
  async postDailySummary(
    chatJid: string,
    date: string,
    messageCount: number,
    autoReplyCount: number,
    topics: string[],
    summary: string
  ): Promise<void> {
    const thread = this.registry.getThread(chatJid);
    if (!thread) return;

    const { text, blocks } = formatDailySummary(
      date,
      messageCount,
      autoReplyCount,
      topics,
      summary
    );

    await this.slack.postThreadMessage(thread.slackThreadTs, text, blocks);
  }

  /** Check if cooldown has passed for a conversation */
  isCooldownActive(chatJid: string): boolean {
    const lastReply = this.lastReplyTime.get(chatJid);
    if (!lastReply) return false;

    const config = this.registry.getConfig(chatJid);
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    return Date.now() - lastReply < cooldownMs;
  }

  /** Determine if a message should trigger auto-reply */
  shouldAutoReply(ctx: WAMessageContext): { should: boolean; reason?: string } {
    const config = this.registry.getConfig(ctx.chatJid);

    // Mode check
    switch (config.mode) {
      case "desactivado":
        return { should: false, reason: "modo desactivado" };

      case "todos":
        break;

      case "solo_preguntas":
        if (!this.isQuestion(ctx.text)) {
          return { should: false, reason: "no es una pregunta" };
        }
        break;

      case "palabras_clave":
        if (!this.matchesKeywords(ctx.text, config.keywords)) {
          return { should: false, reason: "no contiene palabras clave" };
        }
        break;
    }

    // Cooldown check
    if (this.isCooldownActive(ctx.chatJid)) {
      return { should: false, reason: "cooldown activo" };
    }

    // Skip system messages, empty messages, media-only
    if (!ctx.text || ctx.text.trim().length === 0) {
      return { should: false, reason: "mensaje vacio" };
    }

    return { should: true };
  }

  /** Check if text contains a question */
  private isQuestion(text: string): boolean {
    const questionPatterns = [
      /\?/,
      /^[¿\u00bf]/,
      /\b(qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|qui[eé]n|cu[aá]l|cu[aá]nto|por qu[eé])\b/i,
      /\b(what|how|when|where|who|which|why|can|could|would|should|is|are|do|does)\b/i,
      /\b(alguien sabe|alguno sabe|saben|conocen)\b/i,
    ];

    return questionPatterns.some((p) => p.test(text));
  }

  /** Check if text matches any keywords */
  private matchesKeywords(text: string, keywords: string[]): boolean {
    const lower = text.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  }

  /** Add a message to the batch queue */
  private enqueue(msg: QueuedSlackMessage): void {
    this.queue.push(msg);

    // Flush immediately if batch size reached
    if (this.queue.length >= this.config.batchMaxSize) {
      this.flushQueue().catch((e) => this.logger.error(`Flush error: ${e}`));
    }
  }

  /** Flush the message queue to Slack */
  private async flushQueue(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.config.batchMaxSize);

    for (const msg of batch) {
      try {
        await this.slack.postThreadMessage(msg.threadTs, msg.text, msg.blocks);
      } catch (err) {
        this.logger.error(`Failed to post to Slack thread ${msg.threadTs}: ${err}`);
        // Re-queue failed messages (limited retry)
        if (!("_retried" in msg)) {
          this.queue.push({ ...msg, _retried: true } as QueuedSlackMessage & { _retried: boolean });
        }
      }
    }
  }

  /** Get service status */
  getStatus(): {
    running: boolean;
    queueSize: number;
    threadCount: number;
    activeThreads: number;
  } {
    return {
      running: this.running,
      queueSize: this.queue.length,
      threadCount: this.registry.size,
      activeThreads: this.registry.getActiveThreads().length,
    };
  }

  /** Health check */
  async healthCheck(): Promise<{ healthy: boolean; issues: string[] }> {
    const issues: string[] = [];

    // Check Slack connection
    const connected = await this.slack.testConnection();
    if (!connected) {
      issues.push("Slack connection failed");
    }

    // Check registry integrity
    const validation = this.registry.validate();
    issues.push(...validation.issues);

    // Check queue size (alert if backed up)
    if (this.queue.length > 50) {
      issues.push(`Message queue backed up: ${this.queue.length} pending`);
    }

    return { healthy: issues.length === 0, issues };
  }
}
