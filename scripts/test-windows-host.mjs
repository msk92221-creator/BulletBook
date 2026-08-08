import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const port = 44000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
let stderr = "";
const child = spawn(process.execPath, ["windows-host.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    BULLETBOOK_PORT: String(port),
    BULLETBOOK_NO_LAUNCH: "1",
  },
  stdio: ["ignore", "ignore", "pipe"],
  windowsHide: true,
});
child.stderr.on("data", chunk => { stderr += chunk.toString(); });

async function expectStatus(path, expected, options = {}) {
  const response = await fetch(`${origin}${path}`, options);
  if (response.status !== expected) {
    throw new Error(`${path}: expected ${expected}, received ${response.status}`);
  }
  return response;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await expectStatus("/api/health", 200);
      ready = true;
      break;
    } catch {
      await delay(100);
    }
  }
  if (!ready) throw new Error(`Windows host did not start: ${stderr.trim()}`);

  await expectStatus("/api/cloud/status", 403);
  const index = await expectStatus("/", 200);
  const cookie = String(index.headers.get("set-cookie") || "").split(";", 1)[0];
  if (!cookie.startsWith("BulletBookSession=")) {
    throw new Error("Session cookie was not issued");
  }
  const sessionHeaders = { Cookie: cookie };
  await expectStatus("/api/cloud/status", 200, { headers: sessionHeaders });
  await expectStatus("/api/cloud/login/cancel", 415, {
    method: "POST",
    headers: { ...sessionHeaders, "Content-Type": "text/plain" },
    body: "{}",
  });
  await expectStatus("/api/cloud/login/cancel", 403, {
    method: "POST",
    headers: {
      ...sessionHeaders,
      "Content-Type": "application/json",
      Origin: "https://example.invalid",
    },
    body: "{}",
  });
  await expectStatus("/api/cloud/login/cancel", 200, {
    method: "POST",
    headers: { ...sessionHeaders, "Content-Type": "application/json" },
    body: "{}",
  });
  console.log("windows host session security: ok");
} finally {
  child.kill();
  await Promise.race([
    new Promise(resolveClose => child.once("close", resolveClose)),
    delay(3000),
  ]);
}