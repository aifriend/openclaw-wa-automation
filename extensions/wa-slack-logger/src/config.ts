/**
 * Plugin configuration types for wa-slack-logger
 */

/** Reply mode per conversation */
export type ReplyMode = "todos" | "solo_preguntas" | "palabras_clave" | "desactivado";

/** Language setting per conversation */
export type LanguageSetting = "espanol" | "ingles" | "auto";

/** Per-conversation configuration (parsed from Slack pinned message) */
export interface ConversationConfig {
  mode: ReplyMode;
  cooldownMinutes: number;
  language: LanguageSetting;
  keywords: string[];
  notes: string;
}

/** Plugin-level configuration (from openclaw.json plugins.entries) */
export interface PluginConfig {
  slackChannel: string;
  defaultMode: ReplyMode;
  defaultCooldownMinutes: number;
  defaultLanguage: LanguageSetting;
  batchFlushIntervalMs: number;
  batchMaxSize: number;
  configCacheTtlMs: number;
  threadRegistryPath: string;
}

/** Default plugin configuration values */
export const DEFAULT_CONFIG: PluginConfig = {
  slackChannel: "",
  defaultMode: "desactivado",
  defaultCooldownMinutes: 5,
  defaultLanguage: "auto",
  batchFlushIntervalMs: 2000,
  batchMaxSize: 5,
  configCacheTtlMs: 300_000, // 5 minutes
  threadRegistryPath: "~/.openclaw/wa-slack-threads.json",
};

/** Thread registry entry (persisted to JSON) */
export interface ThreadEntry {
  chatJid: string;
  slackThreadTs: string;
  name: string;
  type: "group" | "dm";
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
  config: ConversationConfig;
}

/** Thread registry file structure */
export interface ThreadRegistryData {
  version: 1;
  threads: Record<string, ThreadEntry>;
}

/** Incoming WhatsApp message context (from OpenClaw hook) */
export interface WAMessageContext {
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
}

/** Queued Slack message for batch writing */
export interface QueuedSlackMessage {
  threadTs: string;
  text: string;
  blocks?: unknown[];
  timestamp: number;
}

/** Parse a config string from pinned message format */
export function parseConfigString(raw: string): Partial<ConversationConfig> {
  const config: Partial<ConversationConfig> = {};

  // Format: "Config: modo=todos | cooldown=5min | idioma=auto | keywords=hola,test"
  const pairs = raw
    .replace(/^.*Config:\s*/i, "")
    .split("|")
    .map((s) => s.trim());

  for (const pair of pairs) {
    const [key, value] = pair.split("=").map((s) => s.trim());
    if (!key || !value) continue;

    switch (key.toLowerCase()) {
      case "modo":
      case "mode":
        if (["todos", "solo_preguntas", "palabras_clave", "desactivado"].includes(value)) {
          config.mode = value as ReplyMode;
        }
        break;
      case "cooldown":
        config.cooldownMinutes = parseInt(value.replace(/min$/i, ""), 10) || 5;
        break;
      case "idioma":
      case "language":
        if (["espanol", "ingles", "auto"].includes(value)) {
          config.language = value as LanguageSetting;
        }
        break;
      case "keywords":
      case "palabras_clave":
      case "palabras":
        config.keywords = value.split(",").map((k) => k.trim().toLowerCase());
        break;
      case "notas":
      case "notes":
        config.notes = value;
        break;
    }
  }

  return config;
}

/** Serialize config to pinned message format */
export function serializeConfig(config: ConversationConfig): string {
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
