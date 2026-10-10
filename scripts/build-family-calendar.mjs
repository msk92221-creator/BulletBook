import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('family-room', { recursive: true });
await build({ entryPoints: ['family-calendar/main.tsx'], bundle: true, minify: true,
  outfile: 'family-room/family.js', target: ['chrome100'], format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.json': 'json' } });
await copyFile('family-calendar/index.html', 'family-room/index.html');
console.log('FamilyTeamRoom calendar bundle ready.');
