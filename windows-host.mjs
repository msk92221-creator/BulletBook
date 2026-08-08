import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_ID = "2c714971-eb05-4abb-8a15-d08319774c6c";
const AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE =
  "openid profile offline_access https://graph.microsoft.com/Files.ReadWrite.AppFolder";
const CLOUD_FILE_PATH = "/me/drive/special/approot:/BulletBook_sync.buj:/content";
// Windows용 업데이트는 GitHub Releases에서 받는다(예: BulletBook_windows_v0.38.0.zip).
// 공개 저장소라 익명으로 최신 릴리스를 조회할 수 있어 별도 토큰이 필요 없다.
const GITHUB_API_ROOT = "https://api.github.com";
const GITHUB_REPO = "msk92221-creator/BulletBook";
const GITHUB_RELEASES_LATEST = `/repos/${GITHUB_REPO}/releases/latest`;
const TRUSTED_RELEASE_PATH = `/${GITHUB_REPO}/releases/download/`;
const root = fileURLToPath(new URL(".", import.meta.url));
const localDataRoot =
  process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
const settingsDirectory = join(localDataRoot, "BulletBook");
const tokenFile = join(settingsDirectory, "onedrive-account.json");
const maxBookBytes = 24 * 1024 * 1024;
const requestedPort = Number.parseInt(process.env.BULLETBOOK_PORT || "43117", 10);
const appPort = Number.isFinite(requestedPort) && requestedPort > 0
  ? requestedPort
  : 43117;
const expectedHost = `127.0.0.1:${appPort}`;
const expectedOrigin = `http://${expectedHost}`;
const sessionCookieName = "BulletBookSession";
const apiSessionToken = randomBytes(32).toString("hex");

if (typeof fetch !== "function") {
  console.error("[ERROR] BulletBook 자동 동기화에는 Node.js 18 이상이 필요합니다.");
  process.exit(1);
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};
const publicFiles = new Set([
  "index.html",
  "app.js",
  "cloud-sync.js",
  "styles.css",
  "favicon.svg",
]);

class AppError extends Error {
  constructor(message, code = "SYNC_ERROR", status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let tokenCache;
let pendingLogin = null;
// 0이면 아직 클라이언트 heartbeat를 한 번도 받지 않은 상태이며, 이때는
// 서버가 켜지자마자 닫히는 일이 없도록 watchdog가 종료하지 않는다.
let lastHeartbeatAt = 0;

async function loadToken() {
  if (tokenCache !== undefined) return tokenCache;
  try {
    tokenCache = JSON.parse(await readFile(tokenFile, "utf8"));
  } catch {
    tokenCache = null;
  }
  return tokenCache;
}

async function saveToken(nextToken) {
  tokenCache = nextToken;
  await mkdir(settingsDirectory, { recursive: true });
  await writeFile(tokenFile, JSON.stringify(nextToken), { encoding: "utf8", mode: 0o600 });
}

async function clearToken() {
  tokenCache = null;
  await rm(tokenFile, { force: true });
}

function decodeAccountLabel(idToken) {
  if (!idToken) return "";
  try {
    const payload = idToken.split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return decoded.preferred_username || decoded.email || decoded.name || "";
  } catch {
    return "";
  }
}

async function postForm(url, values) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(
      "Microsoft 로그인 서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.",
      "NETWORK_ERROR",
      503
    );
  }
  let payload = {};
  try { payload = await response.json(); } catch { /* ignore */ }
  return { ok: response.ok, status: response.status, payload };
}

async function storeTokenResponse(payload, existing = null) {
  const accountLabel =
    decodeAccountLabel(payload.id_token) || existing?.accountLabel || "";
  const nextToken = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || existing?.refreshToken || "",
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
    accountLabel,
  };
  if (!nextToken.refreshToken) {
    throw new AppError(
      "자동 동기화용 로그인 권한을 받지 못했습니다. 다시 로그인해 주세요.",
      "AUTH_REQUIRED",
      401
    );
  }
  await saveToken(nextToken);
  return nextToken;
}

async function startDeviceLogin() {
  const result = await postForm(`${AUTHORITY}/devicecode`, {
    client_id: CLIENT_ID,
    scope: GRAPH_SCOPE,
  });
  if (!result.ok || !result.payload.device_code) {
    throw new AppError(
      result.payload.error_description ||
        "Microsoft 로그인을 시작하지 못했습니다. Entra의 공용 클라이언트 설정을 확인해 주세요.",
      result.payload.error || "LOGIN_START_FAILED",
      400
    );
  }
  pendingLogin = {
    deviceCode: result.payload.device_code,
    expiresAt: Date.now() + Number(result.payload.expires_in || 900) * 1000,
    interval: Math.max(2, Number(result.payload.interval || 5)),
    nextPollAt: 0,
  };
  return {
    userCode: result.payload.user_code,
    verificationUri:
      result.payload.verification_uri || result.payload.verification_url,
    message: result.payload.message || "",
    expiresIn: Number(result.payload.expires_in || 900),
    interval: pendingLogin.interval,
  };
}

async function pollDeviceLogin() {
  if (!pendingLogin) {
    throw new AppError("진행 중인 로그인이 없습니다.", "LOGIN_NOT_STARTED", 400);
  }
  if (Date.now() >= pendingLogin.expiresAt) {
    pendingLogin = null;
    return {
      status: "failed",
      code: "LOGIN_EXPIRED",
      message: "로그인 시간이 만료되었습니다. 다시 시도해 주세요.",
    };
  }
  if (Date.now() < pendingLogin.nextPollAt) return { status: "pending" };
  pendingLogin.nextPollAt = Date.now() + pendingLogin.interval * 1000;

  const result = await postForm(`${AUTHORITY}/token`, {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: CLIENT_ID,
    device_code: pendingLogin.deviceCode,
  });
  if (result.ok && result.payload.access_token) {
    const token = await storeTokenResponse(result.payload);
    pendingLogin = null;
    return { status: "authorized", accountLabel: token.accountLabel };
  }

  const errorCode = result.payload.error || "LOGIN_FAILED";
  if (errorCode === "authorization_pending") return { status: "pending" };
  if (errorCode === "slow_down") {
    pendingLogin.interval += 5;
    return { status: "slow_down" };
  }
  pendingLogin = null;
  return {
    status: "failed",
    code: errorCode,
    message:
      result.payload.error_description ||
      (errorCode === "authorization_declined"
        ? "Microsoft 로그인이 취소되었습니다."
        : "Microsoft 로그인에 실패했습니다."),
  };
}

async function getAccessToken(forceRefresh = false) {
  const token = await loadToken();
  if (!token?.refreshToken) {
    throw new AppError("Microsoft 계정 로그인이 필요합니다.", "AUTH_REQUIRED", 401);
  }
  if (!forceRefresh && token.accessToken && token.expiresAt > Date.now() + 60000) {
    return token.accessToken;
  }

  const result = await postForm(`${AUTHORITY}/token`, {
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
    scope: GRAPH_SCOPE,
  });
  if (!result.ok || !result.payload.access_token) {
    if (result.payload.error === "invalid_grant") await clearToken();
    throw new AppError(
      result.payload.error_description ||
        "Microsoft 로그인 기간이 만료되었습니다. 다시 로그인해 주세요.",
      "AUTH_REQUIRED",
      401
    );
  }
  return (await storeTokenResponse(result.payload, token)).accessToken;
}

async function graphFetch(path, options = {}, retry = true) {
  const accessToken = await getAccessToken(false);
  let response;
  try {
    response = await fetch(`${GRAPH_ROOT}${path}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new AppError(
      "OneDrive에 연결할 수 없습니다. 네트워크에서 Microsoft Graph가 허용되는지 확인해 주세요.",
      "NETWORK_ERROR",
      503
    );
  }
  if (response.status === 401 && retry) {
    await getAccessToken(true);
    return graphFetch(path, options, false);
  }
  if (response.status === 401) {
    await clearToken();
    throw new AppError(
      "Microsoft 로그인 기간이 만료되었습니다. 다시 로그인해 주세요.",
      "AUTH_REQUIRED",
      401
    );
  }
  return response;
}

async function graphError(response, fallback) {
  let message = fallback;
  let code = "GRAPH_ERROR";
  try {
    const payload = await response.json();
    message = payload?.error?.message || message;
    code = payload?.error?.code || code;
  } catch { /* ignore */ }
  return new AppError(message, code, response.status || 500);
}

async function ensureAppFolder() {
  const response = await graphFetch("/me/drive/special/approot");
  if (!response.ok) {
    throw await graphError(
      response,
      "OneDrive 앱 폴더에 접근하지 못했습니다. Files.ReadWrite.AppFolder 권한을 확인해 주세요."
    );
  }
}

async function readCloudBook() {
  await ensureAppFolder();
  const response = await graphFetch(CLOUD_FILE_PATH, { redirect: "manual" });
  if (response.status === 404) return null;
  if (response.status >= 300 && response.status < 400) {
    const downloadUrl = response.headers.get("location");
    if (!downloadUrl) {
      throw new AppError(
        "OneDrive 다운로드 주소를 받지 못했습니다.",
        "GRAPH_ERROR",
        502
      );
    }
    const download = await fetch(downloadUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    if (!download.ok) {
      throw new AppError(
        "OneDrive의 불렛북을 내려받지 못했습니다.",
        "GRAPH_ERROR",
        download.status
      );
    }
    return download.text();
  }
  if (!response.ok) {
    throw await graphError(response, "OneDrive의 불렛북을 읽지 못했습니다.");
  }
  return response.text();
}

async function writeCloudBook(content) {
  await ensureAppFolder();
  const response = await graphFetch(CLOUD_FILE_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: content,
  });
  if (!response.ok) {
    throw await graphError(response, "OneDrive에 불렛북을 저장하지 못했습니다.");
  }
}

function assertLocalHost(request) {
  if (String(request.headers.host || "").toLowerCase() !== expectedHost) {
    throw new AppError("허용되지 않은 요청 주소입니다.", "FORBIDDEN", 403);
  }
}

function requestHasSessionCookie(request) {
  const header = String(request.headers.cookie || "");
  return header.split(";").some(part => {
    const [name, ...rest] = part.trim().split("=");
    return name === sessionCookieName && rest.join("=") === apiSessionToken;
  });
}

function authorizeApiRequest(request, pathname) {
  if (pathname === "/api/health") return;
  const origin = String(request.headers.origin || "");
  if (origin && origin !== expectedOrigin) {
    throw new AppError("다른 화면에서 보낸 요청은 허용되지 않습니다.", "FORBIDDEN", 403);
  }
  if (!requestHasSessionCookie(request)) {
    throw new AppError("앱 세션을 확인할 수 없습니다.", "FORBIDDEN", 403);
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method || "")) {
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      throw new AppError("JSON 요청만 허용됩니다.", "UNSUPPORTED_MEDIA_TYPE", 415);
    }
  }
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendText(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBookBytes) {
      throw new AppError("불렛북 파일이 너무 큽니다.", "BOOK_TOO_LARGE", 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function versionScore(value) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(value || ""));
  if (!match) return -1;
  return Number(match[1]) * 1e6 + Number(match[2]) * 1e3 + Number(match[3]);
}

async function currentWindowsVersion() {
  try {
    const text = await readFile(join(root, "VERSION.txt"), "utf8");
    const match = /Version\s+([0-9.]+)/i.exec(text);
    return match ? match[1] : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function findWindowsUpdate() {
  const current = await currentWindowsVersion();
  let release;
  try {
    const response = await fetch(`${GITHUB_API_ROOT}${GITHUB_RELEASES_LATEST}`, {
      headers: { "Accept": "application/vnd.github+json", "User-Agent": "BulletBook-Updater" },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) {
      return { available: false, reason: "NO_RELEASE", currentVersion: current };
    }
    if (!response.ok) {
      throw new AppError(
        "GitHub에서 업데이트를 확인하지 못했습니다.",
        "GITHUB_ERROR",
        502
      );
    }
    release = await response.json();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "GitHub에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.",
      "NETWORK_ERROR",
      503
    );
  }

  // 릴리스에 올린 파일 중 이름에 windows가 들어간 zip을 고른다.
  const assets = Array.isArray(release.assets) ? release.assets : [];
  let best = null;
  for (const asset of assets) {
    const name = String(asset.name || "");
    const lower = name.toLowerCase();
    if (!lower.endsWith(".zip") || !lower.includes("windows")) continue;
    if (!best || versionScore(name) > versionScore(best.name)) best = asset;
  }
  if (!best) {
    return { available: false, reason: "NO_ZIP", currentVersion: current };
  }
  // 릴리스의 태그(예: v0.38.0)에서 버전을 읽고, 없으면 파일명에서 본다.
  const latestVersion =
    (/(\d+\.\d+\.\d+)/.exec(release.tag_name || "") || [])[1] ||
    (/(\d+\.\d+\.\d+)/.exec(best.name) || [])[1] || "";
  return {
    available: versionScore(latestVersion) > versionScore(current),
    currentVersion: current,
    name: best.name,
    itemId: best.browser_download_url,
    digest: String(best.digest || ""),
    size: Number(best.size) || 0,
    latestVersion,
  };
}

function runPowerShell(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", ...args], {
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", rejectPromise);
    child.on("close", code => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(stderr.trim() || `PowerShell 종료 코드 ${code}`));
    });
  });
}

function isTrustedReleaseAsset(address) {
  try {
    const url = new URL(String(address || ""));
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith(TRUSTED_RELEASE_PATH);
  } catch {
    return false;
  }
}

function verifyReleaseDigest(bytes, expectedDigest) {
  const expected = String(expectedDigest || "").trim().toLowerCase();
  if (!expected.startsWith("sha256:")) {
    throw new AppError("업데이트 검증값이 없습니다.", "UPDATE_INTEGRITY", 502);
  }
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== expected) {
    throw new AppError("업데이트 파일 검증에 실패했습니다.", "UPDATE_INTEGRITY", 502);
  }
}

// 최신 GitHub 릴리스를 서버에서 다시 확인한 뒤 검증된 ZIP만 새 폴더에 푼다.
async function applyWindowsUpdate() {
  const update = await findWindowsUpdate();
  if (!update.available || !update.itemId) {
    throw new AppError("설치할 새 업데이트가 없습니다.", "NO_UPDATE", 409);
  }
  const itemId = String(update.itemId);
  if (!isTrustedReleaseAsset(itemId)) {
    throw new AppError("허용되지 않은 업데이트 주소입니다.", "UNTRUSTED_UPDATE", 403);
  }
  const response = await fetch(itemId, {
    redirect: "follow",
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) {
    throw new AppError("업데이트 파일을 내려받지 못했습니다.", "GITHUB_ERROR", 502);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyReleaseDigest(bytes, update.digest);

  const parent = dirname(root.replace(/[\\/]$/, ""));
  const staging = join(parent, ".bulletbook-update-tmp");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const zipPath = join(staging, "update.zip");
    await writeFile(zipPath, bytes);
    const extracted = join(staging, "extracted");
    await runPowerShell([
      "-Command",
      `Expand-Archive -LiteralPath ${quotePowerShellLiteral(zipPath)} ` +
        `-DestinationPath ${quotePowerShellLiteral(extracted)} -Force`,
    ]);

    let source = extracted;
    const entries = await readdir(extracted, { withFileTypes: true });
    const directories = entries.filter(entry => entry.isDirectory());
    if (entries.length === 1 && directories.length === 1) {
      source = join(extracted, directories[0].name);
    }

    const requiredFiles = ["Start_BulletBook.bat", "windows-host.mjs", "VERSION.txt"];
    for (const requiredFile of requiredFiles) {
      if (!existsSync(join(source, requiredFile))) {
        throw new AppError(
          `업데이트 묶음에 ${requiredFile} 파일이 없습니다.`,
          "INVALID_PACKAGE",
          502
        );
      }
    }

    const versionLabel =
      (/^(\d+\.\d+\.\d+)$/.exec(String(update.latestVersion || "")) || [])[1] || "new";
    const baseDestination = join(parent, `BulletBook_Windows_Android_v${versionLabel}`);
    const destination = existsSync(baseDestination)
      ? `${baseDestination}-update-${Date.now()}`
      : baseDestination;
    if (resolve(destination) === resolve(root.replace(/[\\/]$/, ""))) {
      throw new AppError(
        "지금 실행 중인 폴더와 같은 이름이라 덮어쓸 수 없습니다.",
        "SAME_FOLDER",
        409
      );
    }
    await rename(source, destination);
    return { installedTo: destination, version: versionLabel };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true, clientId: CLIENT_ID });
    return;
  }
  if (pathname === "/api/heartbeat" && request.method === "GET") {
    lastHeartbeatAt = Date.now();
    sendJson(response, 200, { ok: true });
    return;
  }
  if (pathname === "/api/update/check" && request.method === "GET") {
    sendJson(response, 200, await findWindowsUpdate());
    return;
  }
  if (pathname === "/api/update/apply" && request.method === "POST") {
    await readRequestBody(request);
    sendJson(response, 200, await applyWindowsUpdate());
    return;
  }
  if (pathname === "/api/cloud/status" && request.method === "GET") {
    const token = await loadToken();
    sendJson(response, 200, {
      connected: Boolean(token?.refreshToken),
      accountLabel: token?.accountLabel || "",
    });
    return;
  }
  if (pathname === "/api/cloud/login/start" && request.method === "POST") {
    sendJson(response, 200, await startDeviceLogin());
    return;
  }
  if (pathname === "/api/cloud/login/poll" && request.method === "POST") {
    sendJson(response, 200, await pollDeviceLogin());
    return;
  }
  if (pathname === "/api/cloud/login/cancel" && request.method === "POST") {
    pendingLogin = null;
    sendJson(response, 200, { cancelled: true });
    return;
  }
  if (pathname === "/api/cloud/logout" && request.method === "POST") {
    pendingLogin = null;
    await clearToken();
    sendJson(response, 200, { disconnected: true });
    return;
  }
  if (pathname === "/api/cloud/book" && request.method === "GET") {
    const content = await readCloudBook();
    if (content === null) {
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
    } else {
      sendText(response, 200, content, "application/json; charset=utf-8");
    }
    return;
  }
  if (pathname === "/api/cloud/book" && request.method === "PUT") {
    const content = await readRequestBody(request);
    await writeCloudBook(content);
    sendJson(response, 200, { saved: true });
    return;
  }
  throw new AppError("지원하지 않는 요청입니다.", "NOT_FOUND", 404);
}

async function handleStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const safeName = normalize(requested).replaceAll("\\", "/");
  if (!publicFiles.has(safeName)) {
    throw new AppError("파일을 찾을 수 없습니다.", "NOT_FOUND", 404);
  }
  const body = await readFile(join(root, safeName));
  const headers = {
    "Content-Type": contentTypes[extname(safeName)] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (safeName === "index.html") {
    headers["Set-Cookie"] =
      `${sessionCookieName}=${apiSessionToken}; HttpOnly; SameSite=Strict; Path=/`;
  }
  response.writeHead(200, headers);
  response.end(body);
}

const server = createServer(async (request, response) => {
  // 브라우저가 요청 도중 닫히거나 절전 상태로 들어가도 응답 스트림의
  // error 이벤트가 도우미 프로세스 전체를 종료시키지 않게 한다.
  response.on("error", error => {
    console.error(`[WARN] 응답 연결 종료: ${error.message}`);
  });
  try {
    assertLocalHost(request);
    const url = new URL(request.url || "/", expectedOrigin);
    if (url.pathname.startsWith("/api/")) {
      authorizeApiRequest(request, url.pathname);
      await handleApi(request, response, url.pathname);
    } else {
      await handleStatic(response, url.pathname);
    }
  } catch (error) {
    if (response.headersSent || response.writableEnded || response.destroyed) {
      response.destroy();
      return;
    }
    const status = Number(error?.status) || 500;
    sendJson(response, status, {
      code: error?.code || "INTERNAL_ERROR",
      message: error?.message || "동기화 도우미 오류가 발생했습니다.",
    });
  }
});

function launchWindowsApp(url) {
  if (process.env.BULLETBOOK_NO_LAUNCH === "1") return;
  const edgeCandidates = [
    join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  const edge = edgeCandidates.find(candidate => existsSync(candidate));
  if (edge) {
    spawn(edge, [`--app=${url}`], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("cmd", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

server.on("error", async error => {
  if (error?.code === "EADDRINUSE") {
    const existingUrl = `http://127.0.0.1:${appPort}/`;
    try {
      const response = await fetch(`${existingUrl}api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      const status = await response.json();
      if (response.ok && status?.clientId === CLIENT_ID) {
        launchWindowsApp(existingUrl);
        process.exit(0);
      }
    } catch { /* 다른 프로그램이 포트를 사용 중이다. */ }
    console.error(
      `[ERROR] 포트 ${appPort}을 다른 프로그램이 사용 중입니다. 해당 프로그램을 닫고 다시 실행해 주세요.`
    );
  } else {
    console.error(`[ERROR] BulletBook Windows 실행 실패: ${error.message}`);
  }
  process.exitCode = 1;
});

server.listen(appPort, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${appPort}/`;
  console.log(`BulletBook 자동 동기화 도우미 실행 중: ${url}`);
  launchWindowsApp(url);
});

// Edge 앱 창이 닫히면 클라이언트의 heartbeat가 멈추고, 5분 뒤 도우미가
// 자동 종료된다. 5분으로 넉넉히 잡은 이유는 Edge가 백그라운드로 가거나 절전
// 상태에 들어가면 타이머가 제한될 수 있어, 짧으면 정상 사용 중에도 서버가
// 꺼질 수 있기 때문이다. Start_BulletBook.bat를 다시 실행하면 기존 인스턴스를
// 재사용하고, 로그아웃·재부팅 시에는 운영체제가 정리한다.
const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;
setInterval(() => {
  if (lastHeartbeatAt > 0 && Date.now() - lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
    server.close(() => process.exit(0));
  }
}, 60 * 1000).unref();
