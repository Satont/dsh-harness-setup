/**
 * Host half of dsh-inline-bash.
 *
 * Registers a human-only `/bash <command>` command through `ctx.commands` so
 * the browser half can run a local shell command in the Session working
 * directory without creating a model message: the command lifecycle is logged,
 * the result is returned to the dispatching UI, and nothing reaches model
 * context.
 *
 * The command runs through the mounted `ctx.shell` executor, so it inherits
 * exactly the deployment's command authority and sandbox policy (base-backed
 * Web profiles mount the sandboxed bash executor). The per-call sandbox policy
 * is resolved for the receiving Session, which makes the Session cwd the
 * workspace-write boundary and honours the Session's permission preset.
 *
 * @module dsh-inline-bash
 */

/** Plugin name used by the Loader diagnostics. */
export const name = 'inline-bash';

/** Required service: the human-command registry. */
export const inject = ['commands'];

/** Default command budget for an interactive, human-run command. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Format one settled shell run as the text the dispatching UI renders.
 * A result is human-only: the command registry never submits it to the model.
 * @param {string} command - exact command text the user asked to run.
 * @param {object} result - settled `ShellRunResult` (stdout/stderr are CollectedOutput).
 * @returns {string} `$ command` header, bounded output streams, and the exit line.
 */
function formatRun(command, result) {
  /** @type {string[]} */
  const lines = [`$ ${command}`];
  const stdout = String(result.stdout?.text ?? '').replace(/\s+$/, '');
  const stderr = String(result.stderr?.text ?? '').replace(/\s+$/, '');
  if (stdout) lines.push(stdout);
  if (stderr) lines.push(stderr);
  const truncated = [];
  if (result.stdout?.truncated) truncated.push('stdout');
  if (result.stderr?.truncated) truncated.push('stderr');
  if (truncated.length > 0) {
    lines.push(`[${truncated.join(' and ')} truncated at the executor output cap]`);
  }
  if (result.timedOut) lines.push(`[timed out after ${result.timeoutMs} ms]`);
  if (result.aborted) lines.push('[cancelled]');
  if (result.sandbox?.denied) lines.push('[sandbox denied a file operation]');
  if (result.sandbox?.runnerFailed) lines.push('[sandbox runner failed before the command ran]');
  const exitCode = result.exitCode === null
    ? (result.signal ? `signal ${result.signal}` : 'no exit code')
    : `exit ${result.exitCode}`;
  lines.push(exitCode);
  return lines.join('\n');
}

/**
 * Read the Session working directory without filesystem I/O.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin root context.
 * @param {object} agent - receiving Agent.
 * @returns {string} absolute Session cwd, or the harness process cwd as a fallback.
 */
function sessionCwd(ctx, agent) {
  const workingDirectory = ctx.get('workingDirectory');
  if (workingDirectory !== undefined && agent?.session !== undefined) {
    try {
      const cwd = workingDirectory.get(agent.session);
      if (typeof cwd === 'string' && cwd.length > 0) return cwd;
    } catch {
      // The projection may not be ready for a session created outside this plugin.
    }
  }
  return process.cwd();
}

/**
 * Resolve the per-call sandbox policy for the receiving Session so a confined
 * executor uses the Session cwd as its workspace-write boundary and the
 * Session's permission mode instead of the deployment fallback.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin root context.
 * @param {object} agent - receiving Agent.
 * @returns {object | undefined} resolved policy, or undefined without a policy service.
 */
function sandboxPolicyFor(ctx, agent) {
  const sandboxPolicy = ctx.get('sandboxPolicy');
  if (sandboxPolicy === undefined) return undefined;
  try {
    return sandboxPolicy.resolve(agent?.session === undefined ? {} : { session: agent.session });
  } catch {
    return undefined;
  }
}

/**
 * Run one command through the mounted shell executor and return its UI text.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin root context.
 * @param {object} agent - receiving Agent whose Session supplies cwd and policy.
 * @param {string} command - shell command text.
 * @param {AbortSignal} signal - dispatch cancellation.
 * @returns {Promise<{kind: 'success' | 'error', text: string}>} human-only command result.
 */
async function runCommand(ctx, agent, command, signal) {
  const shell = ctx.get('shell');
  if (shell === undefined) {
    return {
      kind: 'error',
      text: 'inline-bash: the shell executor (ctx.shell) is not mounted in this profile',
    };
  }
  const cwd = sessionCwd(ctx, agent);
  try {
    /** @type {object} */
    const request = { command, workdir: cwd, timeoutMs: DEFAULT_TIMEOUT_MS };
    if (signal !== undefined) request.signal = signal;
    const sandboxPolicy = sandboxPolicyFor(ctx, agent);
    if (sandboxPolicy !== undefined) request.sandboxPolicy = sandboxPolicy;
    const execution = await shell.execute(shell.resolve(request));
    const result = await execution.result();
    const ok = !result.timedOut
      && !result.aborted
      && result.exitCode === 0
      && result.sandbox?.runnerFailed !== true;
    return { kind: ok ? 'success' : 'error', text: formatRun(command, result) };
  } catch (error) {
    return {
      kind: 'error',
      text: `inline-bash: failed to run the command: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Register the `/bash` human command.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin root context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.commands.register({
    name: 'bash',
    description: 'Run a local shell command without the model (uses the Session working directory)',
    input: { hint: '<command>' },
    handler: async ({ agent, rawInput, signal }) => {
      const command = String(rawInput ?? '').trim();
      if (command.length === 0) {
        return {
          kind: 'error',
          text: 'Usage: /bash <command> — runs a local shell command in the Session working directory without the model.',
        };
      }
      return await runCommand(ctx, agent, command, signal);
    },
  }), 'inline-bash: /bash command');
}

