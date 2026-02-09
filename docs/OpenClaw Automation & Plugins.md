
# OpenClaw: Automation and Plugins

OpenClaw is an open-source personal AI agent (formerly known as Clawdbot and Moltbot) created by Austrian developer Peter Steinberger [^20]. It runs locally on your own hardware—laptop, homelab, or VPS—and connects to the messaging platforms you already use, turning them into powerful automation hubs [^14]. The project has grown explosively, surpassing 161k GitHub stars and 25k forks, with 394+ contributors and 37 releases as of February 2026 [^16].

## Architecture Overview

OpenClaw's extension ecosystem is built on four core components: **Gateway**, **Agent**, **Skills**, and **Memory** [^33]. The Gateway manages all messaging platform connections as a Node.js long-running service. The Agent handles intent understanding via LLM API calls. Skills are modular capability extensions defined in `SKILL.md` files. Memory provides persistent context storage [^33].

The platform supports 12+ messaging channels including WhatsApp (via Baileys), Telegram, Discord, Slack, iMessage, Signal, Google Chat, Microsoft Teams, Matrix, and a built-in WebChat [^33]. It's model-agnostic, supporting Claude, GPT-4o, Gemini, Kimi K2.5, Minimax, and local models via Ollama [^14][^15].

## Automation Mechanisms

OpenClaw provides three main automation approaches: cron jobs, webhooks, and plugin hooks [^27].

### Cron Jobs

Scheduled tasks use standard cron syntax configured in `~/.openclaw/cron/jobs.json` [^33]:

```json
{
  "cron": {
    "jobs": [
      {
        "schedule": "0 9 * * *",
        "command": "agent --message 'Give me a daily briefing: check my calendar, summarize important emails, and list my tasks for today.'"
      }
    ]
  }
}
```

This triggers the AI agent at a scheduled time, and the agent executes multi-step workflows using its available skills [^27].

### Webhooks

External services can POST to OpenClaw webhook endpoints to trigger agent actions [^27]:

```json
{
  "webhooks": {
    "github": {
      "path": "/webhook/github",
      "command": "agent --message 'Process GitHub webhook: {payload}'"
    },
    "sentry": {
      "path": "/webhook/sentry",
      "command": "agent --message 'New Sentry error: {payload}'"
    }
  }
}
```

This enables event-driven automation from services like GitHub, Stripe, or Sentry [^33].

### Plugin Hooks

Plugins can bundle event-driven automation via hooks, registered at runtime using `registerPluginHooksFromDir()` [^13]. Hook directories follow the standard hook structure (`HOOK.md` + `handler.ts`), and plugin-managed hooks appear in `openclaw hooks list` with a `plugin:<id>` prefix [^13].

## Plugin System

Plugins are TypeScript modules loaded at runtime via jiti that extend OpenClaw with extra features [^13]. They run in-process with the Gateway and should be treated as trusted code [^13].

### What Plugins Can Register

- Gateway RPC methods
- Gateway HTTP handlers
- Agent tools
- CLI commands
- Background services
- Skills (via `skills` directories in the manifest)
- Auto-reply commands (execute without invoking the AI agent)
- Custom messaging channels
- Model provider auth flows [^13]

### Official Plugins

| Plugin | Package | Purpose |
|--------|---------|---------|
| Microsoft Teams | `@openclaw/msteams` | Teams messaging channel [^13] |
| Voice Call | `@openclaw/voice-call` | Twilio-powered voice calls [^13] |
| Memory (Core) | bundled | Default memory search [^13] |
| Memory (LanceDB) | bundled | Long-term memory with auto-recall [^13] |
| Matrix | `@openclaw/matrix` | Matrix protocol support [^13] |
| Nostr | `@openclaw/nostr` | Nostr decentralized messaging [^13] |
| Copilot Proxy | bundled | VS Code Copilot Proxy bridge [^13] |
| Google Antigravity OAuth | bundled | Google provider auth [^13] |

### Plugin Configuration

Plugins are managed via the config file and CLI [^13]:

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["voice-call"],
    "deny": ["untrusted-plugin"],
    "load": { "paths": ["~/Projects/oss/voice-call-extension"] },
    "entries": {
      "voice-call": { "enabled": true, "config": { "provider": "twilio" } }
    }
  }
}
```

### Plugin CLI Commands

```bash
openclaw plugins list            # List installed plugins
openclaw plugins install @openclaw/voice-call  # Install from npm
openclaw plugins install ./extensions/voice-call  # Install from local path
openclaw plugins enable <id>     # Enable a plugin
openclaw plugins disable <id>    # Disable a plugin
openclaw plugins doctor          # Diagnose plugin issues
openclaw plugins update --all    # Update all npm-installed plugins
```

Changes require a Gateway restart [^13].

### Writing a Custom Plugin

A minimal plugin exports a function that receives the API object [^13]:

```typescript
export default function (api) {
  // Register a custom slash command
  api.registerCommand({
    name: "mystatus",
    description: "Show plugin status",
    handler: (ctx) => ({
      text: `Plugin is running! Channel: ${ctx.channel}`,
    }),
  });

  // Register a background service
  api.registerService({
    id: "my-service",
    start: () => api.logger.info("ready"),
    stop: () => api.logger.info("bye"),
  });

  // Register a Gateway RPC method
  api.registerGatewayMethod("myplugin.status", ({ respond }) => {
    respond(true, { ok: true });
  });
}
```

Each plugin must include an `openclaw.plugin.json` manifest file in its root directory [^13].

## Skills Ecosystem (ClawHub)

Separate from plugins, OpenClaw has a **skills** system with 700+ community-built skills available through ClawHub (clawhub.ai) [^33][^28]. Skills use the `SKILL.md` standard format—an open standard originally developed by Anthropic and compatible with several AI coding assistants [^33].

### Skill Categories

| Category | Example Skills | Use Cases |
|----------|---------------|-----------|
| Productivity | apple-notes, notion-integration, obsidian-vault, trello-boards | Note management, project tracking [^33] |
| DevOps | github-integration, coolify, docker-skill, k8s-skill, aws-skill | CI/CD, container management, cloud ops [^33] |
| Smart Home | philips-hue, home-assistant, elgato-devices | Light control, scene automation [^33] |
| Browser Automation | agent-browser, web-scraper, screenshot-skill | Scraping, form filling, monitoring [^33] |
| AI Models | gemini-cli, gemini-deep-research, replicate-api, openrouter | Multi-model access [^33] |
| Content Creation | Auto-folder, file naming, hook variants, publishing checklist | Creator workflows [^25] |

### Installing Skills

```bash
openclaw skill search "calendar"
openclaw skill install google-calendar
openclaw skill list
openclaw skill update --all
```

You can also install skills manually by copying the skill directory to `~/.openclaw/skills/` [^33].

### Creating a Custom Skill

Create a directory under `~/.openclaw/skills/` with a `SKILL.md` file [^33]:

```markdown
---
name: my-custom-skill
description: Custom weather skill
metadata:
  openclaw:
    emoji: "🌤️"
    bins: []
    env:
      - WEATHER_API_KEY
---

## Skill Description
Query current weather and 7-day forecasts for any city.

## Usage Examples
- "Check today's weather in Madrid"
- "Will it rain in Zurich tomorrow?"
```

After creating the skill, restart the Gateway to load it [^33].

## Security Considerations

OpenClaw runs locally with full system access (shell execution, browser control, file access), which makes security critical [^14]. The project has implemented 34 security-related commits and released machine-verifiable security models [^20]. However, prompt injection remains an unsolved industry-wide problem [^20]. A malicious or compromised plugin effectively acts as remote code execution since plugins run in-process with the Gateway [^18].

Best practices include using `plugins.allow` allowlists, only installing trusted plugins, running in sandbox mode when testing, and starting with non-critical data when adding new skills [^13][^29].


---

## References

13. [Plugins - OpenClaw](https://docs.openclaw.ai/plugin) - A plugin is just a small code module that extends OpenClaw with extra features (commands, tools, and...

14. [OpenClaw AI Assistant: Local 24/7 Automation Guide 2026 | AI2sql](https://ai2sql.io/openclaw-ai-assistant-local-24-7-automation-guide-2026) - OpenClaw is an open-source personal AI agent that runs 24/7 on your local device, transforming chat ...

15. [Agentes de IA GRATUITOS 24/7 + Kimi K2.5 + Clawtasks - Lilys AI](https://lilys.ai/notes/es/openclaw-20260202/openclaw-ai-agents-kimi-clawtasks) - Esta actualización de OpenClaw (anteriormente Clawbot/Maltbot) ofrece agentes de IA gratuitos 24/7 y...

16. [GitHub - openclaw/openclaw: Your own personal AI ...](https://github.com/openclaw/openclaw) - OpenClaw is a personal AI assistant you run on your own devices. It answers you on the channels you ...

18. [From Clawdbot to OpenClaw: When Automation Becomes a Digital ...](https://www.vectra.ai/blog/clawdbot-to-moltbot-to-openclaw-when-automation-becomes-a-digital-backdoor) - A malicious plugin, or a compromised legitimate one, functions as instant remote code execution. The...

20. [OpenClaw: How a Weekend Project Became an Open-Source ...](https://www.trendingtopics.eu/openclaw-2-million-visitors-in-a-week/) - Originally launched as a “WhatsApp Relay” project, it now boasts over 100,000 GitHub stars and attra...

25. [7 OpenClaw Skills for Creators: Content Creation Automation](https://www.nemovideo.com/blog/openclaw-skills-for-creators-2026) - The 7 OpenClaw skills that actually help creators: asset prep, naming, briefs, scheduling—without ov...

27. [OpenClaw Task Automation Tutorial](https://openclaw-ai.online/tutorials/use-cases/task-automation/) - Step-by-step tutorial: Create automated workflows with OpenClaw. Learn to automate repetitive tasks,...

28. [OpenClaw Skills: Local AI Plugins & Automation Directory](https://openclawskills.best) - OpenClaw Skills are local automation modules that extend your AI gateway with real actions. They let...

29. [What is OpenClaw (Moltbot / Clawdbot)? Step-by-Step ... - Hunto AI](https://hunto.ai/blog/clawdbot/) - Install one or two skills that you need. For example, an email triage skill or a calendar skill. Tes...

33. [Exploring the OpenClaw Extension Ecosystem: 50+ Official ...](https://help.apiyi.com/en/openclaw-extensions-ecosystem-guide-en.html) - ClawHub is the official skill store for OpenClaw, located at clawhub.ai, featuring over 700 communit...

