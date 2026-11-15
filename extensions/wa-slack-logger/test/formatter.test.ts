import { describe, expect, it } from "vitest";
import { escapeSlack, formatIncomingMessage } from "../src/slack/formatter.js";
import type { WAMessageContext } from "../src/config.js";

const ctx: WAMessageContext = {
  chatJid: "1@s.whatsapp.net",
  senderJid: "1@s.whatsapp.net",
  senderName: "A & <B>",
  isGroup: false,
  text: "x < y && y > z",
  timestamp: 0,
  messageId: "m1",
};

describe("escapeSlack", () => {
  it("escapes & < > exactly once", () => {
    expect(escapeSlack("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
});

describe("formatIncomingMessage", () => {
  it("escapes sender and body in text and blocks", () => {
    const { text, blocks } = formatIncomingMessage(ctx);
    expect(text).toContain("A &amp; &lt;B&gt;: x &lt; y &amp;&amp; y &gt; z");
    const section = blocks[0] as { text: { text: string } };
    expect(section.text.text).toContain("x &lt; y &amp;&amp; y &gt; z");
    expect(section.text.text).not.toContain("<B>");
  });
});
