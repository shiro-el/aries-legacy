---
name: call-human
description: Call the human through Whip when the main agent needs a decision, has a result ready for review, or must report a time-sensitive problem. Subagents report to the main agent instead.
---

# Call the human

Only the main agent calls the human: the agent in the first pane of the
workspace's lowest-numbered tab. If you are a subagent or delegated worker,
report your result, question, or blocker to the main agent; do not call directly.
Never change pane identity to bypass this rule. The host records ineligible
calls silently with the reason `자격 없음`.

Choose the least disruptive urgency that fits:

- `emergency`: Immediate action is needed to prevent serious, imminent harm,
  such as active data loss. Intended for repeated sound even in silent mode;
  never use for routine completion, ordinary blockers, or approval requests.
- `urgent`: Work cannot safely continue without a prompt human decision, or
  a deadline needs attention now. Intended for sound, vibration, and watch alerts.
- `check`: Default for a non-urgent question, completed work ready for review,
  or a decision the human can make when convenient. General notification.
- `record`: Informational progress or a result requiring no action now.
  Written to the call log without a push.

These are requested notification levels; actual presentation depends on the
installed phone version and its notification permissions. All calls are logged,
including calls suppressed by an active app lease. Do not repeatedly call or
escalate just because the human has not replied. Combine related updates.

## Send a call

Run in your original Herdr pane, retaining `HERDR_PANE_ID` and
`HERDR_SOCKET_PATH`. Do not invent those values or copy another pane's identity.

Discover the installed executable and configuration instead of guessing paths:

```sh
herdr plugin action invoke paths --plugin dev.whip.notify
herdr plugin log list --plugin dev.whip.notify --limit 20
```

Match the returned action's log ID and wait for its successful completion.
Its stdout is JSON with `binary`, `config`, and `state` absolute paths. If the
action fails or the plugin is absent/disabled, report that to the user in the
current conversation; do not install, reconfigure, or retry a call blindly.
Use those discovered paths (quoted as individual arguments) to invoke:

```sh
"<binary>" --dirs "<config>" "<state>" call \
  --urgency check \
  --title 'Review ready' \
  --body 'Implementation and tests are complete. Please choose the next step.' \
  --option 'Review diff' \
  --option 'Run more checks'
```

The placeholders above must be replaced with the actual discovered paths.
The same command works in Claude Code and Codex; invoke this skill as
`/call-human` in Claude Code or `$call-human` in Codex.

Supply `--urgency`, a short `--title`, and a self-contained `--body` saying what
happened, what decision is needed, and why it matters. Keep secrets out of both.
For a simple decision, add zero to three repeated `--option` arguments with
short, distinct answer text. These are answers sent back to the agent, not
commands to execute automatically. Omit options for a long free-text response;
the human can open the pane's composer. Approval prompts must be reviewed and
approved in the app; never represent an option as permission approval.

A successful command means the host accepted the call, not that the human saw
it or replied. Delivery can be suppressed or fail after recording; do not
resend automatically. Continue independent authorized work while awaiting a
reply, and report the result in the conversation as well.
