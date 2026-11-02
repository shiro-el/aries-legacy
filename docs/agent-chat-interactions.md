# Chat and terminal selection

Each terminal remembers whether Chat or Terminal was selected, including across
app restarts. Opening Chat in one terminal does not change another terminal's
selection. Offline hosts restore cached Chat when available. Closing a terminal
discards its selection; new terminals start in Terminal.

Chat hides terminal key and modifier buttons. Paste, History, and Scan links
remain available, with the usual keyboard visibility rules. When the composer
is open, Paste and History insert into its draft at the cursor or replace the
selected text without submitting. Opening History keeps the composer open.
With the composer closed, Paste and History send input to the terminal.

Chat also hides the keyboard toggle. Its composer always allows the keyboard
when focused, including after dismissal, app backgrounding, or draft restoration.
Restoring Chat does not focus the input. Native keyboard dismissal or blurring
the composer cancels pending focus requests without closing the draft. Dragging
the transcript dismisses the keyboard on Android and interactively on iOS.

Terminal remembers keyboard eligibility separately for each tab while the app
is running, including navigation to Herd and remounting the terminal screen.
Entering a tab always leaves the keyboard down. When enabled, tapping the
terminal or composer opens it. Scrolling the terminal or dragging its scrollbar
dismisses the keyboard, and tapping terminal output dismisses an open composer’s
keyboard. These actions preserve the tab’s enabled setting and draft.

# Pinned chat context

Chat keeps a compact preview of the most recent user prompt above the visible
history at the top of the screen. It follows the history being read, including
follow-up prompts within one turn, and yields while the original prompt is
still visible. Tap the preview to reveal that message without enabling automatic
scrolling. Image-only prompts show an attachment label. Search temporarily takes
over the top of the screen so pinned context cannot cover a search result.

A live chat shows animated **Working (5s)** inline at the end of the transcript.
At the latest output there is no floating activity bar. Reading earlier history
reveals a compact bar above the controls when a useful summary or tool is
available. Tap it to return to the latest output and resume following. Returning
near the bottom immediately hides the bar. The inline row keeps its layout while
offscreen, so these transitions do not change the scroll range.

The strip shows the latest usable reasoning-summary line as soon as it arrives,
including summaries already marked complete by Codex. Heading and leading bold
formatting are removed, and empty or incomplete updates retain the last useful
line. Recorded assistant progress text supplies context when reasoning summaries
are absent. A concrete in-flight tool takes priority immediately and remains
visible for at least three seconds from its first display. A long call remains
until it finishes. Completion before three seconds retains the call for the
remaining time, then restores the newest reasoning summary. New summaries and
metadata updates do not restart that deadline; a new call gets a fresh window.
Opaque Codex code wrappers never replace useful context with “Running tools.”
A follow-up clears the previous narrative. Without useful context, the floating
bar stays hidden. Chat never inserts a generic “Thinking” placeholder.

Held tool previews clear when the bar hides, the chat changes, or work ends.
They do not alter tool state or retained transcript history. Original transcript
content remains available for copying and search.

Elapsed time uses the recorded turn start, with a local start as a fallback.
It survives tool changes and returning to the bottom, and resets for a new turn.
Only the visible inline status ticks once per second; it does not rerender the message
list. A broad highlight travels left to right across “Working,” with a one-second
sweep every four seconds after a 600 ms initial delay, following Codex's
`summary_shimmer.rs`. The elapsed text stays steady. Shimmer and spinner respect
reduced motion.

Prompt context follows Codex CLI's `transcript_view/prompt_header.rs`. Reasoning
summary formatting follows `chatwidget/streaming.rs` and elapsed status follows
`status_indicator_widget.rs`; Codex renders its status
separately from the scrolled transcript in `chatwidget/rendering.rs`. These were
inspected in the refreshed checkout at `89461ea6833832b0551ce24ee32205824d5c108d`.

# Agent questions

Aries displays structured question text and options from transcript tool calls
and event notices. The rebuilt chat uses the native `questions` projection for
Claude Code (`AskUserQuestion`), Codex (`request_user_input` and
`request_user_input_async`), and OpenCode (`question`), including namespaced
names. Recorded questions and answers remain readable after a prompt is gone;
history alone does not establish that the agent still needs input.

When there is no live prompt, the latest recorded question in the latest turn
also offers answer buttons. Tapping an option sends its exact label as a normal
chat message through the composer's `send` / `submitPastes` path. A fresh live
prompt check happens before sending; a queued question takes over with its
PromptCard instead. A subsequent user message makes the recorded question
read-only, including a reply within the same turn. Earlier questions and older
turns remain read-only. Buttons expose pressed, disabled, sending, and sent
states and spoken labels. A failed send displays its error and allows a retry;
a successful send stays disabled while the transcript catches up.

Live questions use a fresh, identity-checked TUI read. A blocked pane enables
this reader. The latest turn's async question also triggers discovery, since
Codex can complete the tool call and Herdr can report done while its question
remains queued. Unblocked Codex panes expose controls only when the live screen
has a recognized question queue or expanded async question editor. A verified
prompt keeps the chat header showing that the agent needs the user; Herdr's
underlying lifecycle status is unchanged.

Tap **Open question** to enter Codex's queued prompt, then tap an option to move
the TUI selection and submit with Enter. Aries uses the shortcut shown by the
running CLI: Shift+Left for current Codex, Shift+Enter for older versions.
Cursor movement is checked against the same question and selected option before
submission. **Type your own answer below** routes the composer through Codex's
Other row (or Claude's Type something row), sending plain typed text and Enter.
Skip uses Ctrl+] in the current async editor. It is unavailable while the
question is collapsed. Prompt reads stop while chat is hidden or the app is
inactive. Discovery retries are bounded when no live question is found.

The current Codex behavior was checked in the local `codex-powerline` checkout
at `360319d8dee62d87e2d59fc0c21805d79519cfed`, in:

- `codex-rs/tui/src/keymap.rs` (Shift+Left, Ctrl+], Shift+Right defaults)
- `codex-rs/tui/src/bottom_pane/questions.rs` (collapsed count and shortcut hint)
- `codex-rs/tui/src/bottom_pane/async_questions/input.rs` (selection and submission)
- `codex-rs/tui/src/chatwidget/tests/questions_tests.rs` (choice delivery tests)

Codex's announcement with “Press a number to choose · esc to dismiss · type to
continue” is an inline banner, not a blocking input dialog. The same local
Codex checkout defines this footer in `bottom_pane/actionable_banner.rs` and
routes bracketed pastes straight to the composer in `bottom_pane/mod.rs`
(`handle_paste`). Banner action keys do not intercept input when the composer
contains text. `tui.rs` enables bracketed paste. Aries' `pane_submission_requests`
in `host_runtime/agents.rs` submits message text with Enter via `PaneSendInput`;
Herdr's `app/api_helpers.rs` wraps the text in bracketed paste when enabled.
This was checked in the local Herdr checkout at
`2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`, including
`api_pane_send_input_brackets_text_and_enter_atomically` in `app/api/panes.rs`.
No announcement dismissal or numbered action is sent by the recorded answer.

Upstream history: `7ecb944c` added live terminal controls; `7157d1a9`
implemented the older queued prompt. `0a20be30` replaced those controls with
copyable transcript options, and `31f734aa` preserved structured async choices.
The Aries UI rebuild omitted that question renderer and gated its own live
card on blocked status. At parent `e9e3c7ce`, the evidence is:
`src/ui/chat/ChatScreen.tsx:343` routed every tool to `Tool`,
`src/ui/chat/useAgentChat.ts:212` cleared the prompt unless blocked, and
`packages/react-native-whip-ssh/rust/src/host_runtime/interaction.rs:253`
required blocked again in the native answer path. Its line 22 hardcoded
Shift+Enter. Tool name and async argument normalization already worked in
`src/lib/agentChatBlocks.ts:9` and
`crates/agent-transcript-core/src/agent_transcript/projection.rs:386`.

Paginated Codex history records asynchronous question calls as `AgentMessage`
items with `delivery: "async"` and a structured `questions` array. Whip projects
those items as question tools using their recorded call IDs, instead of rendering
the duplicate Markdown question. Async question titles and string options are
normalized alongside the synchronous question and option-object formats.

Codex asynchronous question replies can arrive as user messages wrapped in
`send_user_message_question_reply` with a JSON answer array. Whip displays the
answer text in order, without the envelope or internal question IDs. Both legacy
and paginated history apply this during live updates and raw cache replay.
Quoted examples and malformed envelopes remain visible as ordinary user text.

Codex approval and question events become historical notices with the available
question, reason, command, requested permissions, or affected file names.
Approvals omitted from the transcript still require a live terminal prompt.
Unsupported or unrecognized TUI layouts can be answered through Open terminal.

Validation:

```sh
node_modules/.bin/jest --runInBand
node_modules/.bin/tsc --noEmit
cargo test --manifest-path packages/react-native-whip-ssh/rust/Cargo.toml -- --test-threads=1
cargo clippy --manifest-path packages/react-native-whip-ssh/rust/Cargo.toml -- -D warnings
cargo fmt --manifest-path packages/react-native-whip-ssh/rust/Cargo.toml --check
```
