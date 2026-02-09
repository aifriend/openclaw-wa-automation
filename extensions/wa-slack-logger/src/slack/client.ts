/**
 * Slack Web API client with rate limiting and batch queue
 *
 * Rate limits: Slack Tier 3 (~50 req/min for chat.postMessage)
 * Implements token bucket + batch queue for high-volume periods
 */

import { WebClient, type ChatPostMessageResponse } from "@slack/web-api";

export interface SlackClientOptions {
  token: string;
  channel: string;
  maxRequestsPerMinute?: number;
  retryMaxAttempts?: number;
}

export class SlackClient {
  private client: WebClient;
  private channel: string;
  private maxRpm: number;
  private retryMax: number;

  // Token bucket rate limiter
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private lastRefill: number;

  constructor(options: SlackClientOptions) {
    this.client = new WebClient(options.token, {
      retryConfig: { retries: 2 },
    });
    this.channel = options.channel;
    this.maxRpm = options.maxRequestsPerMinute ?? 45; // conservative default
    this.retryMax = options.retryMaxAttempts ?? 3;

    // Token bucket: refill tokens at maxRpm per minute
    this.maxTokens = this.maxRpm;
    this.tokens = this.maxTokens;
    this.refillRate = this.maxRpm / 60_000; // tokens per ms
    this.lastRefill = Date.now();
  }

  /** Wait for rate limit token */
  private async acquireToken(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    if (this.tokens < 1) {
      const waitMs = (1 - this.tokens) / this.refillRate;
      await new Promise((r) => setTimeout(r, Math.ceil(waitMs)));
      this.tokens = 1;
      this.lastRefill = Date.now();
    }

    this.tokens -= 1;
  }

  /** Retry wrapper with exponential backoff */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.retryMax; attempt++) {
      try {
        await this.acquireToken();
        return await fn();
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check for Slack rate limit (429)
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "slack_webapi_platform_error"
        ) {
          const retryAfter =
            typeof err === "object" && "retryAfter" in (err as Record<string, unknown>)
              ? Number((err as { retryAfter: number }).retryAfter)
              : 5;
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }

        // Exponential backoff for other errors
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 30_000);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }

  /** Create a new thread (parent message) in the configured channel */
  async createThread(text: string, blocks?: unknown[]): Promise<string> {
    const result = await this.withRetry(() =>
      this.client.chat.postMessage({
        channel: this.channel,
        text,
        blocks: blocks as ChatPostMessageResponse["message"] extends { blocks: infer B } ? B : never,
        unfurl_links: false,
        unfurl_media: false,
      })
    );

    if (!result.ts) {
      throw new Error("Failed to create thread: no timestamp returned");
    }

    return result.ts;
  }

  /** Post a reply to an existing thread */
  async postThreadMessage(
    threadTs: string,
    text: string,
    blocks?: unknown[]
  ): Promise<string> {
    const result = await this.withRetry(() =>
      this.client.chat.postMessage({
        channel: this.channel,
        thread_ts: threadTs,
        text,
        blocks: blocks as ChatPostMessageResponse["message"] extends { blocks: infer B } ? B : never,
        unfurl_links: false,
        unfurl_media: false,
      })
    );

    return result.ts ?? "";
  }

  /** Pin a message in the channel */
  async pinMessage(messageTs: string): Promise<void> {
    await this.withRetry(() =>
      this.client.pins.add({
        channel: this.channel,
        timestamp: messageTs,
      })
    );
  }

  /** Add an emoji reaction to a message */
  async addReaction(messageTs: string, emoji: string): Promise<void> {
    try {
      await this.withRetry(() =>
        this.client.reactions.add({
          channel: this.channel,
          timestamp: messageTs,
          name: emoji,
        })
      );
    } catch {
      // Reactions are non-critical, silently ignore failures
    }
  }

  /** Get replies in a thread (for context) */
  async getThreadReplies(threadTs: string, limit = 20): Promise<Array<{ text: string; ts: string; user?: string }>> {
    const result = await this.withRetry(() =>
      this.client.conversations.replies({
        channel: this.channel,
        ts: threadTs,
        limit,
      })
    );

    return (result.messages ?? [])
      .slice(1) // Skip parent message
      .map((m) => ({
        text: m.text ?? "",
        ts: m.ts ?? "",
        user: m.user,
      }));
  }

  /** Get pinned messages in a thread (for config) */
  async getPinnedMessages(): Promise<Array<{ text: string; ts: string }>> {
    const result = await this.withRetry(() =>
      this.client.pins.list({
        channel: this.channel,
      })
    );

    return (
      (result.items as Array<{ message?: { text?: string; ts?: string; thread_ts?: string } }>) ?? []
    )
      .filter((item) => item.message?.text)
      .map((item) => ({
        text: item.message!.text!,
        ts: item.message!.thread_ts ?? item.message!.ts ?? "",
      }));
  }

  /** Test connection to Slack */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.client.auth.test();
      return result.ok === true;
    } catch {
      return false;
    }
  }
}
