import {readFileSync, writeFileSync, appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {REPOSITORY, readMetadata, androidMetadata, compareVersions, assertUpgrade, assertApkIdentity} from './release-lib.mjs';

const metadata = readMetadata(), tag = `v${metadata.version}`;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
const files = [`BulletBook_v${metadata.version}.apk`, `BulletBook_windows_v${metadata.version}.zip`];
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const readRelease = name => readFileSync(join('release', name));
const api = async (path, {method = 'GET', body, allow404 = false} = {}) => {
  if (!process.env.GH_TOKEN) throw new Error('GitHub token is required.');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
    method, headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'Content-Type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status}).`);
  return response.status === 204 ? null : response.json();
};
const latest = () => api('/releases/latest', {allow404:true});
function notes() {
  const readme = readFileSync('README.md', 'utf8');
  const section = readme.split(/^## /m).find(part => part.startsWith(`${metadata.version} `));
  if (!section) throw new Error(`Add release notes under "## ${metadata.version} ..." in README.md.`);
  return `${section.trim()}\n\n기존 BulletBook과 동일한 앱 ID·서명을 검증한 GitHub 자동 배포입니다. 기존 앱에서 업데이트하세요.\n\nSource: ${commit}\n`;
}

switch (process.argv[2]) {
  case 'prepare': {
    if (process.env.GITHUB_REPOSITORY !== REPOSITORY || process.env.GITHUB_REF !== 'refs/heads/master') throw new Error('Releases run only from the original master branch.');
    const previous = await latest();
    let build = true;
    if (previous) {
      const previousVersion = previous.tag_name.replace(/^v/, '');
      const order = compareVersions(metadata.version, previousVersion);
      if (order < 0) throw new Error('Source version is older than the latest release.');
      build = order > 0;
      if (build) {
        const oldGradle = execFileSync('git', ['show', `${previous.tag_name}:android/app/build.gradle`], {encoding:'utf8'});
        assertUpgrade(metadata, androidMetadata(oldGradle));
      }
    }
    if (build) notes();
    appendFileSync(process.env.GITHUB_OUTPUT, `build=${build}\nversion=${metadata.version}\n`);
    console.log(build ? `Ready to build ${tag}.` : `${tag} already exists; no duplicate release.`);
    break;
  }
  case 'verify': {
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!sdk) throw new Error('Android SDK is required.');
    const tools = join(sdk, 'build-tools', '36.0.0');
    const apk = join('release', files[0]);
    const cert = execFileSync(join(tools, 'apksigner'), ['verify', '--print-certs', apk], {encoding:'utf8'});
    const badging = execFileSync(join(tools, 'aapt'), ['dump', 'badging', apk], {encoding:'utf8'});
    assertApkIdentity(badging, cert, metadata);
    const assets = files.map(name => ({name, sha256:hash(readRelease(name))}));
    writeFileSync('release/SHA256SUMS', assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(''));
    writeFileSync('release/release-manifest.json', JSON.stringify({commit, ...metadata, assets}, null, 2));
    writeFileSync('release/release-notes.txt', notes());
    console.log(`${tag}: APK name, package, version and installed-app signing certificate verified.`);
    break;
  }
  case 'publish': {
    const manifest = JSON.parse(readRelease('release-manifest.json'));
    if (manifest.commit !== commit || manifest.version !== metadata.version || manifest.versionCode !== metadata.versionCode) throw new Error('Build artifacts do not belong to this source commit.');
    if (JSON.stringify(manifest.assets.map(asset => asset.name)) !== JSON.stringify(files)) throw new Error('Unexpected release files.');
    for (const asset of manifest.assets) if (hash(readRelease(asset.name)) !== asset.sha256) throw new Error('Artifact digest mismatch.');
    const expectedSums = manifest.assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join('');
    if (readRelease('SHA256SUMS').toString() !== expectedSums || readRelease('release-notes.txt').toString() !== notes()) throw new Error('Release metadata changed in transit.');
    const previous = await latest();
    if (previous && compareVersions(metadata.version, previous.tag_name.replace(/^v/, '')) <= 0) {
      if (previous.tag_name === tag && previous.target_commitish === commit) { console.log('This exact release was already published.'); break; }
      throw new Error('A same or newer version was published; do not overwrite it.');
    }
    const releases = await api('/releases?per_page=100');
    let release = releases.find(value => value.tag_name === tag);
    if (release && (!release.draft || release.target_commitish !== commit)) throw new Error('Existing release belongs to another source or is already public.');
    if (!release) release = await api('/releases', {method:'POST', body:{tag_name:tag, target_commitish:commit, name:`BulletBook ${metadata.version}`, body:notes(), draft:true, prerelease:false}});
    // A draft can be resumed after a partial upload. Public releases are immutable here.
    const expectedNames = [...files, 'SHA256SUMS'];
    if (release.assets.some(asset => !expectedNames.includes(asset.name))) throw new Error('Unexpected file in release draft.');
    for (const name of expectedNames) {
      const buffer = readRelease(name), digest = `sha256:${hash(buffer)}`;
      const existing = release.assets.find(asset => asset.name === name);
      if (existing?.digest === digest && existing.state === 'uploaded') continue;
      if (existing) await api(`/releases/assets/${existing.id}`, {method:'DELETE'});
      const upload = new URL(release.upload_url.split('{')[0]);
      if (upload.origin !== 'https://uploads.github.com') throw new Error('Unexpected GitHub upload destination.');
      upload.searchParams.set('name', name);
      const response = await fetch(upload, {method:'POST', headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`, 'Content-Type':'application/octet-stream'}, body:buffer});
      if (!response.ok) throw new Error(`Artifact upload failed (${response.status}). Draft remains unpublished.`);
      const uploaded = await response.json();
      if (uploaded.digest !== digest || uploaded.state !== 'uploaded') throw new Error('Uploaded artifact digest mismatch.');
    }
    const uploaded = await api(`/releases/${release.id}`);
    if (uploaded.assets.length !== expectedNames.length) throw new Error('Release is incomplete.');
    for (const name of expectedNames) {
      if (uploaded.assets.find(asset => asset.name === name)?.digest !== `sha256:${hash(readRelease(name))}`) throw new Error('Final upload verification failed.');
    }
    await api(`/releases/${release.id}`, {method:'PATCH', body:{draft:false, make_latest:'true'}});
    console.log(`Published https://github.com/${REPOSITORY}/releases/tag/${tag}`);
    break;
  }
  default: throw new Error('Use prepare, verify or publish.');
}
