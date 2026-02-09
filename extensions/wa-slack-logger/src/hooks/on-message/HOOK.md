---
name: wa-slack-on-message
description: Hook triggered on incoming WhatsApp messages. Logs to Slack and evaluates auto-reply.
event: message:received
channel: whatsapp
---

## Behavior
1. Receives incoming WhatsApp message event
2. Logs the message to the corresponding Slack thread (creates thread if new conversation)
3. Evaluates whether an auto-reply should be sent based on per-conversation config
4. If auto-reply triggered, invokes the agent for contextual reply generation
5. Sends reply back to WhatsApp and logs it to Slack
