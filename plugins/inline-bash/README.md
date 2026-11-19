# dsh-inline-bash

Claude-Code-style inline bash for the DeepSeek Harness **Web** composer: type
`!pwd` (or `! pwd`) into the composer and press **Enter** — the command runs
locally in the Session's working directory, its output appears in a terminal
card right above the composer, and **no model turn is started and nothing is
added to model context**.

```
┌──────────────────────────────────────────────────────────────┐
│ BASH  Enter runs locally — no model turn  Shift+Enter newline │
└──────────────────────────────────────────────────────────────┘
┌ $ pwd ─────────────────────────────────────────────── exit 0 ┐
│ $ pwd                                                         │
│ /home/user/project                                            │
│ exit 0                                                        │
└───────────────────────────────────────────────────────────────┘
│ Describe what you want to build, / commands, @ files …       │
```

While the draft starts with `!` the composer card is outlined in the warm clay
accent and the bash banner is shown, so the mode is never ambiguous.

## Install

The plugin is a normal third-party DSH package: a host half (Cordis ES module)
plus a browser half (`dsh.client` bundle). Install it as a `file:` dependency
of the profile that should expose it, then add one row to the profile patch.

```bash
# 1. copy/clone the plugin somewhere stable, e.g. it already lives at
#    <workspace>/inline-bash
cd ~/.dsh/profiles/web          # the target profile (back it up first)
pnpm add file:$HOME/dsh-workspace/inline-bash
```

Append the row to the profile's `cordis.patch.yml` (a new `insert` block is
fine; if the file already opens with an `insert`, put it under a later one):

```yaml
- insert:
    - id: inline-bash
      name: dsh-inline-bash
```

Restart `dsh web` (or reload the page after the profile reloads) and open the
composer. That is the whole install — no build step is needed because
`lib/index.js` and `lib/client.js` are committed.

To update from source after editing `src/`:

```bash
cd <workspace>/inline-bash
node scripts/build.mjs        # regenerates lib/index.js and lib/client.js
```

Then touch/restart the profile entry (the browser bundle is served by revision,
so a page reload picks the new `client.js`).

## Usage

| Gesture | Behavior |
|---|---|
| `!cmd` + **Enter** | Runs `cmd` in the Session cwd; output card above the composer |
| `! cmd` + **Enter** | Same (leading space after `!` is ignored, like Claude Code) |
| `!` + **Enter** | No command — hint card, nothing sent to the model |
| **Shift+Enter** | Inserts a newline as usual; a multi-line `!` draft runs as one script on Enter |
| **Escape** (draft starts with `!`) | Clears the draft and leaves bash mode |
| `×` on the card | Dismisses the local result card |
| `→ В чат` on the card | Sends the command result (bounded display text) as one model message to the current chat; the button changes to `Отправлено` |
| Any ordinary draft | Completely untouched — Enter is never intercepted |

The card is content-sized and aligned with the main conversation column (its width is
bounded by `--dsh-chat-content-width`, up to 920 px), so it no longer sticks to the far left
or stretches across the whole composer. The `→ В чат` button posts the displayed
result (plus a truncation note when applicable) through
`conversation.sendSession(...)`, which starts a normal model turn in the same
Session; the command itself still never enters model context automatically.

The command runs through the mounted `ctx.shell` executor exactly as a
model-invoked `bash` tool call would: the per-call sandbox policy is resolved
for the receiving Session, so the Session cwd is the `workspace-write`
boundary and the Session's permission mode applies. A denied write is reported
in the output (`[sandbox denied a file operation]`); there is no approval flow,
matching a human-run shell command in the same Session.

## Verification (scratch profile)

Verified end-to-end against DSH 0.2.2-rc.1 in a disposable profile
(`DSH_HOME=/tmp/ib-dsh`, profile `ibtest`, bundles `@deepseek-ai/dsh-base` +
`@deepseek-ai/dsh-web-app`, plugin installed with `pnpm add file:...`):

- `!pwd` → card shows `$ pwd` + `$HOME/dsh-workspace` + `exit 0`.
- Session log (`command/run`, `command/done`) contains **only** the two
  log-only command events per invocation — no `turn/start`, no `user/message`,
  no `request/header`. `CommandResult` text is human-only and never becomes a
  model message.
- An ordinary draft (`hello ordinary message`) is not intercepted: pressing
  Enter took the normal Session prompt path (`agent/inbox/spliced`, `turn/start`,
  `user/message`, `request/header`) and failed only locally with
  `MISSING_CREDENTIAL` because the scratch profile has no API key.
- New Session creation, Session switching, and a full page reload all keep the
  dock working.
- No page errors or 4xx/5xx responses were observed.

Screenshots live in [`shots/`](shots/):

| File | Shows |
|---|---|
| `bash-mode.png` | Bash banner + clay composer outline while typing `!pwd` |
| `pwd-result.png` | Result card for `!pwd` (cwd + exit 0) |
| `bash-space.png` | The `! pwd` space form |
| `nonzero-exit.png` | Failed command (`ls` on a missing path, exit 2, stderr) |
| `truncated-output.png` | Long output bounded to 50 lines / 8 KB with a note |
| `multiline-draft.png` | Multi-line `!` draft with Shift+Enter |
| `escape-cleared.png` | Escape cleared the draft and left bash mode |
| `ordinary-draft.png` | Ordinary draft — no banner, no interception |
| `second-session.png` | Same behavior after creating a new Session |
| `after-reload.png` | Same behavior after a page reload |

## How it works

Host half (`src/index.js` → `lib/index.js`):

- `export const inject = ['commands']`; `apply(ctx)` registers one human-only
  command with `ctx.commands.register({ name: 'bash', input: { hint: '<command>' } })`.
  Human commands are rendered outside model history and never become model
  messages (see `@deepseek-ai/dsh-commands`).
- The handler reads the Session cwd with `ctx.workingDirectory.get(agent.session)`,
  resolves the Session's sandbox policy with `ctx.sandboxPolicy.resolve({ session })`
  and executes through `ctx.shell`:
  `shell.execute(shell.resolve({ command, workdir, timeoutMs, signal, sandboxPolicy }))`
  then `await execution.result()`.
- It formats `$ cmd`, stdout, stderr, timeout/truncation/sandbox facts and
  `exit N`; `kind: 'success'` for exit 0, `kind: 'error'` otherwise (including
  timeouts, cancellations, and sandbox runner failures).

Browser half (`src/client.js` → `lib/client.js`, ModuleLoader CJS bundle):

- Registers a `conversation.input.dock` slot entry. Per-session `inject`
  supplies `run(command)`, which calls the public Session-addressed Remote
  `ctx.remote.commands.execute(sessionId, '/bash ' + command, [])` and returns
  the host `CommandResult`; that is exactly the RPC `/` commands use, so the
  command lifecycle is durably logged and nothing is submitted as a prompt.
- Reads the draft with the standard `useInput` prop (fallback: the input-dock
  `InputZone` currency), paints the banner/card, and toggles
  `[data-composer-card][data-inline-bash="on"]`.
- A `document` **capture-phase** `keydown` listener intercepts Enter (and
  Escape) only while the draft starts with `!` and the composer editor is
  focused; it calls `preventDefault()`/`stopImmediatePropagation()` so the
  composer's submit machine never sees the key, then clears the draft through
  the public `inputActions.setDraft('')`.
- The result is bounded to 50 lines / 8 KB for display and rendered in a local
  React card; no Session mutation beyond the host command log.

## Limitations

- **Interception is Enter/Escape only.** Clicking the Send button while the
  draft is a `!` line sends that literal `!cmd` text to the model, because the
  Send button is owned by the composer and this plugin registers no DOM hook
  for it. Use Enter for bash mode (that is the documented gesture). A future
  version can register a client command/shortcut for mouse submission if DSH
  exposes one.
- **Bash mode is draft-leading only** — `!cmd` must be at the start of the
  draft (leading whitespace is tolerated). A `!` in the middle of a message is
  ordinary text.
- **Attachments are ignored in bash mode**: the command runs and the draft is
  cleared, but attachment cards stay in the composer for the next message.
- **The result also appears in the transcript** as the generic human-command
  flow node (the durable `command/run`/`command/done` row). That row is
  human-only, rendered by the standard command view, and is not model context.
  The plugin's own card is the near-composer rendering.
- **No command history** (↑/↓ recall) yet; the draft, the card content, and the
  card dismissal state are per-Session component state and reset on Session
  switch/page reload.
- **Output is display-bounded by the UI card** (50 lines / 8 KB shown, note
  appended). The host text itself is bounded by the shell executor's output
  caps; a truncated stream says `[stdout truncated at the executor output cap]`.
- **Requires the Web client composition** (`dsh-client-ui-conversation`'s
  `conversation.input.dock` slot, the `remote.commands` Remote, and a mounted
  `ctx.shell`). The host half activates only with `commands`; missing
  shell/working-directory services produce an error result card instead of
  failing the profile.
- **No approval prompt**: commands run under the Session's sandbox policy and
  inherits its permission mode (base-backed Web profiles default to
  `workspace-write`), exactly like a human-run local command.

## Layout

```
inline-bash/
├── package.json          # dsh.client manifest, exports, build script
├── scripts/build.mjs     # src/ -> lib/ (host copy + ModuleLoader wrapper)
├── scripts/smoke-test.py # Playwright smoke test for a running scratch profile
├── src/index.js          # host half source
├── src/client.js         # browser half source (factory body)
├── lib/index.js          # built host half (committed, Loader entry)
├── lib/client.js         # built browser half (committed, ModuleLoader bundle)
├── shots/                # verification screenshots
└── README.md
```
