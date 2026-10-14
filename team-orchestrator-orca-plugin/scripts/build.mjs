import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['src/panel.mjs'], bundle: true, write: false, format: 'iife', target: 'es2022' });
const css = await readFile('src/panel.css', 'utf8');
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
await writeFile('panel.html', `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Team Orchestrator</title><style>${css}</style></head><body><div id="app" aria-busy="true"><p>Loading Team Orchestrator…</p></div><script>${script}</script></body></html>\n`);
console.log('Built self-contained panel.html');
