import { describe, expect, it } from "vitest";
import { parseConfigString, serializeConfig } from "../src/config.js";

describe("parseConfigString", () => {
  it("parses pipe-separated pairs", () => {
    const c = parseConfigString("Config: modo=todos | cooldown=10min | idioma=ingles | keywords=Hola,Test");
    expect(c).toEqual({ mode: "todos", cooldownMinutes: 10, language: "ingles", keywords: ["hola", "test"] });
  });

  it("parses whitespace-separated pairs", () => {
    const c = parseConfigString("modo=solo_preguntas cooldown=3min idioma=auto");
    expect(c).toEqual({ mode: "solo_preguntas", cooldownMinutes: 3, language: "auto" });
  });

  it("keeps spaces inside values", () => {
    const c = parseConfigString("modo=todos | notas=hola mundo cruel");
    expect(c.notes).toBe("hola mundo cruel");
  });

  it("keeps '=' inside values", () => {
    expect(parseConfigString("notas=a=b").notes).toBe("a=b");
  });

  it("ignores invalid modes and malformed pairs", () => {
    expect(parseConfigString("modo=nope | basura | idioma=klingon")).toEqual({});
  });

  it("round-trips through serializeConfig", () => {
    const text = serializeConfig({
      mode: "palabras_clave",
      cooldownMinutes: 7,
      language: "espanol",
      keywords: ["precio"],
      notes: "vip",
    });
    expect(parseConfigString(text)).toEqual({
      mode: "palabras_clave",
      cooldownMinutes: 7,
      language: "espanol",
      keywords: ["precio"],
      notes: "vip",
    });
  });
});
