import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export const REPOSITORY = 'msk92221-creator/BulletBook';
export const APP_ID = 'kr.co.bulletbook.next';
// Public certificate fingerprint of the installed 0.43.x app, not a private key.
export const SIGNER_SHA256 = 'c4098a5ddd9a7cec1291f251696ea1eadd6336fe98e6c0999588cd28d95bc47d';

export function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Use a numeric major.minor.patch release version.');
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid version number.');
  return parts;
}

export function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

export function androidMetadata(gradle) {
  const version = gradle.match(/\bversionName\s+"([^"]+)"/)?.[1];
  versionParts(version);
  const versionCode = Number(gradle.match(/\bversionCode\s+(\d+)/)?.[1]);
  const appId = gradle.match(/\bapplicationId\s+"([^"]+)"/)?.[1];
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('Invalid Android versionCode.');
  if (appId !== APP_ID) throw new Error('App ID changed; refuse to create a separate app.');
  return {version, versionCode, appId};
}

export function readMetadata(root = process.cwd()) {
  const read = file => readFileSync(join(root, file), 'utf8');
  const metadata = androidMetadata(read('android/app/build.gradle'));
  const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json'));
  if ([pkg.version, lock.version, lock.packages[''].version].some(value => value !== metadata.version)
      || !read('VERSION.txt').split(/\r?\n/).includes(`Version ${metadata.version}`)) {
    throw new Error('Release versions disagree. Use npm run release:bump -- patch.');
  }
  const config = JSON.parse(read('capacitor.config.json'));
  if (config.appId !== APP_ID || config.appName !== 'BulletBook') throw new Error('Unexpected Capacitor app identity.');
  return metadata;
}

export function assertUpgrade(current, previous) {
  if (compareVersions(current.version, previous.version) <= 0) throw new Error('Release version must increase.');
  if (current.versionCode <= previous.versionCode) throw new Error('Android versionCode must increase for an in-place update.');
}

export function assertApkIdentity(badging, certificates, metadata) {
  const found = badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
  if (!found || found[1] !== APP_ID || Number(found[2]) !== metadata.versionCode || found[3] !== metadata.version) throw new Error('Built APK identity/version mismatch.');
  if (!badging.split(/\r?\n/).includes("application-label:'BulletBook'")) throw new Error('Built APK app name mismatch.');
  const signers = [...certificates.matchAll(/certificate SHA-256 digest:\s*([a-fA-F0-9]+)/g)].map(match => match[1].toLowerCase());
  if (signers.length !== 1 || signers[0] !== SIGNER_SHA256) throw new Error('APK signing certificate differs from the installed app.');
}
