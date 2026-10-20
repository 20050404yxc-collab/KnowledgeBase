import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from '@swc/core';
import { build } from 'vite';
import { defineConfig } from 'electron-vite';
import electron from 'electron';

const require = createRequire(import.meta.url);
assert.equal(renderToStaticMarkup(React.createElement('p', null, '环境就绪')), '<p>环境就绪</p>');
const transformed = transformSync('const view = <div>ready</div>', {
  jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
});
assert.ok(transformed.code.includes('react/jsx-runtime'));
assert.ok(defineConfig({ main: {}, preload: {}, renderer: {} }));
const cacheRoot = 'D:/dev-tools/cache/knowledgebase-check';
await mkdir(cacheRoot, { recursive: true });
const scratch = await mkdtemp(path.join(cacheRoot, 'vite-'));
const entry = path.join(scratch, 'entry.js');
try {
  await writeFile(entry, 'export const environmentReady = true;');
  const bundled = await build({
    configFile: false,
    logLevel: 'error',
    build: { write: false, lib: { entry, formats: ['es'] } },
  });
  const bundles = Array.isArray(bundled) ? bundled : [bundled];
  assert.ok(bundles.flatMap((result) => result.output).some((item) => item.type === 'chunk' && item.code.includes('environmentReady')));
} finally {
  await unlink(entry);
  await rmdir(scratch);
}
const runtime = JSON.parse(execFileSync(electron, ['-e', 'console.log(JSON.stringify(process.versions))'], {
  encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
}));
assert.equal(runtime.electron, require('electron/package.json').version);
const report = JSON.stringify({
  status: 'passed', node: process.version, electron: runtime.electron, chromium: runtime.chrome,
  react: React.version, typescript: require('typescript/package.json').version,
  checks: ['React rendering', 'SWC TSX/native binary', 'Vite in-memory bundle', 'electron-vite config import', 'Electron runtime'],
}, null, 2) + '\n';
await writeFile(new URL('../task-specs/20261020-01-personal-knowledge-agent/environment-check-node.json', import.meta.url), report);
console.log(report);
