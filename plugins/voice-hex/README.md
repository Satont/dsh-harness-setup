# dsh-voice-hex

DSH speech-to-text providers backed by the local [Hex](https://github.com/anomalyco/hex)
dictation app. One provider is registered for every model Hex reports, so the existing
microphone button in the composer gets a provider picker:

- Hex · Whisper large-v3-turbo (multilingual, Russian; the recommended default)
- Hex · Parakeet v3 / unified English
- Hex · Qwen3-ASR 0.6B
- Hex · SenseVoice Small
- Hex · GigaAM v3 (Russian)
- …plus the rest of the Hex model list

Audio never leaves the machine: the browser records a WAV, DSH's speech service passes it
to this host plugin, and the plugin runs:

```bash
hex transcribe --json --model <hex-model-id> --language <lang> <recording.wav>
```

The transcript is inserted into the composer draft, exactly like the built-in local
SenseVoice provider.

## Requirements

- Hex 3.4+ installed and running (or at least its models installed)
- Hex Labs › **Transcribe files** enabled once:

```bash
hex labs on transcribe-files
```

- The selected model must be installed in Hex. Models that are not installed appear in
  the DSH provider list with a **Download and prepare** action; that action runs
  `hex model install <id>` and restores Hex's previously selected model afterwards.

## Install into a DSH profile

```bash
pnpm add file:plugins/voice-hex
```

The package's `cordis.patch.yml` inserts the `voice-hex` row. Then select a provider in
DSH **Plugins → Voice Input → Speech recognition** (or keep the profile default
`hex-whisper-large-v3-turbo` and language `ru`).

The profile override used by this setup:

```yaml
- id: speech-to-text
  config:
    defaultProvider: hex-whisper-large-v3-turbo
    language: ru
```

## Config

| Field | Default | Meaning |
|---|---|---|
| `command` | `hex` | Hex CLI binary or absolute path |
| `timeoutMs` | `180000` | Per-transcription timeout |

No API key is used. Hex's own service authentication stays inside Hex; this plugin only
uses the local CLI.

## Verification

```bash
hex model list --json            # find whisper_large_v3_turbo
hex labs on transcribe-files
hex transcribe --json --model whisper_large_v3_turbo --language ru /tmp/test.wav
```

Then click the microphone in DSH, say something, and press Stop. The transcript should
appear in the draft; no session message is sent until you press Send.
