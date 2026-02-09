# Architecture

Technical documentation for the OpenClaw WhatsApp Auto-Reply + Slack Logger system.

## System Overview

```
+------------------+       +--------------------------------------+       +-----------------+
|                  |       |          OpenClaw Gateway             |       |                 |
|    WhatsApp      |       |                                      |       |     Slack       |
|    (Baileys)     |<----->|  +--------------------------------+  |------>|   #wa-monitor   |
|                  |       |  |     wa-slack-logger plugin      |  |       |                 |
|  - Groups        |       |  |                                |  |       |  - Threads      |
|  - DMs           |       |  |  Message Hook --> Slack Logger  |  |       |  - Summaries    |
|  - Auto-replies  |       |  |       |              |         |  |       |  - Config pins  |
|                  |       |  |       v              v         |  |       |                 |
+------------------+       |  |  Azure AI      Thread Registry |  |       +-----------------+
                           |  |  (Claude)      (JSON file)     |  |
                           |  +--------------------------------+  |
                           |                                      |
                           |  Cron: Daily/Weekly/Health            |
                           +--------------------------------------+
```

## Data Flow

### Incoming Message Flow

```
1. WhatsApp message received (via Baileys WebSocket)
        |
2. OpenClaw Gateway routes to wa-slack-logger hook
        |
3. on-message handler processes:
        |
        +---> 3a. Log to Slack (ALWAYS)
        |         |
        |         +---> Get/create Slack thread for this chat
        |         +---> Format message with Block Kit
        |         +---> Add to batch queue
        |         +---> Flush queue to Slack API
        |
        +---> 3b. Evaluate auto-reply
                  |
                  +---> Load conversation config (cached 5 min)
                  +---> Check reply mode (todos/preguntas/keywords/off)
                  +---> Check cooldown timer
                  |
                  +---> IF should reply:
                  |         |
                  |         +---> Build prompt with context
                  |         +---> Send to Azure AI (Claude)
                  |         +---> Receive reply text
                  |         +---> Send reply to WhatsApp
                  |         +---> Log reply to Slack thread
                  |
                  +---> IF should NOT reply:
                            |
                            +---> Log skip reason to Slack (optional)
```

### Cron Job Flow

```
Daily Summary (23:00 Lima):
    For each active conversation (last 24h):
        1. Agent reads thread history from Slack
        2. Agent generates summary via Azure AI
        3. Summary posted as thread reply

Weekly Report (Monday 10:00 Lima):
    1. Agent aggregates all conversation data
    2. Generates consolidated report
    3. Posts as new message in #wa-monitor

Health Check (every 30 min):
    1. Verify Slack API connection
    2. Validate thread registry integrity
    3. Check message queue size
    4. Report issues if any
```

## Plugin Components

```
wa-slack-logger/src/
|
+-- index.ts                    ENTRY POINT
|   Registers all components    - Background service
|   with OpenClaw Plugin API    - Message hook
|                               - Slash commands (/wa-status, /wa-pause, etc.)
|                               - Agent tool (log_to_slack)
|                               - Gateway RPC methods
|
+-- config.ts                   TYPES & PARSING
|   Type definitions            - ReplyMode, LanguageSetting
|   Config parsing              - ConversationConfig, PluginConfig
|   Serialization               - parseConfigString(), serializeConfig()
|
+-- slack/
|   +-- client.ts               SLACK API CLIENT
|   |   WebClient wrapper       - Token bucket rate limiter (~45 req/min)
|   |                           - Retry with exponential backoff
|   |                           - createThread(), postThreadMessage()
|   |                           - pinMessage(), addReaction()
|   |                           - getThreadReplies(), testConnection()
|   |
|   +-- formatter.ts            MESSAGE FORMATTING
|       Block Kit builders      - formatThreadParent() -- new conversation
|                               - formatIncomingMessage() -- WA message
|                               - formatAutoReply() -- bot reply
|                               - formatSkippedReply() -- skipped with reason
|                               - formatDailySummary() -- daily stats
|                               - formatWeeklyReport() -- weekly stats
|                               - formatError() -- error notification
|                               - formatConfigMessage() -- pinned config
|
+-- services/
|   +-- thread-registry.ts      THREAD MAPPING
|   |   Persistence layer       - Maps WhatsApp JID -> Slack thread_ts
|   |                           - Persisted to ~/.openclaw/wa-slack-threads.json
|   |                           - In-memory cache with periodic disk flush
|   |                           - Config cache per conversation (5 min TTL)
|   |                           - getOrCreateThread(), getConfig(), updateConfig()
|   |
|   +-- slack-logger.ts         BACKGROUND SERVICE
|       Core service            - Message batch queue (flush every 2s or 5 items)
|                               - Cooldown tracking per conversation
|                               - shouldAutoReply() evaluation logic
|                               - Question detection (ES/EN patterns)
|                               - Keyword matching
|                               - healthCheck(), getStatus()
|
+-- hooks/
    +-- on-message/
        +-- handler.ts          MESSAGE HOOK
        |   Event handler       - Triggered on message:received (whatsapp)
        |                       - Logs message -> evaluates reply -> sends reply
        |                       - Builds AI prompt with conversation context
        |
        +-- HOOK.md             Hook metadata and documentation
```

## Thread Registry

The thread registry maps WhatsApp conversations to Slack threads. It is the central state management component.

### Storage Format

File: `~/.openclaw/wa-slack-threads.json`

```json
{
  "version": 1,
  "threads": {
    "5491100000000@g.us": {
      "chatJid": "5491100000000@g.us",
      "slackThreadTs": "1707300000.000100",
      "name": "Familia Lopez",
      "type": "group",
      "createdAt": "2026-02-07T18:00:00.000Z",
      "lastMessageAt": "2026-02-09T15:30:00.000Z",
      "messageCount": 245,
      "config": {
        "mode": "solo_preguntas",
        "cooldownMinutes": 5,
        "language": "auto",
        "keywords": [],
        "notes": ""
      }
    },
    "5491155555555@s.whatsapp.net": {
      "chatJid": "5491155555555@s.whatsapp.net",
      "slackThreadTs": "1707300100.000200",
      "name": "Carlos Perez",
      "type": "dm",
      "createdAt": "2026-02-08T10:00:00.000Z",
      "lastMessageAt": "2026-02-09T11:00:00.000Z",
      "messageCount": 32,
      "config": {
        "mode": "todos",
        "cooldownMinutes": 3,
        "language": "espanol",
        "keywords": [],
        "notes": ""
      }
    }
  }
}
```

### Lifecycle

```
1. New WhatsApp message arrives from unknown chat
2. ThreadRegistry.getOrCreateThread() called
3. New Slack thread created (parent message with chat info)
4. Default config message posted in thread
5. Entry persisted to JSON file
6. Subsequent messages use cached thread_ts
7. Registry saved to disk every 30 seconds
```

## Rate Limiting

### Slack API

The Slack client uses a token bucket algorithm:

| Parameter | Value |
|-----------|-------|
| Max tokens | 45 |
| Refill rate | 45 tokens/minute |
| Retry on 429 | Yes, with `Retry-After` header |
| Max retries | 3 |
| Backoff | Exponential (1s, 2s, 4s) |

### Batch Queue

High-volume message periods are handled by batching:

| Parameter | Value |
|-----------|-------|
| Flush interval | 2,000 ms |
| Max batch size | 5 messages |
| Failed message retry | 1 attempt |

### Auto-Reply Cooldown

Per-conversation cooldown prevents reply spam:

| Parameter | Default | Configurable |
|-----------|---------|-------------|
| Cooldown period | 5 minutes | Yes, per conversation |
| Stored in | In-memory Map | Resets on gateway restart |

## Configuration Hierarchy

```
1. Plugin defaults (config.ts DEFAULT_CONFIG)
        |
2. openclaw.json plugins.entries.wa-slack-logger.config
        |
3. Per-conversation config (thread registry)
        |
4. Slash command overrides (/wa-config)
```

Higher numbers override lower numbers for the same setting.

## Reply Mode Decision Tree

```
Message received
    |
    +-- Is text empty or system message?
    |       YES --> Skip (no log)
    |
    +-- Log to Slack thread (always)
    |
    +-- Get conversation config
    |
    +-- mode == "desactivado"?
    |       YES --> Stop (log only)
    |
    +-- mode == "solo_preguntas"?
    |       YES --> Contains question markers (?, how, what, etc.)?
    |                   NO --> Skip + log reason
    |
    +-- mode == "palabras_clave"?
    |       YES --> Matches any configured keyword?
    |                   NO --> Skip + log reason
    |
    +-- Cooldown active?
    |       YES --> Skip + log "cooldown activo"
    |
    +-- Generate reply via Azure AI
    |
    +-- Send reply to WhatsApp
    |
    +-- Log reply to Slack thread
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_AI_API_KEY` | Yes | Azure AI Services API key |
| `AZURE_AI_ENDPOINT` | Yes | Anthropic-compatible endpoint URL |
| `SLACK_BOT_TOKEN` | Yes | Slack bot token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | No | Slack signing secret (for webhook verification) |
| `SLACK_LOG_CHANNEL` | Yes | Slack channel ID for logging |

## File System State

The system maintains state in two locations:

| Location | Content | Persistence |
|----------|---------|-------------|
| `~/.openclaw/wa-slack-threads.json` | Thread registry (JID -> thread mapping + configs) | Flushed every 30s |
| `~/.openclaw/` (managed by OpenClaw) | WhatsApp session, agent state, credentials | Managed by Gateway |

## Security Considerations

- **API keys**: Stored in `.env` (git-ignored), never committed
- **WhatsApp session**: Stored in `~/.openclaw/` (local only)
- **Slack bot token**: Grants write access only to invited channels
- **Plugin trust**: Runs in-process with Gateway (treat as trusted code)
- **Message content**: Passes through Azure AI for reply generation (subject to provider's data policy)
- **Thread registry**: Contains chat JIDs and conversation names (local file, not committed)
