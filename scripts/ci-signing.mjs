import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {resolve, join, sep} from 'node:path';

if (!process.env.RUNNER_TEMP || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Signing setup runs only in GitHub Actions.');
const temp = resolve(process.env.RUNNER_TEMP), directory = join(temp, 'bulletbook-signing');
if (!directory.startsWith(temp + sep)) throw new Error('Unsafe signing directory.');
if (process.argv[2] === 'cleanup') {
  rmSync(directory, {recursive:true, force:true});
} else {
  const key = process.env.ANDROID_KEYSTORE_BASE64, properties = process.env.ANDROID_KEYSTORE_PROPERTIES_BASE64;
  if (!key || !properties) throw new Error('Android signing secrets are missing. Release is blocked.');
  const decoded = Buffer.from(properties, 'base64');
  // Mask decoded properties as well as the base64 secret before any build runs.
  for (const line of decoded.toString('utf8').split(/\r?\n/)) {
    const value = line.match(/^[^#!][^=:]*[=:]\s*(.+)$/)?.[1];
    if (value) console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
  }
  mkdirSync(directory, {recursive:true, mode:0o700});
  writeFileSync(join(directory, 'bulletbook-release.jks'), Buffer.from(key, 'base64'), {mode:0o600});
  writeFileSync(join(directory, 'keystore.properties'), decoded, {mode:0o600});
}
