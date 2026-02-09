# Slack App Setup Guide

This guide walks you through creating a Slack App for the OpenClaw WhatsApp Logger. The bot posts WhatsApp messages and auto-replies to a dedicated Slack channel using organized threads.

## Step 1: Create a Slack App

1. Go to **https://api.slack.com/apps**
2. Click **"Create New App"**
3. Select **"From scratch"**
4. Fill in the details:
   - **App Name**: `OpenClaw WA Monitor`
   - **Workspace**: Select your workspace
5. Click **"Create App"**

## Step 2: Configure Bot Token Scopes

1. In the left sidebar, go to **"OAuth & Permissions"**
2. Scroll to **"Scopes"** section
3. Under **"Bot Token Scopes"**, click **"Add an OAuth Scope"** and add each of these:

| Scope | Purpose |
|-------|---------|
| `chat:write` | Send messages to channels |
| `chat:write.customize` | Customize bot name/icon per message |
| `channels:read` | List public channels |
| `channels:history` | Read messages in channels (for thread context) |
| `reactions:write` | Add emoji reactions (status indicators) |
| `pins:read` | Read pinned messages (for conversation config) |
| `pins:write` | Pin configuration messages in threads |

## Step 3: Install App to Workspace

1. Scroll to the top of **"OAuth & Permissions"** page
2. Click **"Install to Workspace"**
3. Review the permissions and click **"Allow"**
4. Copy the **"Bot User OAuth Token"** (starts with `xoxb-`)
5. Save this token - you'll need it for the `.env` file

## Step 4: Get the Signing Secret

1. In the left sidebar, go to **"Basic Information"**
2. Scroll to **"App Credentials"**
3. Copy the **"Signing Secret"**
4. Save this - you'll need it for the `.env` file

## Step 5: Create the Monitor Channel

1. Open your Slack workspace
2. Create a new channel: `#wa-monitor` (or any name you prefer)
3. Set the channel to **public** (so the bot can find it) or **private** (and explicitly invite the bot)

## Step 6: Get the Channel ID

1. Right-click on `#wa-monitor` in the sidebar
2. Select **"View channel details"** (or **"Open channel details"**)
3. Scroll to the bottom of the details panel
4. Copy the **Channel ID** (looks like `C0123456789`)

Alternatively, from the browser:
- Open the channel in the Slack web app
- The URL will be: `https://app.slack.com/client/T.../C0123456789`
- The `C0123456789` part is your channel ID

## Step 7: Invite the Bot to the Channel

In the `#wa-monitor` channel, type:

```
/invite @OpenClaw WA Monitor
```

Or if that doesn't work:
1. Click the channel name to open details
2. Go to **"Integrations"** tab
3. Click **"Add apps"**
4. Search for **"OpenClaw WA Monitor"** and add it

## Step 8: Update Your .env File

Add the values you collected to your `.env` file:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_LOG_CHANNEL=C0123456789
```

## Verification

After starting the OpenClaw gateway, verify the connection:

```bash
# Check plugin status
openclaw plugins doctor
```

The plugin will post a test message to `#wa-monitor` on successful startup. If you see the message, the Slack integration is working.

## Troubleshooting

### "not_in_channel" error
The bot hasn't been invited to the channel. Run `/invite @OpenClaw WA Monitor` in the channel.

### "invalid_auth" error
The bot token is incorrect or expired. Go to **OAuth & Permissions** in your Slack App settings and reinstall the app to get a new token.

### "channel_not_found" error
The channel ID is incorrect. Double-check by viewing channel details in Slack. Make sure you're using the channel ID (starts with `C`), not the channel name.

### "missing_scope" error
A required scope is missing. Go to **OAuth & Permissions**, add the missing scope, and **reinstall the app** (Slack requires reinstallation after scope changes).

### Messages appear but no threads
Check that the bot has `channels:history` scope. This is needed for thread operations.

## Security Notes

- The bot token (`xoxb-...`) grants access to post in channels where the bot is invited. Keep it secure.
- Never commit the `.env` file to git (it's already in `.gitignore`).
- The bot can only read/write in channels where it's been explicitly invited.
- Consider rotating the bot token periodically via **OAuth & Permissions > Reinstall App**.
