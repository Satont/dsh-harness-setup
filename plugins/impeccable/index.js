import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

export const name = 'impeccable-detector'
export const inject = ['tools', 'workingDirectory']

const run = promisify(execFile)
const launcher = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'skills/impeccable/scripts/impeccable')
const editTools = new Set(['write', 'edit', 'apply_patch'])

function pathsEdited(tool, value) {
  if (tool !== 'apply_patch') return [value?.path]
  return (value?.operations ?? []).flatMap(operation =>
    (operation.changes ?? []).filter(change => change.after != null).map(change => change.path))
}

function insideProject(cwd, path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  const rel = relative(cwd, path)
  return Boolean(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

async function detect(cwd, path, sessionId, signal) {
  const pending = run(launcher, ['hook'], {
    cwd, signal, timeout: 5000, maxBuffer: 128 * 1024,
    env: { ...process.env, IMPECCABLE_HOOK_QUIET: '1' },
  })
  const child = pending.child
  child.stdin.on('error', () => {})
  child.stdin.end(JSON.stringify({
    cwd, session_id: sessionId, hook_event_name: 'PostToolUse',
    tool_name: 'Write', tool_input: { file_path: path },
  }))
  const { stdout } = await pending
  if (!stdout.trim()) return
  const output = JSON.parse(stdout).hookSpecificOutput
  if (output?.hookEventName === 'PostToolUse' && typeof output.additionalContext === 'string') {
    return output.additionalContext
  }
}

export function apply(ctx) {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (decision.kind !== 'accept' || result.isError || !exec.agent || !editTools.has(exec.name)) return decision
    const session = exec.agent.session
    const cwd = ctx.workingDirectory.get(session)
    const paths = [...new Set(pathsEdited(exec.name, result.value))].filter(path => insideProject(cwd, path))
    if (!paths.length) return decision
    const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(6000)])
    const contexts = []
    for (const path of paths) {
      if (signal.aborted) break
      try {
        const text = await detect(cwd, path, session.header.id, signal)
        if (!text) continue
        contexts.push({
          id: randomUUID(), role: 'user',
          source: { kind: name, form: 'notice', summary: 'Impeccable design findings' },
          content: [{ type: 'text', text }],
        })
      } catch (error) {
        if (!signal.aborted) ctx.logger.warn('Impeccable detector failed: %s', error.code ?? error.name)
        break
      }
    }
    return contexts.length ? { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), ...contexts] } : decision
  })
}
