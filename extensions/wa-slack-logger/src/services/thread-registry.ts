/**
 * Thread Registry - Maps WhatsApp conversations to Slack threads
 *
 * Persisted to ~/.openclaw/wa-slack-threads.json
 * Cached in memory with periodic flush to disk
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type {
  ThreadEntry,
  ThreadRegistryData,
  ConversationConfig,
  WAMessageContext,
  PluginConfig,
} from "../config.js";
import { parseConfigString } from "../config.js";
import { SlackClient } from "../slack/client.js";
import { formatThreadParent, formatConfigMessage } from "../slack/formatter.js";

export class ThreadRegistry {
  private data: ThreadRegistryData = { version: 1, threads: {} };
  private filePath: string;
  private dirty = false;
  private configCache: Map<string, { config: ConversationConfig; cachedAt: number }> = new Map();
  private configCacheTtl: number;
  private slackClient: SlackClient;
  private defaultConfig: ConversationConfig;

  constructor(
    pluginConfig: PluginConfig,
    slackClient: SlackClient
  ) {
    // Resolve ~ to home directory
    this.filePath = pluginConfig.threadRegistryPath.replace(/^~/, homedir());
    this.filePath = resolve(this.filePath);
    this.configCacheTtl = pluginConfig.configCacheTtlMs;
    this.slackClient = slackClient;
    this.defaultConfig = {
      mode: pluginConfig.defaultMode,
      cooldownMinutes: pluginConfig.defaultCooldownMinutes,
      language: pluginConfig.defaultLanguage,
      keywords: [],
      notes: "",
    };
  }

  /** Load registry from disk */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as ThreadRegistryData;
      if (parsed.version === 1 && parsed.threads) {
        this.data = parsed;
      }
    } catch (err: unknown) {
      // File doesn't exist yet, start fresh
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "ENOENT"
      ) {
        this.data = { version: 1, threads: {} };
      } else {
        throw err;
      }
    }
  }

  /** Save registry to disk */
  async save(): Promise<void> {
    if (!this.dirty) return;

    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    this.dirty = false;
  }

  /** Get or create a Slack thread for a WhatsApp conversation */
  async getOrCreateThread(ctx: WAMessageContext): Promise<ThreadEntry> {
    const existing = this.data.threads[ctx.chatJid];
    if (existing) {
      return existing;
    }

    // Create new Slack thread
    const { text, blocks } = formatThreadParent(ctx);
    const threadTs = await this.slackClient.createThread(text, blocks);

    // Pin default config message in the thread
    const configText = formatConfigMessage(this.defaultConfig);
    const configTs = await this.slackClient.postThreadMessage(threadTs, configText);
    // Note: pinning in threads requires channel-level pin, which may not work
    // for thread replies. Config is tracked by convention (first message format).

    const entry: ThreadEntry = {
      chatJid: ctx.chatJid,
      slackThreadTs: threadTs,
      name: ctx.isGroup ? (ctx.groupName ?? ctx.chatJid) : ctx.senderName,
      type: ctx.isGroup ? "group" : "dm",
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      messageCount: 0,
      config: { ...this.defaultConfig },
    };

    this.data.threads[ctx.chatJid] = entry;
    this.dirty = true;

    return entry;
  }

  /** Get thread entry by chat JID (or null if not found) */
  getThread(chatJid: string): ThreadEntry | null {
    return this.data.threads[chatJid] ?? null;
  }

  /** Update thread metadata after a message */
  updateAfterMessage(chatJid: string): void {
    const entry = this.data.threads[chatJid];
    if (!entry) return;

    entry.lastMessageAt = new Date().toISOString();
    entry.messageCount += 1;
    this.dirty = true;
  }

  /** Get conversation config (cached) */
  getConfig(chatJid: string): ConversationConfig {
    // Check cache
    const cached = this.configCache.get(chatJid);
    if (cached && Date.now() - cached.cachedAt < this.configCacheTtl) {
      return cached.config;
    }

    // Fallback to stored config
    const entry = this.data.threads[chatJid];
    const config = entry?.config ?? { ...this.defaultConfig };

    this.configCache.set(chatJid, { config, cachedAt: Date.now() });
    return config;
  }

  /** Update conversation config */
  updateConfig(chatJid: string, partial: Partial<ConversationConfig>): void {
    const entry = this.data.threads[chatJid];
    if (!entry) return;

    entry.config = { ...entry.config, ...partial };
    this.configCache.set(chatJid, { config: entry.config, cachedAt: Date.now() });
    this.dirty = true;
  }

  /** Parse and apply config from a raw string (Slack message) */
  applyConfigFromString(chatJid: string, raw: string): void {
    const parsed = parseConfigString(raw);
    if (Object.keys(parsed).length > 0) {
      this.updateConfig(chatJid, parsed);
    }
  }

  /** Get all active threads (for summaries) */
  getActiveThreads(): ThreadEntry[] {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    return Object.values(this.data.threads).filter(
      (t) => new Date(t.lastMessageAt).getTime() > oneDayAgo
    );
  }

  /** Get all threads */
  getAllThreads(): ThreadEntry[] {
    return Object.values(this.data.threads);
  }

  /** Get thread count */
  get size(): number {
    return Object.keys(this.data.threads).length;
  }

  /** Check registry integrity */
  validate(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    for (const [jid, entry] of Object.entries(this.data.threads)) {
      if (!entry.slackThreadTs) {
        issues.push(`Thread ${jid}: missing slackThreadTs`);
      }
      if (!entry.name) {
        issues.push(`Thread ${jid}: missing name`);
      }
      if (!["group", "dm"].includes(entry.type)) {
        issues.push(`Thread ${jid}: invalid type "${entry.type}"`);
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
