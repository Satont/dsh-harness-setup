// dsh-voice-hex — DSH speech-to-text providers backed by the local Hex app.
//
// Hex (github.com/anomalyco/hex) keeps speech models on this machine and exposes
// `hex transcribe --model <id> --language <lang> --json <wav>`. We register one
// DSH recognizer per Hex model, so the existing microphone button and its
// provider picker can use Whisper large-v3-turbo (Russian, many languages) and
// the rest of the installed model set without sending audio to a cloud.
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import z from '@deepseek-ai/schemastery'

const exec = promisify(execFile)
const name = 'dsh-voice-hex'
const inject = ['speechToText']

const COMMON = [
  'auto', 'ru', 'en', 'uk', 'be', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'cs', 'sk',
  'sl', 'hr', 'ro', 'hu', 'el', 'bg', 'sr', 'nl', 'sv', 'da', 'fi', 'no', 'tr',
  'zh', 'ja', 'ko', 'ar', 'he', 'hi', 'fa', 'ur', 'th', 'vi', 'id', 'ms',
]

function slug(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function languagesFor(model) {
  const declared = Array.isArray(model.languages) ? model.languages : []
  if (declared.includes('*')) return COMMON
  const out = [...declared]
  if (out.length > 1 && !out.includes('auto')) out.unshift('auto')
  return out
}

function wavSeconds(bytes) {
  try {
    const buf = Buffer.from(bytes)
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return 0
    let offset = 12
    let byteRate = 0
    let dataSize = 0
    while (offset + 8 <= buf.length) {
      const id = buf.toString('ascii', offset, offset + 4)
      const size = buf.readUInt32LE(offset + 4)
      if (id === 'fmt ' && offset + 16 <= buf.length) byteRate = buf.readUInt32LE(offset + 16)
      if (id === 'data') { dataSize = Math.min(size, buf.length - offset - 8); break }
      offset += 8 + size + (size % 2)
    }
    return byteRate > 0 ? dataSize / byteRate : 0
  } catch { return 0 }
}

async function discoverModels(command) {
  try {
    const { stdout } = await exec(command, ['model', 'list', '--json'], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 })
    const parsed = JSON.parse(stdout)
    const models = Array.isArray(parsed?.models) ? parsed.models : []
    if (models.length) return models
  } catch { /* fall back below */ }
  return [
    { id: 'whisper_large_v3_turbo', name: 'Whisper large-v3-turbo', languages: ['*'], installed: true },
    { id: 'parakeet_unified_en', name: 'Parakeet Unified English', languages: ['en'], installed: true },
    { id: 'parakeet_v3', name: 'Parakeet v3', languages: ['en', 'ru'], installed: false },
  ]
}


function createPreparation(model, options, onReady) {
  let phase = model.installed ? 'ready' : 'unprepared'
  let child = null
  const listeners = new Set()
  const notify = () => { for (const listener of listeners) { try { listener() } catch {} } }
  const set = (next) => { phase = next; notify() }
  return {
    snapshot() {
      return phase === 'ready' ? { phase: 'ready' }
        : phase === 'downloading' ? { phase: 'downloading', resource: model.name || model.id, completedBytes: 0 }
        : phase === 'failed' ? { phase: 'failed', message: 'Hex model install failed; open Hex → Models to install it.' }
        : phase === 'cancelled' ? { phase: 'cancelled' }
        : { phase: 'unprepared' }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    prepare() {
      if (phase === 'ready' || phase === 'downloading') return
      phase = 'downloading'; notify()
      const selected = options.selectedModel
      child = spawn(options.command, ['model', 'install', model.id], { env: { ...process.env, NO_COLOR: '1' } })
      child.on('error', () => { child = null; set('failed') })
      child.on('close', (code) => {
        child = null
        if (code === 0) {
          model.installed = true
          onReady?.()
          if (selected && selected !== model.id) {
            exec(options.command, ['model', 'use', selected], { timeout: 30_000 }).catch(() => {})
          }
          set('ready')
        } else {
          set('failed')
        }
      })
    },
    async cancel() {
      if (child) { child.kill('SIGTERM'); child = null }
      if (phase === 'downloading') set('cancelled')
    },
  }
}

function makeProvider(model, options) {
  const id = `hex-${slug(model.id)}`
  const languages = languagesFor(model)
  const provider = {
    info: {
      id,
      name: `Hex · ${model.name || model.id}`,
      location: 'host-local',
      languages,
    },
    async transcribe(input, signal) {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted')
      const language = String(input.language || 'auto')
      const wav = Buffer.from(input.audio)
      const file = path.join(tmpdir(), `dsh-hex-${randomUUID()}.wav`)
      await writeFile(file, wav, { mode: 0o600 })
      const started = performance.now()
      try {
        const { stdout } = await exec(
          options.command,
          ['transcribe', '--json', '--model', model.id, '--language', language, file],
          {
            timeout: options.timeoutMs,
            maxBuffer: 4 * 1024 * 1024,
            signal,
            env: { ...process.env, NO_COLOR: '1' },
          },
        )
        const parsed = JSON.parse(stdout)
        if (parsed?.status !== 'transcript' || typeof parsed.text !== 'string') {
          const message = parsed?.message || parsed?.error || `Hex returned ${parsed?.status || 'an unknown status'}`
          throw new Error(message)
        }
        return {
          text: parsed.text.trim(),
          audioSeconds: wavSeconds(wav),
          inferenceSeconds: Math.max(0, (performance.now() - started) / 1000),
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error
        throw new Error(`Hex (${model.name || model.id}) failed: ${error?.message || error}`)
      } finally {
        await unlink(file).catch(() => {})
      }
    },
  }
  if (!model.installed) provider.preparation = createPreparation(model, options, options.onReady)
  return provider
}

export const Config = z.object({
  command: z.string().default('hex').description('Hex CLI binary or absolute path.'),
  timeoutMs: z.number().default(180_000).description('Per-transcription timeout in milliseconds.'),
})

export async function apply(ctx, config = {}) {
  const command = typeof config.command === 'string' && config.command.trim() ? config.command.trim() : 'hex'
  const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 180_000
  const models = await discoverModels(command)
  const selected = models.find((model) => model.selected)?.id
  const disposers = []
  for (const model of models) {
    const provider = makeProvider(model, { command, timeoutMs, selectedModel: selected })
    try {
      disposers.push(ctx.speechToText.register(provider))
    } catch (error) {
      console.warn(`voice-hex: cannot register ${provider.info.id}: ${error?.message ?? error}`)
    }
  }
  ctx.effect(() => async () => {
    await Promise.allSettled(disposers.map((dispose) => dispose()))
  })
  console.log(`voice-hex: ${models.length} Hex model(s) registered`)
}

export default { name, inject, Config, apply }
