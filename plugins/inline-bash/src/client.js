/**
 * Browser half of dsh-inline-bash.
 *
 * A `conversation.input.dock` entry that:
 *  - observes the composer draft through the standard `useInput` prop,
 *  - paints a "bash mode" pill above the composer and marks the composer card
 *    (`data-composer-card[data-inline-bash="on"]`) while the draft starts with
 *    `!`,
 *  - intercepts Enter in the capture phase before the composer's submit
 *    machine sees it, runs `/bash <command>` through the Session-addressed
 *    command Remote (host half), clears the draft, and renders the command and
 *    its bounded output as a local terminal card. Nothing is submitted as a
 *    model message and no model turn starts.
 *  - Escape clears the draft and leaves bash mode.
 *
 * Ordinary drafts are untouched: the key listener returns immediately unless
 * the draft starts with `!`.
 *
 * This file is the factory body; `scripts/build.mjs` wraps it in the DSH
 * `window.__ModuleLoader__.load({ id, factory })` bundle form.
 */

const React = require('react');
const h = React.createElement;

/** Maximum lines rendered in the output card. */
const MAX_LINES = 50;
/** Maximum bytes rendered in the output card. */
const MAX_BYTES = 8 * 1024;
/** CSS tag id, also the dedupe key. */
const CSS_TAG = 'dsh-inline-bash/inline-bash.css';

const CSS = `
.ibx-root{display:flex;flex-direction:column;gap:6px;width:fit-content;max-width:min(calc(100% - 32px),var(--dsh-chat-content-width,920px));min-width:min(100%,360px);margin:0 0 8px max(0px,calc((100% - var(--dsh-chat-content-width,920px)) / 2 - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px)));font-family:var(--claude-mono,ui-monospace,"SF Mono",Menlo,monospace)}
.ibx-mode{display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:8px;border:1px solid var(--claude-clay,rgba(217,119,87,.55));background:rgba(217,119,87,.10);color:var(--claude-clay,#d97757);font-size:12px;line-height:1.4}
.ibx-badge{font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.08em;padding:2px 6px;border-radius:4px;background:var(--claude-clay,#d97757);color:var(--claude-surface,#1f1e1b)}
.ibx-hint{opacity:.8;font-size:11px}
.ibx-card{border:1px solid var(--claude-clay,rgba(217,119,87,.45));border-radius:10px;background:var(--dsw-alias-bg-layer-2,#252523);box-shadow:0 2px 10px rgba(0,0,0,.18);overflow:hidden}
.ibx-head{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.04));border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))}
.ibx-cmd{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#f5f4ef);font-size:12px}
.ibx-cmd::before{content:"$ ";color:var(--claude-clay,#d97757)}
.ibx-exit{flex:none;font-size:10px;font-weight:700;letter-spacing:.05em;padding:1px 6px;border-radius:4px;border:1px solid transparent}
.ibx-exit.ok{color:var(--dsw-alias-state-success-primary,#4caf7d);border-color:var(--dsw-alias-state-success-primary,#4caf7d)}
.ibx-exit.fail{color:var(--dsw-alias-label-error,#e06c75);border-color:var(--dsw-alias-label-error,#e06c75)}
.ibx-exit.hint,.ibx-exit.running{color:var(--dsw-alias-label-tertiary,#a9a49a);border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.16))}
.ibx-send{flex:none;display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border:1px solid var(--claude-clay,rgba(217,119,87,.55));border-radius:5px;background:rgba(217,119,87,.10);color:var(--claude-clay,#d97757);font:inherit;font-size:10px;line-height:1.5;cursor:pointer;white-space:nowrap}
.ibx-send:hover{background:rgba(217,119,87,.22)}
.ibx-send:disabled{opacity:.55;cursor:default}
.ibx-copy{flex:none;display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,#d6d2c7);font:inherit;font-size:10px;line-height:1.5;cursor:pointer;white-space:nowrap}
.ibx-copy:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.ibx-copy.copied{color:var(--dsw-alias-state-success-primary,#4caf7d);border-color:var(--dsw-alias-state-success-primary,#4caf7d)}
.ibx-close{flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary,#a9a49a);font-size:14px;line-height:1;cursor:pointer}
.ibx-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#f5f4ef)}
.ibx-out{margin:0;padding:8px 10px;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#d6d2c7)}
.ibx-more{padding:4px 10px 8px;font-size:10px;color:var(--dsw-alias-label-tertiary,#a9a49a);font-family:inherit}
[data-composer-card][data-inline-bash="on"]{border-color:var(--claude-clay,#d97757)!important;box-shadow:0 0 0 1px var(--claude-clay,#d97757),0 0 0 4px rgba(217,119,87,.14)!important}
`;

/** Inject the plugin stylesheet once per page. */
function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-inline-bash';
  tag.dataset.pluginCss = CSS_TAG;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

/**
 * Bound one output stream for the card: at most MAX_LINES lines and MAX_BYTES
 * bytes; the truncation mark is appended by the caller.
 * @param {string} text - full result text.
 * @returns {{text: string, truncated: boolean}} bounded text and truncation flag.
 */
function boundOutput(text) {
  const normalized = String(text == null ? '' : text);
  const lines = normalized.split('\n');
  let truncated = false;
  let kept = lines;
  if (kept.length > MAX_LINES) {
    kept = kept.slice(0, MAX_LINES);
    truncated = true;
  }
  let joined = kept.join('\n');
  if (joined.length > MAX_BYTES) {
    joined = joined.slice(0, MAX_BYTES);
    truncated = true;
  }
  return { text: joined, truncated };
}

/**
 * Short single-line rendering of a command for the card header.
 * @param {string} command - command text.
 * @returns {string} one-line command.
 */
function oneLine(command) {
  return String(command == null ? '' : command).replace(/\s*\n\s*/g, ' ⏎ ').trim();
}

/**
 * Render the close button of the result card.
 * @param {() => void} onClose - close handler.
 * @returns {object} React element.
 */
function CloseButton({ onClose }) {
  return h('button', {
    type: 'button',
    className: 'ibx-close',
    'aria-label': 'Close inline bash output',
    title: 'Close',
    onClick: onClose,
  }, '\u00d7');
}

/**
 * Render the local result card for one command.
 * @param {{result: object, onClose: () => void, onSend?: (text: string) => Promise<void>}} props - card data, close handler and optional send-to-chat handler.
 * @returns {object} React element.
 */
function ResultCard({ result, onClose, onSend }) {
  const bounded = boundOutput(result.text);
  const [sendState, setSendState] = React.useState('idle');
  const [copyState, setCopyState] = React.useState('idle');
  const canSend = (result.kind === 'ok' || result.kind === 'fail') && typeof onSend === 'function';
  const copy = React.useCallback(async () => {
    const text = String(result.text == null ? '' : result.text);
    try {
      if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1200);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 1600);
    }
  }, [result.text]);
  const copyLabel = copyState === 'copied' ? 'Скопировано' : copyState === 'error' ? 'Ошибка' : 'Копировать';
  const send = React.useCallback(async () => {
    if (!canSend || sendState === 'sending' || sendState === 'sent') return;
    setSendState('sending');
    const note = bounded.truncated ? '\n[output truncated for display]' : '';
    const payload = 'Результат inline bash:\n\n' + (bounded.text.length > 0 ? bounded.text : '(no output)') + note;
    try {
      await onSend(payload);
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  }, [bounded.text, bounded.truncated, canSend, onSend, sendState]);
  const badge = result.kind === 'ok' ? 'exit 0' : result.kind === 'fail' ? 'failed' : result.kind === 'running' ? 'running' : 'hint';
  const sendLabel = sendState === 'sent' ? 'Отправлено' : sendState === 'sending' ? 'Отправка…' : sendState === 'error' ? 'Повторить' : '→ В чат';
  return h('div', { className: 'ibx-card', 'data-inline-bash-result': result.kind },
    h('div', { className: 'ibx-head' },
      h('span', { className: 'ibx-badge' }, 'BASH'),
      h('code', { className: 'ibx-cmd', title: result.cmd }, oneLine(result.cmd) || '(empty)'),
      h('span', { className: 'ibx-exit ' + (result.kind === 'fail' ? 'fail' : result.kind === 'ok' ? 'ok' : 'hint') }, badge),
      h('button', {
        type: 'button',
        className: 'ibx-copy' + (copyState === 'copied' ? ' copied' : ''),
        title: copyState === 'error' ? 'Не удалось скопировать' : 'Скопировать вывод команды',
        'aria-label': 'Copy inline bash output',
        onClick: () => { void copy(); },
      }, copyLabel),
      canSend ? h('button', {
        type: 'button',
        className: 'ibx-send',
        disabled: sendState === 'sending' || sendState === 'sent',
        title: sendState === 'error' ? 'Не удалось отправить, попробовать ещё раз' : 'Отправить результат в текущий чат модели',
        'aria-label': 'Send inline bash result to the current chat',
        onClick: () => { void send(); },
      }, sendLabel) : null,
      h(CloseButton, { onClose }),
    ),
    h('pre', { className: 'ibx-out', 'data-inline-bash-output': 'true' }, bounded.text.length > 0 ? bounded.text : '(no output)'),
    bounded.truncated ? h('div', { className: 'ibx-more' }, 'Output truncated for display (first ' + MAX_LINES + ' lines / ' + (MAX_BYTES / 1024) + ' KB).') : null,
  );
}

/**
 * The composer dock entry: bash-mode indication, Enter interception, and the
 * local result card.
 * @param {object} props - slot props (injected `run`/`clearDraft` plus standard useInput/inputActions).
 * @returns {object|null} dock content, or null while idle in plain mode.
 */
function InlineBashDock(props) {
  const { run, send, clearDraft } = props;
  const useInput = props.useInput;
  const draftFromInput = useInput !== undefined ? useInput((state) => state.draft) : undefined;
  const draft = draftFromInput !== undefined
    ? draftFromInput
    : props.input !== undefined ? props.input.draft : '';
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const [result, setResult] = React.useState(null);
  const busyRef = React.useRef(false);
  const seqRef = React.useRef(0);
  const bashMode = typeof draft === 'string' && /^\s*!/.test(draft);

  /** Clear the composer draft through the public input actions, with a scope fallback. */
  const clear = React.useCallback(() => {
    if (props.inputActions !== undefined && typeof props.inputActions.setDraft === 'function') {
      try {
        props.inputActions.setDraft('');
        return;
      } catch {
        // fall through to the injected scope action
      }
    }
    if (typeof clearDraft === 'function') {
      try {
        clearDraft();
      } catch {
        // a dead Session scope keeps the draft; the user can delete it manually
      }
    }
  }, [props.inputActions, clearDraft]);

  /**
   * Run one `!` line end to end: clear the draft, call the host command, render
   * its result locally. Never submits a model message.
   * @param {string} raw - draft text after the leading `!`.
   */
  const submit = React.useCallback((raw) => {
    const command = String(raw == null ? '' : raw).replace(/^\s+/, '').replace(/\s+$/, '');
    if (command.length === 0) {
      clear();
      setResult({ cmd: '', text: 'Type a command after “!”, for example: !pwd', kind: 'hint', at: Date.now() });
      return;
    }
    clear();
    const id = ++seqRef.current;
    busyRef.current = true;
    setResult({ cmd: command, text: 'running\u2026', kind: 'running', at: Date.now() });
    Promise.resolve()
      .then(() => run(command))
      .then((outcome) => {
        if (id !== seqRef.current) return;
        const kind = outcome !== undefined && outcome !== null && outcome.kind === 'success' ? 'ok' : 'fail';
        setResult({ cmd: command, text: String(outcome && outcome.text != null ? outcome.text : ''), kind, at: Date.now() });
      })
      .catch((error) => {
        if (id !== seqRef.current) return;
        const message = error !== undefined && error !== null && error.message !== undefined ? error.message : String(error);
        setResult({ cmd: command, text: 'inline-bash: ' + message, kind: 'fail', at: Date.now() });
      })
      .finally(() => {
        if (id === seqRef.current) busyRef.current = false;
      });
  }, [clear, run]);

  const submitRef = React.useRef(submit);
  submitRef.current = submit;

  // Key interception: capture phase on document, before Lexical/React handlers.
  React.useEffect(() => {
    const onKeyDown = (event) => {
      const current = draftRef.current;
      if (typeof current !== 'string' || !/^\s*!/.test(current)) return;
      if (event.isComposing === true || event.keyCode === 229) return;
      const active = document.activeElement;
      if (active === null || typeof active.closest !== 'function' || active.closest('[data-composer-input]') === null) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        clear();
        return;
      }
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      submitRef.current(current.replace(/^\s*!/, ''));
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [clear]);

  // Composer-card bash-mode marker.
  React.useEffect(() => {
    const card = document.querySelector('[data-composer-card]');
    if (card === null) return undefined;
    if (bashMode) card.setAttribute('data-inline-bash', 'on');
    else card.removeAttribute('data-inline-bash');
    return () => card.removeAttribute('data-inline-bash');
  }, [bashMode]);

  // Mount marker for diagnostics/tests plus stylesheet lifetime safety.
  React.useEffect(() => {
    ensureCss();
    document.body.setAttribute('data-inline-bash-plugin', 'ready');
    return () => document.body.removeAttribute('data-inline-bash-plugin');
  }, []);

  if (!bashMode && result === null) return null;

  return h('div', { className: 'ibx-root', 'data-inline-bash-dock': 'true' },
    bashMode
      ? h('div', { className: 'ibx-mode', 'data-inline-bash-mode': 'on' },
        h('span', { className: 'ibx-badge' }, 'BASH'),
        h('span', {}, 'Enter runs locally \u2014 no model turn'),
        h('span', { className: 'ibx-hint' }, 'Shift+Enter newline \u00b7 Esc cancels'),
      )
      : null,
    result !== null
      ? h(ResultCard, { result, onClose: () => setResult(null), onSend: send })
      : null,
  );
}

/** Required client services: the slot registry and the Session-addressed command Remote. */
const inject = ['slots', 'remote', 'remote.commands', 'sessions', 'conversation'];

/**
 * Client plugin body.
 * @param {object} ctx - client root context.
 */
function apply(ctx) {
  ensureCss();
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'inline-bash',
    order: 15,
    inject: (sessionId) => ({
      sessionId,
      run: async (command) => {
        const result = await ctx.remote.commands.execute(sessionId, '/bash ' + command, []);
        if (result === undefined || result === null || result.ok !== true) {
          const error = result === undefined || result === null ? undefined : result.error;
          const detail = error === undefined ? 'command.execute failed' : error.code + ': ' + error.message;
          throw new Error(detail);
        }
        if (result.value === undefined) throw new Error('unknown host command: /bash');
        return result.value.result;
      },
      send: async (text) => {
        const binding = ctx.sessions.binding(sessionId);
        if (binding === undefined) throw new Error('inline-bash: session is not materialized');
        await ctx.conversation.sendSession(binding.session, text, [], 'queue');
      },
    }),
  }, InlineBashDock));
}

exports.apply = apply;
exports.inject = inject;
exports.InlineBashDock = InlineBashDock;
