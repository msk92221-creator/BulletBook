import {readFileSync, writeFileSync} from 'node:fs';
import {readMetadata, versionParts, compareVersions} from './release-lib.mjs';

const current = readMetadata();
const requested = process.argv[2] || 'patch';
let version = requested;
if (['major', 'minor', 'patch'].includes(requested)) {
  const parts = versionParts(current.version), index = ['major', 'minor', 'patch'].indexOf(requested);
  parts[index]++;
  for (let i = index + 1; i < 3; i++) parts[i] = 0;
  version = parts.join('.');
}
if (compareVersions(version, current.version) <= 0) throw new Error('The new version must be higher.');
if (current.versionCode >= 2100000000) throw new Error('Android versionCode limit reached.');
const edit = (file, transform) => {
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, transform(original));
};
for (const file of ['package.json', 'package-lock.json']) edit(file, text => {
  const value = JSON.parse(text); value.version = version;
  if (value.packages) value.packages[''].version = version;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return (JSON.stringify(value, null, 2) + '\n').replaceAll('\n', eol);
});
edit('android/app/build.gradle', text => text.replace(/\bversionCode\s+\d+/, `versionCode ${current.versionCode + 1}`).replace(/\bversionName\s+"[^"]+"/, `versionName "${version}"`));
edit('VERSION.txt', text => text.replace(/^Version [^\r\n]+/m, `Version ${version}`));
edit('README.md', text => text.replace(/^# BulletBook [\d.]+/, `# BulletBook ${version}`));
readMetadata();
console.log(`Version ${version}, Android code ${current.versionCode + 1}. Add a README section headed "## ${version} ...", then commit and push to master. GitHub will build, sign and release it.`);
