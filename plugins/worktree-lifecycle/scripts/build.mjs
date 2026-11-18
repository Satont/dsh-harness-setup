// Copy the plain-ESM sources into lib/ unchanged. There is no bundler and no
// transpile step: `dsh` loads lib/index.js, Node loads lib/engine.js beside it.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const src = path.join(root, 'src')
const lib = path.join(root, 'lib')

fs.rmSync(lib, { recursive: true, force: true })
fs.mkdirSync(lib, { recursive: true })
for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue
  fs.copyFileSync(path.join(src, entry.name), path.join(lib, entry.name))
}
console.log(`built lib/ from src/ (${fs.readdirSync(lib).join(', ')})`)
