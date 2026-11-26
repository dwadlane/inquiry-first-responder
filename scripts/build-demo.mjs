import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist/demo', { recursive: true, force: true });
mkdirSync('dist/demo', { recursive: true });
await build({
  entryPoints: ['demo/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/demo/main.js'
});
cpSync('demo/index.html', 'dist/demo/index.html');
cpSync('demo/styles.css', 'dist/demo/styles.css');
console.log('Demo built in dist/demo (static files, open index.html or run npm run demo)');
