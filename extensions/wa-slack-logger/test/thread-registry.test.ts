import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadRegistry } from "../src/services/thread-registry.js";
import { DEFAULT_CONFIG, type WAMessageContext } from "../src/config.js";
import type { SlackClient } from "../src/slack/client.js";

function fakeSlack() {
  const calls = { create: 0, post: 0, fail: false };
  const client = {
    async createThread() {
      calls.create += 1;
      await new Promise((r) => setTimeout(r, 10));
      if (calls.fail) throw new Error("slack down");
      return `ts-${calls.create}`;
    },
    async postThreadMessage() {
      calls.post += 1;
      return "ts-msg";
    },
  } as unknown as SlackClient;
  return { calls, client };
}

const ctx = (jid: string, over: Partial<WAMessageContext> = {}): WAMessageContext => ({
  chatJid: jid,
  senderJid: "1@s.whatsapp.net",
  senderName: "Ana",
  isGroup: false,
  text: "hi",
  timestamp: 0,
  messageId: "m",
  ...over,
});

async function makeRegistry() {
  const dir = await mkdtemp(join(tmpdir(), "wa-reg-"));
  const path = join(dir, "threads.json");
  const { calls, client } = fakeSlack();
  const registry = new ThreadRegistry({ ...DEFAULT_CONFIG, threadRegistryPath: path }, client);
  return { registry, calls, path };
}

describe("ThreadRegistry", () => {
  it("creates one Slack thread for concurrent calls on the same chat", async () => {
    const { registry, calls } = await makeRegistry();
    const [a, b, c] = await Promise.all([
      registry.getOrCreateThread(ctx("a@s.whatsapp.net")),
      registry.getOrCreateThread(ctx("a@s.whatsapp.net")),
      registry.getOrCreateThread(ctx("a@s.whatsapp.net")),
    ]);
    expect(calls.create).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(registry.size).toBe(1);
  });

  it("creates separate threads for different chats", async () => {
    const { registry, calls } = await makeRegistry();
    await Promise.all([
      registry.getOrCreateThread(ctx("a@s.whatsapp.net")),
      registry.getOrCreateThread(ctx("b@s.whatsapp.net")),
    ]);
    expect(calls.create).toBe(2);
    expect(registry.size).toBe(2);
  });

  it("allows a retry after a failed creation", async () => {
    const { registry, calls } = await makeRegistry();
    calls.fail = true;
    await expect(registry.getOrCreateThread(ctx("a@s.whatsapp.net"))).rejects.toThrow("slack down");
    expect(registry.size).toBe(0);
    calls.fail = false;
    const entry = await registry.getOrCreateThread(ctx("a@s.whatsapp.net"));
    expect(entry.slackThreadTs).toBe("ts-2");
  });

  it("names groups by group name and DMs by sender", async () => {
    const { registry } = await makeRegistry();
    const g = await registry.getOrCreateThread(ctx("g@g.us", { isGroup: true, groupName: "Team" }));
    const d = await registry.getOrCreateThread(ctx("d@s.whatsapp.net"));
    expect([g.name, g.type, d.name, d.type]).toEqual(["Team", "group", "Ana", "dm"]);
  });

  it("persists and reloads", async () => {
    const { registry, path } = await makeRegistry();
    await registry.getOrCreateThread(ctx("a@s.whatsapp.net"));
    registry.updateAfterMessage("a@s.whatsapp.net");
    await registry.save();
    expect(JSON.parse(await readFile(path, "utf-8")).threads["a@s.whatsapp.net"].messageCount).toBe(1);

    const { client } = fakeSlack();
    const reloaded = new ThreadRegistry({ ...DEFAULT_CONFIG, threadRegistryPath: path }, client);
    await reloaded.load();
    expect(reloaded.size).toBe(1);
    expect(reloaded.getThread("a@s.whatsapp.net")?.messageCount).toBe(1);
  });

  it("starts empty when the file does not exist", async () => {
    const { registry } = await makeRegistry();
    await registry.load();
    expect(registry.size).toBe(0);
  });

  it("applies config from a string", async () => {
    const { registry } = await makeRegistry();
    await registry.getOrCreateThread(ctx("a@s.whatsapp.net"));
    registry.applyConfigFromString("a@s.whatsapp.net", "Config: modo=todos | cooldown=1min");
    expect(registry.getConfig("a@s.whatsapp.net")).toMatchObject({ mode: "todos", cooldownMinutes: 1 });
  });
});
