#!/usr/bin/env node
/**
 * Build the browser half of dsh-claude-ui.
 *
 *  - reads src/theme.css (the source of truth for the theme),
 *  - embeds the woff2 font subsets in src/fonts/ as @font-face data URLs,
 *  - emits lib/client.js as a DSH ModuleLoader CJS module that injects a
 *    <style data-plugin-css="dsh-claude-ui/theme.css"> tag.
 *
 * Run:  node scripts/build.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p));

const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, " +
  "U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, " +
  "U+2212, U+2215, U+FEFF, U+FFFD";
const CYRILLIC = "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116";

function fontFace(file, family, weight, unicodeRange) {
  const base64 = read(file).toString("base64");
  return (
    `@font-face{font-family:"${family}";font-style:normal;` +
    `font-weight:${weight};font-display:swap;` +
    `src:url(data:font/woff2;base64,${base64}) format("woff2");` +
    `unicode-range:${unicodeRange}}`
  );
}

const fontCss = [
  fontFace("src/fonts/inter-latin.woff2", "Inter", "400 700", LATIN),
  fontFace("src/fonts/inter-cyrillic.woff2", "Inter", "400 700", CYRILLIC),
  fontFace(
    "src/fonts/source-serif-latin.woff2",
    "Source Serif 4",
    "400 700",
    LATIN,
  ),
  fontFace(
    "src/fonts/source-serif-cyrillic.woff2",
    "Source Serif 4",
    "400 700",
    CYRILLIC,
  ),
].join("\n");

const themeCss = read("src/theme.css").toString();
const css = `${fontCss}\n${themeCss}`;

// Inline the stylesheet inside a JS template literal: escape only what the
// template literal needs (backslash, backtick, ${).
const escaped = css
  .replace(/\\/g, "\\\\")
  .replace(/`/g, "\\`")
  .replace(/\$\{/g, "\\${");

const client = `window.__ModuleLoader__.load({
\tid: "dsh-claude-ui",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\tconst css = \`${escaped}\`;
\t\tif (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="dsh-claude-ui/theme.css"]') === null) {
\t\t\tconst tag = document.createElement("style");
\t\t\ttag.dataset.pluginCss = "dsh-claude-ui/theme.css";
\t\t\ttag.textContent = css;
\t\t\tdocument.head.appendChild(tag);
\t\t}
\t\texports.inject = [];
\t\texports.apply = function () {};
\t\treturn module.exports;
\t}
});
`;

writeFileSync(join(root, "lib/client.js"), client);
console.log(
  `lib/client.js written (${Buffer.byteLength(client)} bytes, css ${Buffer.byteLength(css)} bytes)`,
);
