/**
 * wa-slack-logger - OpenClaw Plugin Entry Point
 *
 * Registers all plugin components:
 * - Background service (SlackLoggerService)
 * - Message hook (WhatsApp incoming messages)
 * - Slash commands (/wa-status, /wa-pause, /wa-resume, /wa-config)
 * - Agent tool (log_to_slack)
 */

import { SlackClient } from "./slack/client.js";
import { ThreadRegistry } from "./services/thread-registry.js";
import { SlackLoggerService } from "./services/slack-logger.js";
import { setSlackLogger, handler as onMessageHandler } from "./hooks/on-message/handler.js";
import { DEFAULT_CONFIG, type PluginConfig } from "./config.js";

/** OpenClaw Plugin API interface */
interface PluginAPI {
  config: Record<string, unknown>;
  env: Record<string, string | undefined>;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  registerService: (service: {
    id: string;
    start: () => Promise<void>;
    stop: () => Promise<void>;
  }) => void;
  registerHook: (hook: {
    event: string;
    channel?: string;
    handler: (ctx: unknown) => Promise<void>;
  }) => void;
  registerCommand: (command: {
    name: string;
    description: string;
    handler: (ctx: { args: string[]; channel: string; reply: (text: string) => void }) => unknown;
  }) => void;
  registerTool: (tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (params: Record<string, unknown>) => Promise<unknown>;
  }) => void;
  registerGatewayMethod: (
    method: string,
    handler: (ctx: { respond: (ok: boolean, data: unknown) => void }) => void
  ) => void;
}

/** Plugin entry point */
export default function waSlackLoggerPlugin(api: PluginAPI): void {
  const logger = api.logger;
  logger.info("wa-slack-logger: Initializing plugin...");

  // Merge config with defaults
  const pluginConfig: PluginConfig = {
    ...DEFAULT_CONFIG,
    ...(api.config as Partial<PluginConfig>),
    slackChannel: (api.config.slackChannel as string) || api.env.SLACK_LOG_CHANNEL || "",
  };

  if (!pluginConfig.slackChannel) {
    logger.error("wa-slack-logger: SLACK_LOG_CHANNEL is required!");
    return;
  }

  const slackToken = api.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    logger.error("wa-slack-logger: SLACK_BOT_TOKEN is required!");
    return;
  }

  // Initialize Slack client
  const slackClient = new SlackClient({
    token: slackToken,
    channel: pluginConfig.slackChannel,
  });

  // Initialize Thread Registry
  const threadRegistry = new ThreadRegistry(pluginConfig, slackClient);

  // Initialize Slack Logger Service
  const slackLoggerService = new SlackLoggerService({
    pluginConfig,
    slackClient,
    threadRegistry,
    logger,
  });

  // Set shared reference for hook handler
  setSlackLogger(slackLoggerService);

  // ─── Register Background Service ──────────────────────────────────
  api.registerService({
    id: "wa-slack-logger",
    start: () => slackLoggerService.start(),
    stop: () => slackLoggerService.stop(),
  });

  // ─── Register Message Hook ────────────────────────────────────────
  api.registerHook({
    event: "message:received",
    channel: "whatsapp",
    handler: onMessageHandler as (ctx: unknown) => Promise<void>,
  });

  // ─── Register Slash Commands ──────────────────────────────────────

  api.registerCommand({
    name: "wa-status",
    description: "Muestra el estado del plugin wa-slack-logger",
    handler: (ctx) => {
      const status = slackLoggerService.getStatus();
      ctx.reply(
        [
          `\u{1f4ca} *wa-slack-logger Status*`,
          `Running: ${status.running ? "\u{2705}" : "\u{274c}"}`,
          `Queue: ${status.queueSize} pending`,
          `Threads: ${status.threadCount} total, ${status.activeThreads} active (24h)`,
        ].join("\n")
      );
    },
  });

  api.registerCommand({
    name: "wa-pause",
    description: "Pausa auto-respuestas para un grupo/DM. Uso: /wa-pause <chatJid>",
    handler: (ctx) => {
      const chatJid = ctx.args[0];
      if (!chatJid) {
        ctx.reply("Uso: /wa-pause <chatJid>");
        return;
      }
      threadRegistry.updateConfig(chatJid, { mode: "desactivado" });
      ctx.reply(`\u{23f8}\u{fe0f} Auto-respuestas pausadas para ${chatJid}`);
    },
  });

  api.registerCommand({
    name: "wa-resume",
    description: "Reanuda auto-respuestas. Uso: /wa-resume <chatJid> [modo]",
    handler: (ctx) => {
      const chatJid = ctx.args[0];
      const mode = ctx.args[1] ?? "todos";
      if (!chatJid) {
        ctx.reply("Uso: /wa-resume <chatJid> [todos|solo_preguntas|palabras_clave]");
        return;
      }
      if (!["todos", "solo_preguntas", "palabras_clave"].includes(mode)) {
        ctx.reply("Modo invalido. Opciones: todos, solo_preguntas, palabras_clave");
        return;
      }
      threadRegistry.updateConfig(chatJid, { mode: mode as "todos" | "solo_preguntas" | "palabras_clave" });
      ctx.reply(`\u{25b6}\u{fe0f} Auto-respuestas activadas para ${chatJid} (modo: ${mode})`);
    },
  });

  api.registerCommand({
    name: "wa-config",
    description: "Configura opciones de un chat. Uso: /wa-config <chatJid> <key=value>",
    handler: (ctx) => {
      const chatJid = ctx.args[0];
      const configStr = ctx.args.slice(1).join(" ");
      if (!chatJid || !configStr) {
        ctx.reply("Uso: /wa-config <chatJid> modo=todos cooldown=10min idioma=espanol");
        return;
      }
      threadRegistry.applyConfigFromString(chatJid, configStr);
      const updated = threadRegistry.getConfig(chatJid);
      ctx.reply(
        `\u{2699}\u{fe0f} Config actualizada para ${chatJid}:\n` +
          `modo=${updated.mode} | cooldown=${updated.cooldownMinutes}min | idioma=${updated.language}`
      );
    },
  });

  // ─── Register Agent Tool ──────────────────────────────────────────

  api.registerTool({
    name: "log_to_slack",
    description:
      "Registra un evento personalizado en el thread de Slack correspondiente a una conversacion de WhatsApp",
    parameters: {
      type: "object",
      properties: {
        chatJid: {
          type: "string",
          description: "WhatsApp Chat JID",
        },
        message: {
          type: "string",
          description: "Mensaje a registrar en el thread de Slack",
        },
      },
      required: ["chatJid", "message"],
    },
    handler: async (params) => {
      const chatJid = params.chatJid as string;
      const message = params.message as string;

      const thread = threadRegistry.getThread(chatJid);
      if (!thread) {
        return { success: false, error: "Thread no encontrado para " + chatJid };
      }

      await slackClient.postThreadMessage(thread.slackThreadTs, message);
      return { success: true, threadTs: thread.slackThreadTs };
    },
  });

  // ─── Register Gateway RPC Method ──────────────────────────────────

  api.registerGatewayMethod("wa-slack-logger.status", ({ respond }) => {
    const status = slackLoggerService.getStatus();
    respond(true, status);
  });

  api.registerGatewayMethod("wa-slack-logger.health", async ({ respond }) => {
    const health = await slackLoggerService.healthCheck();
    respond(health.healthy, health);
  });

  logger.info("wa-slack-logger: Plugin initialized successfully");
}
