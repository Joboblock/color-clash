import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const distDir = resolve(projectRoot, 'dist');

const copyPairs = [
  ['src/index.html', 'dist/index.html'],
  ['src/styles.css', 'dist/styles.css'],
  ['assets', 'dist/assets'],
  ['fonts', 'dist/fonts'],
  ['favicon.ico', 'dist/favicon.ico']
];

mkdirSync(distDir, { recursive: true });

for (const [from, to] of copyPairs) {
  const srcPath = resolve(projectRoot, from);
  const destPath = resolve(projectRoot, to);
  if (!existsSync(srcPath)) continue;
  cpSync(srcPath, destPath, { recursive: true });
}

console.log('[build] static files copied to dist');
