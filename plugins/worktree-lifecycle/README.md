# dsh-worktree-lifecycle

A local **DSH host plugin** that adds the two missing lifecycle behaviours to
DSH-created Git worktrees:

1. **Cascade delete** — when a Session is deleted, remove the DSH-created
   worktree and its `dsh-*` branch. Plain project checkouts and manually created
   worktrees are never touched.
2. **Per-project create hook** — when a Session starts working inside a
   DSH-created worktree, run the project's setup hook once
   (`<project>/.dsh/worktree-create.{json,sh}`, plus `.dsh/worktree-create.d/*`).

Built for DSH `0.2.2-rc.1` (web profile). No client half: this is host-only, so
there is nothing to rebuild in the Web bundle after installing.

---

## Install

The plugin is a plain ESM package with a bundle patch. Install it into the
profile and name the bundle in the profile's bundle list (the bundle patch row
is then composed automatically):

```bash
# 1. back up the profile manifests (house rule for profile edits)
cd ~/.dsh/profiles/web
cp package.json package.json.bak-$(date -u +%Y%m%dT%H%M%SZ)
cp cordis.patch.yml cordis.patch.yml.bak-$(date -u +%Y%m%dT%H%M%SZ)

# 2. install the package (file: dependency on the local checkout)
pnpm add file:$HOME/dsh-workspace/worktree-lifecycle

#    ...or through the CLI wrapper, which forwards to the same pnpm:
#    dsh plugin --profile web add file:$HOME/dsh-workspace/worktree-lifecycle

# 3. append the package name to dsh.profile.bundles in profile package.json
#    (next to "@hualiong/dsh-session-delete"):
#    "dsh-worktree-lifecycle"
```

`package.json` must end up with both halves:

```jsonc
{
  "dsh": { "profile": { "bundles": [ /* … */ "@hualiong/dsh-session-delete", "dsh-worktree-lifecycle" ] } },
  "dependencies": { "dsh-worktree-lifecycle": "file:$HOME/dsh-workspace/worktree-lifecycle" }
}
```

The row itself is inserted by the package's own `cordis.patch.yml`
(`id: worktree-lifecycle`), so **no manual `insert` row is needed**. Optional
per-profile overrides go into the profile patch layer, targeting the same id:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: worktree-lifecycle
  config:
    hookTimeoutMs: 600000
    runCreateHook: true
```

Restart or reload the DSH web process (a plugin-row install needs a restart;
profile changes are not hot-applied to a running server). The plugin logs one
`worktree-lifecycle: loaded (state …)` line on activation.

### Requirements / interaction with other plugins

- The removal trigger is the official client-facing frame
  `api-session/removed` (the session controller relays every store removal as
  it, and `@hualiong/dsh-session-delete` emits it for the deletion path). Keep
  the session-delete plugin installed: without a delete UI/route nothing
  deletes sessions, and the cascade never runs.
- `@deepseek-ai/dsh-home-paths` is a normal dependency (installed by `pnpm add`).
  `@deepseek-ai/schemastery` and `@deepseek-ai/cordis` are optional peers
  resolved by DSH's installation-scoped `@deepseek-ai/*` resolution.

## Configuration

`Config` fields (all optional; defaults shown):

| key | default | meaning |
| --- | --- | --- |
| `enabled` | `true` | master switch |
| `cascadeDelete` | `true` | remove the worktree + `dsh-*` branch on Session delete |
| `runCreateHook` | `true` | run the project create hook |
| `hookTimeoutMs` | `300000` | per hook command timeout |
| `gitTimeoutMs` | `120000` | per Git maintenance command timeout |
| `hookShell` | `/bin/sh` | shell for `.sh` and `.d/` scripts |
| `graceMs` | `5000` | subprocess termination grace |
| `maxOutputBytes` | `262144` | collected stdout/stderr cap per command |
| `stateFile` | `""` | state path; empty = `<DSH_HOME>/worktree-lifecycle.json` |

## Create hook format

A project opts in by committing (or keeping untracked in the project root) any
of these under `<project>/.dsh/`:

```text
.dsh/
  worktree-create.json      { "run": ["pnpm", "install"] }
  worktree-create.sh        #!/bin/sh …        (run with $hookShell)
  worktree-create.d/        10-install.sh, 20-db.sh …   (sorted, run in order)
```

Resolution order inside one directory: `worktree-create.json` → `.sh` → `.d/*`
(sorted by filename). The first directory that yields commands wins —
`<repo>/.dsh` is checked first, then the worktree's own `.dsh` — so a committed
copy in the worktree does not run twice.

The hook runs **inside the new worktree** (`cwd = worktree path`) with:

| env | value |
| --- | --- |
| `WORKTREE_PATH` | absolute worktree checkout |
| `WORKTREE_BRANCH` | checked-out `dsh-*` branch |
| `WORKTREE_REPO` | main repository root (owner of `.git/worktrees/`) |
| `SESSION_ID` | the Session id |

Behaviour: fire-and-forget from the host's turn — it never blocks and never
fails the agent turn. Commands run sequentially and stop at the first non-zero
exit. Output is appended to
`<DSH_HOME>/logs/worktree-lifecycle/<session-id>.log`; a one-line summary goes
to the host log. A run is recorded in the state file **before** the first
command under the key `<sessionId>::<worktreePath>`, so the hook runs exactly
once per Session per worktree (including after a restart).

### The first-step race

DSH creates the worktree and commits the new working directory in the Session's
**step 1** (the forge worktree option creates it in `agent/pre-step`). This
plugin sees the committed `working-directory/change` event and starts the hook
asynchronously; the model's first tool call may already be running while `pnpm
install`-style setup is still in progress. **Do not assume the hook finished
when the first command runs.** If a project needs a hard barrier, gate the first
step on a file the hook writes (for example, the hook writes `.dsh/hook-done`
and the agent's first instruction waits for it), or install from the hook itself
instead of relying on the agent.

## Cascade delete

Trigger: `api-session/removed`. Ordinary store disposal relays the same frame,
so the handler first re-checks that the Session's log directory is really gone
(`<DSH_HOME>/sessions/<project>/<id>/`); a dispose relayed while the log still
exists is **not** a deletion and is skipped.

The Session's worktrees are known from `session/created` (header cwd), every
`working-directory/change`, the forge `plugin:client-ui-forge/worktree`
`created` record, and — for cold Sessions this process never loaded — the
on-disk log read on `workspace/session-stop` through `sessionQuery`. The mapping
lives in the state file, so it survives the (already deleted) Session log.

For each recorded worktree the handler re-proves everything from the filesystem
and then runs:

```bash
git -C <main-repo> worktree remove --force <worktree>
git -C <main-repo> branch -D <branch>
```

and finally forgets the Session in the state file. It logs `skip <path>:
<reason>` for every refused step.

### Safety rules (all enforced in code)

- **Only `<repo>/.agents/worktrees/*` or `<repo>/.dsh/worktrees/*`.** A checkout
  anywhere else is never touched.
- **Only linked worktrees.** The checkout root must have a `.git` **file**
  resolving to `<main>/.git/worktrees/<name>`; a plain project checkout
  (`.git` directory) is rejected before Git runs.
- **Git's own registration must agree.** `<gitdir>/gitdir` must point back at
  this checkout's `.git` file, and `git worktree list` must list the path.
- **Only `dsh-*` branches.** Branch names are read from the worktree HEAD and
  must start with `dsh-`; the branch is never deleted while any registered
  worktree still has it checked out.
- **Never the source checkout.** A path equal to (or containing) the main
  repository root is refused.
- **No blind `rm -rf`.** The code only ever removes a directory through
  `git worktree remove --force` after the proofs above; it does not implement a
  filesystem fallback. A failed Git removal leaves everything in place and logs
  why.
- **Shared worktrees are left alone.** If another tracked Session still
  references the same worktree path, the cascade skips it.
- **Idempotent.** A worktree already removed manually only has its stale Git
  registration pruned and the `dsh-*` branch deleted.

### Not confined by the agent sandbox

Both the create hook and the Git maintenance commands are host-side lifecycle
operations: they run through DSH's subprocess seam (`ctx.subprocess`, with a
`node:child_process` fallback for terminal-only profiles) but **not** through the
Session's sandbox policy. The create hook is arbitrary code committed in the
project, so treat `.dsh/worktree-create.*` exactly like a `Makefile` that runs on
checkout — only enable it for repositories you trust.

## State file

`<DSH_HOME>/worktree-lifecycle.json` (mode `0600`, written atomically):

```jsonc
{
  "version": 1,
  "sessions": {
    "session-…": {
      "cwd": "/repo/.agents/worktrees/dsh-…",
      "worktrees": [{ "path": "…", "repo": "…", "branch": "dsh-…", "at": 1700000000000 }],
      "updatedAt": 1700000000000
    }
  },
  "hooks": {
    "session-…::/repo/.agents/worktrees/dsh-…": { "at": 1700000000000, "status": "ok", "exitCode": 0 }
  }
}
```

`hooks[].status` is `running`, `ok`, `failed`, `invalid`, `error`, or `none`
(no hook configured). Hook markers expire after 30 days; Session entries are
removed by the cascade.

## Limitations

- Sessions that were never loaded by the running host are attributed from the
  on-disk log read on `workspace/session-stop`; if `sessionQuery` is unavailable
  and the Session is deleted cold, its worktree cannot be found and is left in
  place (a `no tracked worktree` log line).
- Worktrees created with something other than DSH (no DSH pool path, no `dsh-`
  branch) are intentionally invisible to the plugin.
- A worktree whose HEAD was switched away from its `dsh-*` branch is detected
  from the tracked record only as far as Git's `worktree remove` allows; the
  non-`dsh-*` branch is never deleted.
- The removal frame is the delete contract of this DSH version; a future
  removal path that does not emit it would not cascade (watch the host log).
- Nested pools (a DSH worktree created inside another DSH worktree) are cleaned
  through the true main repository resolved from `.git/worktrees/`.

## Verification

Engine tests (real Git repositories under a throwaway `/tmp` directory):

```bash
cd $HOME/dsh-workspace/worktree-lifecycle
npm run build
npm test        # node --test test/
```

Scratch-profile integration (what was actually checked for this delivery):

- plugin row loads in a scratch `DSH_HOME=/tmp/wl-dsh` profile on port 3098 with
  no load errors;
- a Session entering a real `git worktree add -b dsh-aaaa1111-bbbb
  .agents/worktrees/…` ran `.dsh/worktree-create.sh` once, with
  `WORKTREE_PATH/WORKTREE_BRANCH/WORKTREE_REPO/SESSION_ID` set, cwd inside the
  worktree, output in `<DSH_HOME>/logs/worktree-lifecycle/`;
- `POST /__chameleon/session/delete` (the installed
  `@hualiong/dsh-session-delete` route) removed the worktree and the
  `dsh-aaaa1111-bbbb` branch, kept the source checkout, kept an unrelated
  `feature/keep` worktree, and cleared the Session's state entry;
- a path that is not a proven DSH worktree (forged `.git`, plain checkout,
  non-`dsh-*` branch) is refused without touching the directory.

The scratch server was stopped after the checks; the live `:3099` server and
the live profile were never touched.
