#!/usr/bin/env node
/**
 * Build both halves of dsh-inline-bash.
 *
 *  - src/index.js  -> lib/index.js   (plain Cordis ES module, copied verbatim)
 *  - src/client.js -> lib/client.js  (the factory body wrapped in the DSH
 *    `window.__ModuleLoader__.load({ id, factory })` CJS bundle form that the
 *    browser module system materializes)
 *
 * Run: node scripts/build.mjs
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'lib'), { recursive: true });

// Host half: a plain ESM module the Loader imports directly.
copyFileSync(join(root, 'src/index.js'), join(root, 'lib/index.js'));

// Browser half: wrap the factory body in the ModuleLoader registration.
const body = readFileSync(join(root, 'src/client.js'), 'utf8');
const client = `window.__ModuleLoader__.load({
\tid: "dsh-inline-bash",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body
  .split('\n')
  .map((line) => (line.length > 0 ? '\t\t' + line : line))
  .join('\n')}
\t\treturn module.exports;
\t}
});
//# sourceMappingURL=client.js.map
`;
writeFileSync(join(root, 'lib/client.js'), client);
console.log(
  `lib/index.js written (${Buffer.byteLength(readFileSync(join(root, 'lib/index.js')))} bytes)\n` +
  `lib/client.js written (${Buffer.byteLength(client)} bytes)`,
);
