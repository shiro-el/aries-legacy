# Composer voice input

Agent composers have a **Voice** button beside Send. Shell panes and the
terminal have none.

1. Add a Groq API key under Hosts → This phone → Voice input. Only its last
   four characters are shown; the key stays in the phone's keychain.
2. Tap **Voice**. The text field becomes a recording bar with the elapsed time
   and input level. **Cancel** throws the recording away; **Stop** ends it.
   Recording stops by itself at ten minutes.
3. The recording goes to Groq `whisper-large-v3` in Korean. Words from the
   draft and the last ten messages are sent as the prompt so identifiers and
   English terms are spelled as they appear there.
4. The text is inserted at the caret, replacing any selection. Nothing is sent
   until you press Send.

If Groq rejects the key, rate-limits, or cannot be reached, the recording is
kept: **Retry** sends it again, **Discard** deletes it. Only the latest failed
recording is kept, and none survive an app restart.

## Polish

After a transcript is inserted, **Polish** asks Claude Haiku on the pane's host
to tidy it: fillers, repetition, punctuation, misheard file names and
identifiers (looked up in the pane's folder with read-only tools), and order.
It must not drop or add points, change your register, or act on what you said.
**Original** puts back the transcript as spoken.

Polish applies only to the newest transcript. Editing inside it, sending, or
dictating again removes the button; edits elsewhere in the draft do not. If
Haiku takes more than 30 seconds, fails, or `claude` is not installed on the
host, the transcript stays as it was.
