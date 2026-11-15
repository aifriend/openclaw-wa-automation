import { describe, expect, it } from "vitest";
import { SlackLoggerService } from "../src/services/slack-logger.js";
import { DEFAULT_CONFIG, type ConversationConfig, type WAMessageContext } from "../src/config.js";
import type { SlackClient } from "../src/slack/client.js";
import type { ThreadRegistry } from "../src/services/thread-registry.js";

function makeService(config: Partial<ConversationConfig>) {
  const full: ConversationConfig = {
    mode: "todos",
    cooldownMinutes: 5,
    language: "auto",
    keywords: [],
    notes: "",
    ...config,
  };
  const registry = { getConfig: () => full } as unknown as ThreadRegistry;
  const logger = { info() {}, warn() {}, error() {} };
  return new SlackLoggerService({
    pluginConfig: DEFAULT_CONFIG,
    slackClient: {} as SlackClient,
    threadRegistry: registry,
    logger,
  });
}

const msg = (text: string): WAMessageContext => ({
  chatJid: "g@g.us",
  senderJid: "1@s.whatsapp.net",
  senderName: "Ana",
  isGroup: true,
  text,
  timestamp: 0,
  messageId: "m",
});

describe("shouldAutoReply", () => {
  it("never replies when disabled", () => {
    expect(makeService({ mode: "desactivado" }).shouldAutoReply(msg("hola?"))).toEqual({
      should: false,
      reason: "modo desactivado",
    });
  });

  it("replies to anything in 'todos' mode but not to empty text", () => {
    const s = makeService({ mode: "todos" });
    expect(s.shouldAutoReply(msg("buenas")).should).toBe(true);
    expect(s.shouldAutoReply(msg("   ")).reason).toBe("mensaje vacio");
  });

  it.each([
    "¿Dónde queda la oficina?",
    "Qué hora es",
    "cómo llego",
    "Where is the office",
    "can you help me",
    "hola. cuándo abren",
    "alguien sabe el precio",
    "precio?",
  ])("detects question: %s", (text) => {
    expect(makeService({ mode: "solo_preguntas" }).shouldAutoReply(msg(text)).should).toBe(true);
  });

  it.each([
    "dije que vengo mañana",
    "this is fine",
    "ok gracias",
    "they do it daily",
    "no sé cómo ni cuándo",
  ])("does not treat statement as question: %s", (text) => {
    expect(makeService({ mode: "solo_preguntas" }).shouldAutoReply(msg(text))).toEqual({
      should: false,
      reason: "no es una pregunta",
    });
  });

  it("matches keywords case-insensitively against lowercased keywords", () => {
    const s = makeService({ mode: "palabras_clave", keywords: ["precio"] });
    expect(s.shouldAutoReply(msg("Cual es el PRECIO")).should).toBe(true);
    expect(s.shouldAutoReply(msg("hola")).reason).toBe("no contiene palabras clave");
  });
});
