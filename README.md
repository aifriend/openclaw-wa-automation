# OpenClaw WhatsApp Auto-Reply + Slack Logger

An [OpenClaw](https://openclaw.ai) automation workflow that monitors your WhatsApp groups and DMs, generates contextual auto-replies via AI, and logs all activity to Slack using a thread-per-conversation pattern.

## How It Works

```
WhatsApp                    OpenClaw Gateway                 Slack
  Groups ──┐                                              #wa-monitor
  & DMs    │    ┌─────────────────────────────────┐     ┌──────────────┐
           ├───>│  wa-slack-logger plugin          │────>│ Thread: Grupo│
           │    │  ┌───────────┐  ┌─────────────┐ │     │  [msg log]   │
           │    │  │ Message   │  │ Slack Logger │ │     │  [auto-reply]│
           │<───│  │ Hook      │  │ Service      │ │     │  [summary]   │
  Auto-    │    │  └─────┬─────┘  └──────┬──────┘ │     └──────────────┘
  replies  │    │        │               │        │     ┌──────────────┐
           │    │   ┌────v────┐   ┌──────v──────┐ │     │ Thread: DM   │
           │    │   │ Azure AI│   │ Thread      │ │────>│  [msg log]   │
           │    │   │ (Claude)│   │ Registry    │ │     │  [auto-reply]│
           │    │   └─────────┘   └─────────────┘ │     └──────────────┘
           │    └─────────────────────────────────┘
```

**Features:**
- Monitors all WhatsApp groups and DMs in real-time
- Configurable auto-reply per conversation (all messages, questions only, keyword-triggered, or disabled)
- Logs every message to organized Slack threads (one thread per conversation)
- Daily and weekly summaries posted automatically
- Cooldown system to prevent reply spam
- Bilingual support (Spanish/English, auto-detected)

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | >= 22.0.0 | [Download](https://nodejs.org/) |
| **Homebrew** | latest | macOS/Linux package manager |
| **WhatsApp** | Personal account | Used via QR code pairing (WhatsApp Web protocol) |
| **Slack** | Workspace with admin access | To create a Slack App |
| **Azure AI Services** | API key | Or any Anthropic-compatible endpoint |

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/aifriend/openclaw-wa-automation.git
cd openclaw-wa-automation
```

### 2. Install OpenClaw

```bash
brew install openclaw-cli
```

Verify installation:

```bash
openclaw --version
openclaw doctor
```

### 3. Set Up Slack App

Follow the detailed guide: **[docs/SETUP-SLACK.md](docs/SETUP-SLACK.md)**

Quick summary:
1. Go to https://api.slack.com/apps and create a new app
2. Add bot scopes: `chat:write`, `chat:write.customize`, `channels:read`, `channels:history`, `reactions:write`
3. Install to workspace and copy the bot token (`xoxb-...`)
4. Create a `#wa-monitor` channel and invite the bot
5. Copy the channel ID

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Azure AI Services (or any Anthropic-compatible endpoint)
AZURE_AI_API_KEY=your-azure-ai-token
AZURE_AI_ENDPOINT=https://your-endpoint.services.ai.azure.com/anthropic/v1/messages

# Slack (from Step 3)
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_LOG_CHANNEL=C0123456789
```

### 5. Install Dependencies

```bash
npm install
```

### 6. OpenClaw Onboarding

Run the interactive setup wizard:

```bash
openclaw onboard --install-daemon
```

This will configure:
- Authentication method
- Gateway port and token
- LLM provider (select Azure / Anthropic-compatible)

### 7. Pair WhatsApp

```bash
openclaw channels login
```

A QR code will appear in your terminal. Scan it with:
**WhatsApp > Settings > Linked Devices > Link a Device**

### 8. Link Configuration

Symlink the project config to OpenClaw's expected location:

```bash
ln -sf "$(pwd)/config/openclaw.json" ~/.openclaw/openclaw.json
```

### 9. Start the Gateway

```bash
openclaw gateway start
```

Check status:

```bash
openclaw gateway status
openclaw plugins doctor
```

View logs:

```bash
openclaw gateway logs
```

## Configuration

### Reply Modes

Each WhatsApp conversation can be configured independently. Default mode is `desactivado` (logging only, no auto-replies).

| Mode | Behavior |
|------|----------|
| `todos` | Reply to every message (respects cooldown) |
| `solo_preguntas` | Reply only to detected questions |
| `palabras_clave` | Reply only when configured keywords are found |
| `desactivado` | Log to Slack only, never auto-reply |

### Changing Configuration

**Via slash commands** (in any OpenClaw channel):

```
/wa-config <chatJid> modo=todos cooldown=10min idioma=auto
/wa-pause <chatJid>
/wa-resume <chatJid> solo_preguntas
/wa-status
```

**Via Slack thread**: Edit the pinned config message in a conversation's thread:

```
Config: modo=todos | cooldown=5min | idioma=auto | keywords=urgente,importante
```

### Cron Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| Daily Summary | 23:00 (Lima) | Summarizes each active conversation and posts to its Slack thread |
| Weekly Report | Monday 10:00 (Lima) | Consolidated report posted as a new message in `#wa-monitor` |
| Health Check | Every 30 min | Verifies Slack connection, thread registry, and queue status |

### OpenClaw Config Reference

The main configuration file is `config/openclaw.json`. Key sections:

- **`agents.defaults.model`**: LLM model to use (default: `azure/claude-sonnet-4-5`)
- **`channels.whatsapp`**: WhatsApp channel settings (group policies, DM policies)
- **`plugins.entries.wa-slack-logger.config`**: Plugin settings (default mode, cooldown, batch size)
- **`cron`**: Enable/disable scheduled jobs

See the full file for all options and comments.

## Plugin Commands

| Command | Description |
|---------|-------------|
| `/wa-status` | Show plugin status (running, queue size, thread count) |
| `/wa-pause <jid>` | Disable auto-replies for a conversation |
| `/wa-resume <jid> [mode]` | Enable auto-replies with specified mode |
| `/wa-config <jid> <key=value>` | Update conversation configuration |

## Slack Thread Architecture

Each WhatsApp conversation gets its own thread in `#wa-monitor`:

```
#wa-monitor
+-- [Thread] Group: Family
|   +-- [09:15] Mom: Hello everyone
|   +-- [09:15] Auto-reply: Hi! How can I help?
|   +-- [23:00] Daily Summary: 15 messages, 3 auto-replies
|
+-- [Thread] DM: Carlos
|   +-- [11:00] Carlos: Hey, quick question...
|   +-- [11:01] Auto-reply: Sure, what do you need?
|
+-- [Thread] Group: Work Team
    +-- [08:00] Boss: Meeting at 3pm
    +-- (auto-reply disabled for this group)
```

## Project Structure

```
openclaw-wa-automation/
+-- README.md                              # This file
+-- package.json                           # Root workspace
+-- tsconfig.json                          # TypeScript config
+-- .env.example                           # Environment template
+-- config/
|   +-- openclaw.json                      # OpenClaw configuration
+-- workspace/
|   +-- AGENTS.md                          # Agent behavior instructions
|   +-- SOUL.md                            # Agent personality
|   +-- IDENTITY.md                        # Agent identity
|   +-- HEARTBEAT.md                       # Periodic task instructions
+-- extensions/
|   +-- wa-slack-logger/                   # Main plugin
|       +-- openclaw.plugin.json           # Plugin manifest
|       +-- package.json                   # Plugin dependencies
|       +-- src/
|           +-- index.ts                   # Plugin entry point
|           +-- config.ts                  # Types & config parsing
|           +-- slack/
|           |   +-- client.ts              # Slack API client (rate-limited)
|           |   +-- formatter.ts           # Block Kit message formatter
|           +-- services/
|           |   +-- slack-logger.ts        # Background logging service
|           |   +-- thread-registry.ts     # WA <-> Slack thread mapping
|           +-- hooks/
|               +-- on-message/
|                   +-- handler.ts         # Message hook handler
|                   +-- HOOK.md            # Hook metadata
+-- skills/
|   +-- wa-conversation-analyst/
|       +-- SKILL.md                       # Conversation analysis skill
+-- cron/
|   +-- jobs.json                          # Scheduled job definitions
+-- docs/
    +-- ARCHITECTURE.md                    # Technical architecture
    +-- SETUP-SLACK.md                     # Slack App setup guide
    +-- OpenClaw Automation & Plugins.md   # OpenClaw reference
```

## Troubleshooting

### WhatsApp connection drops

```bash
# Check gateway status
openclaw gateway status

# Restart gateway
openclaw gateway stop && openclaw gateway start

# Re-pair WhatsApp (if needed)
openclaw channels login
```

### Slack messages not appearing

1. Verify bot token: check `.env` has correct `SLACK_BOT_TOKEN`
2. Verify channel ID: ensure `SLACK_LOG_CHANNEL` matches `#wa-monitor`
3. Check bot is invited: run `/invite @OpenClaw WA Monitor` in the channel
4. Check plugin health: `openclaw plugins doctor`

### Auto-replies not working

1. Check conversation mode: `/wa-status` to see current config
2. Verify mode is not `desactivado`: `/wa-resume <chatJid> todos`
3. Check cooldown: default is 5 minutes between replies
4. Check gateway logs: `openclaw gateway logs`

### Plugin not loading

```bash
# Diagnose plugin issues
openclaw plugins doctor

# Check if plugin is registered
openclaw plugins list

# Restart gateway after config changes
openclaw gateway stop && openclaw gateway start
```

## Running on Another Machine

1. Clone the repo
2. Follow steps 2-9 from [Quick Start](#quick-start)
3. Note: WhatsApp QR pairing is per-device (you'll need to scan again)
4. Note: Thread registry (`wa-slack-threads.json`) is local state - new threads will be created for existing conversations

## Architecture

For detailed technical documentation, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## License

MIT
