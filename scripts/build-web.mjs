import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import './build-family-calendar.mjs';

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const files = [
  "index.html",
  "app.js",
  "cloud-sync.js",
  "family-bridge.js",
  "family-room",
  "styles.css",
  "favicon.svg",
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of files) {
  await cp(resolve(root, file), resolve(dist, file), {recursive:true});
}
console.log(`웹 앱 ${files.length}개 파일을 dist에 준비했습니다.`);
