(() => {
  "use strict";

  const LOGIN_POLL_FALLBACK_SECONDS = 5;
  const CLOUD_REFRESH_MS = 15000;
  // 편집을 멈추고 이만큼 지나야 OneDrive에 올린다. 짧으면 타이핑 사이 쉬는
  // 순간마다 문서 전체가 새 버전으로 쌓여 OneDrive 버전 기록이 순식간에
  // 수백 개로 불어난다. 계속 편집 중이면 타이머가 매번 새로 밀리므로
  // "쉬지 않고 쓰는 동안은 올라가지 않다가, 멈추면 한 번에 반영"된다.
  // 동기화 버튼(syncNow)과 앱 종료·백그라운드 전환(flushPendingUpload)은
  // 이 대기를 건너뛰고 즉시 반영한다.
  const CLOUD_UPLOAD_IDLE_MS = 25000;
  // Windows 도우미에게 앱 창이 살아 있음을 알리는 간격. Edge 창이 닫히면
  // heartbeat가 멈추고 도우미는 HEARTBEAT_TIMEOUT_MS 뒤 스스로 종료된다.
  const HEARTBEAT_MS = 20000;
  const pendingNativeCalls = new Map();
  let nativeSequence = 0;

  function makeError(message, code = "") {
    const error = new Error(message || "OneDrive 작업에 실패했습니다.");
    if (code) error.code = code;
    return error;
  }

  window.__bulletBookNativeResult = (requestId, ok, payload) => {
    const pending = pendingNativeCalls.get(requestId);
    if (!pending) return;
    pendingNativeCalls.delete(requestId);
    if (ok) {
      pending.resolve(payload ?? "");
      return;
    }
    try {
      const parsed = JSON.parse(payload || "{}");
      pending.reject(makeError(parsed.message, parsed.code));
    } catch {
      pending.reject(makeError(payload || "Android OneDrive 작업에 실패했습니다."));
    }
  };

  function nativeCall(method, payload) {
    return new Promise((resolve, reject) => {
      const requestId = `cloud-${Date.now()}-${++nativeSequence}`;
      pendingNativeCalls.set(requestId, { resolve, reject });
      try {
        if (payload === undefined) window.BulletBookNative[method](requestId);
        else window.BulletBookNative[method](requestId, payload);
      } catch (error) {
        pendingNativeCalls.delete(requestId);
        reject(error);
      }
    });
  }

  function parseJson(text, fallbackMessage) {
    try {
      return JSON.parse(text || "{}");
    } catch {
      throw makeError(fallbackMessage);
    }
  }

  function createNativeAdapter() {
    return {
      kind: "android",
      async restore() {
        const result = parseJson(
          await nativeCall("cloudAuthStatus"),
          "Android 로그인 상태를 확인하지 못했습니다."
        );
        return result.connected === true;
      },
      async startLogin() {
        return parseJson(
          await nativeCall("startCloudLogin"),
          "Microsoft 로그인 정보를 받지 못했습니다."
        );
      },
      async pollLogin() {
        return parseJson(
          await nativeCall("pollCloudLogin"),
          "Microsoft 로그인 상태를 확인하지 못했습니다."
        );
      },
      async cancelLogin() {
        await nativeCall("cancelCloudLogin");
      },
      async read() {
        return nativeCall("readCloudBook");
      },
      async write(text) {
        await nativeCall("writeCloudBook", text);
      },
      async disconnect() {
        await nativeCall("disconnectCloudAccount");
      },
    };
  }

  async function windowsRequest(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        cache: "no-store",
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": options.contentType || "application/json; charset=utf-8" } : {}),
          ...(options.headers || {}),
        },
      });
    } catch {
      throw makeError(
        "Windows 자동 동기화 도우미에 연결할 수 없습니다. Start_BulletBook.bat로 실행해 주세요.",
        "HOST_UNAVAILABLE"
      );
    }
    if (!response.ok) {
      let detail = {};
      try { detail = await response.json(); } catch { /* ignore */ }
      throw makeError(detail.message || `OneDrive 요청 실패 (${response.status})`, detail.code);
    }
    return response;
  }

  function createWindowsAdapter() {
    return {
      kind: "windows",
      async restore() {
        const response = await windowsRequest("/api/cloud/status");
        return (await response.json()).connected === true;
      },
      async startLogin() {
        const response = await windowsRequest("/api/cloud/login/start", {
          method: "POST",
          body: "{}",
        });
        return response.json();
      },
      async pollLogin() {
        const response = await windowsRequest("/api/cloud/login/poll", {
          method: "POST",
          body: "{}",
        });
        return response.json();
      },
      async cancelLogin() {
        await windowsRequest("/api/cloud/login/cancel", {
          method: "POST",
          body: "{}",
        });
      },
      async read() {
        const response = await windowsRequest("/api/cloud/book");
        if (response.status === 204) return "";
        return response.text();
      },
      async write(text) {
        await windowsRequest("/api/cloud/book", {
          method: "PUT",
          body: text,
          contentType: "application/json; charset=utf-8",
        });
      },
      async disconnect() {
        await windowsRequest("/api/cloud/logout", {
          method: "POST",
          body: "{}",
        });
      },
    };
  }

  function createUnavailableAdapter() {
    const unavailable = () => {
      throw makeError(
        "계정 자동 동기화는 Start_BulletBook.bat로 실행해야 합니다.",
        "HOST_UNAVAILABLE"
      );
    };
    return {
      kind: "unsupported",
      async restore() { return false; },
      startLogin: unavailable,
      pollLogin: unavailable,
      cancelLogin: async () => {},
      read: unavailable,
      write: unavailable,
      disconnect: async () => {},
    };
  }

  const MISSING = Symbol("missing");
  const clone = value => value === MISSING
    ? MISSING
    : JSON.parse(JSON.stringify(value));
  const updatedTime = value => Date.parse(value?.updatedAt || "") || 0;

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }

  const stableStringify = value => JSON.stringify(stableValue(value));
  const sameValue = (left, right) => {
    if (left === MISSING || right === MISSING) return left === right;
    return stableStringify(left) === stableStringify(right);
  };

  function bookContentSignature(value) {
    const comparable = clone(value);
    if (!comparable || comparable === MISSING) return "";
    delete comparable.updatedAt;
    delete comparable.syncPristine;
    return stableStringify(comparable);
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  const slot = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)
    ? value[key]
    : MISSING;

  function resolveSlot(baseValue, localValue, remoteValue, preferRemote) {
    if (sameValue(localValue, remoteValue)) {
      return { value: clone(localValue), conflict: false };
    }
    if (baseValue !== MISSING) {
      if (sameValue(localValue, baseValue)) {
        return { value: clone(remoteValue), conflict: false };
      }
      if (sameValue(remoteValue, baseValue)) {
        return { value: clone(localValue), conflict: false };
      }
    }
    // 한쪽은 삭제하고 다른 쪽은 수정한 경우 삭제보다 기록 보존을 우선한다.
    if (localValue === MISSING || remoteValue === MISSING) {
      return {
        value: clone(localValue === MISSING ? remoteValue : localValue),
        conflict: true,
      };
    }
    return {
      value: clone(preferRemote ? remoteValue : localValue),
      conflict: true,
    };
  }

  function mergeRecord(baseValue, localValue, remoteValue, preferRemote, skipKeys = new Set()) {
    const base = baseValue && typeof baseValue === "object" ? baseValue : {};
    const local = localValue && typeof localValue === "object" ? localValue : {};
    const remote = remoteValue && typeof remoteValue === "object" ? remoteValue : {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    const value = {};
    let conflict = false;
    [...keys].sort().forEach(key => {
      if (skipKeys.has(key)) return;
      const resolved = resolveSlot(slot(base, key), slot(local, key), slot(remote, key), preferRemote);
      conflict ||= resolved.conflict;
      if (resolved.value !== MISSING) value[key] = resolved.value;
    });
    return { value, conflict };
  }

  function entityKey(value, index) {
    if (value?.id) return String(value.id);
    return `legacy-${shortHash(stableStringify(value))}-${index}`;
  }

  function indexedEntities(values) {
    const map = new Map();
    (Array.isArray(values) ? values : []).forEach((value, index) => {
      map.set(entityKey(value, index), value);
    });
    return map;
  }

  function entityOrder(primary, secondary, base) {
    const order = [];
    const seen = new Set();
    [primary, secondary, base].forEach(values => {
      (Array.isArray(values) ? values : []).forEach((value, index) => {
        const id = entityKey(value, index);
        if (seen.has(id)) return;
        seen.add(id);
        order.push(id);
      });
    });
    return order;
  }

  function mergeEntity(baseValue, localValue, remoteValue, preferRemote, mergeConcurrent) {
    if (localValue !== MISSING && remoteValue !== MISSING) {
      if (sameValue(localValue, remoteValue)) {
        return { value: clone(localValue), conflict: false };
      }
      if (baseValue !== MISSING) {
        if (sameValue(localValue, baseValue)) {
          return { value: clone(remoteValue), conflict: false };
        }
        if (sameValue(remoteValue, baseValue)) {
          return { value: clone(localValue), conflict: false };
        }
      }
      return mergeConcurrent(
        baseValue === MISSING ? null : baseValue,
        localValue,
        remoteValue,
        preferRemote
      );
    }
    if (localValue === MISSING && remoteValue === MISSING) {
      return { value: MISSING, conflict: false };
    }
    const existing = localValue === MISSING ? remoteValue : localValue;
    if (baseValue === MISSING) return { value: clone(existing), conflict: false };
    if (sameValue(existing, baseValue)) {
      // 다른 쪽에서만 삭제했고 남아 있는 쪽은 바뀌지 않았다면 삭제를 반영한다.
      return { value: MISSING, conflict: false };
    }
    // 삭제와 수정이 동시에 일어났다면 수정된 기록을 살린다.
    return { value: clone(existing), conflict: true };
  }

  function mergeEntityList(baseValues, localValues, remoteValues, preferRemote, mergeConcurrent) {
    const base = indexedEntities(baseValues);
    const local = indexedEntities(localValues);
    const remote = indexedEntities(remoteValues);
    const primary = preferRemote ? remoteValues : localValues;
    const secondary = preferRemote ? localValues : remoteValues;
    const items = [];
    let conflict = false;
    entityOrder(primary, secondary, baseValues).forEach(id => {
      const merged = mergeEntity(
        base.has(id) ? base.get(id) : MISSING,
        local.has(id) ? local.get(id) : MISSING,
        remote.has(id) ? remote.get(id) : MISSING,
        preferRemote,
        mergeConcurrent
      );
      conflict ||= merged.conflict;
      if (merged.value !== MISSING) items.push(merged.value);
    });
    return { items, conflict };
  }

  function mergeElements(base, local, remote, preferRemote) {
    return mergeEntityList(base, local, remote, preferRemote,
      (baseElement, localElement, remoteElement) => {
        const merged = mergeRecord(baseElement, localElement, remoteElement, preferRemote);
        return { value: merged.value, conflict: merged.conflict };
      });
  }

  function mergePage(basePage, localPage, remotePage, preferRemote) {
    const metadata = mergeRecord(
      basePage,
      localPage,
      remotePage,
      preferRemote,
      new Set(["elements", "templateText"])
    );
    const templateText = mergeRecord(
      basePage?.templateText,
      localPage?.templateText,
      remotePage?.templateText,
      preferRemote
    );
    const elements = mergeElements(
      basePage?.elements,
      localPage?.elements,
      remotePage?.elements,
      preferRemote
    );
    metadata.value.templateText = templateText.value;
    metadata.value.elements = elements.items;
    return {
      value: metadata.value,
      conflict: metadata.conflict || templateText.conflict || elements.conflict,
    };
  }

  function mergeGroup(baseGroup, localGroup, remoteGroup, preferRemote) {
    const merged = mergeRecord(baseGroup, localGroup, remoteGroup, preferRemote);
    return { value: merged.value, conflict: merged.conflict };
  }

  function mergeGoalEntity(baseEntity, localEntity, remoteEntity, preferRemote) {
    const merged = mergeRecord(baseEntity, localEntity, remoteEntity, preferRemote);
    return { value: merged.value, conflict: merged.conflict };
  }

  function mergeGoalSystem(baseSystem, localSystem, remoteSystem, preferRemote) {
    const metadata = mergeRecord(
      baseSystem,
      localSystem,
      remoteSystem,
      preferRemote,
      new Set(["areas", "goals", "missions"])
    );
    const areas = mergeEntityList(
      baseSystem?.areas,
      localSystem?.areas,
      remoteSystem?.areas,
      preferRemote,
      mergeGoalEntity
    );
    const goals = mergeEntityList(
      baseSystem?.goals,
      localSystem?.goals,
      remoteSystem?.goals,
      preferRemote,
      mergeGoalEntity
    );
    const missions = mergeEntityList(
      baseSystem?.missions,
      localSystem?.missions,
      remoteSystem?.missions,
      preferRemote,
      mergeGoalEntity
    );
    const value = metadata.value;
    value.version = Math.max(1, Number(value.version) || 1);
    value.areas = areas.items;
    value.goals = goals.items;
    value.missions = missions.items;
    return {
      value,
      conflict: metadata.conflict || areas.conflict || goals.conflict || missions.conflict,
    };
  }

  function mergeBooks(baseBook, localBook, remoteBook) {
    const preferRemote = updatedTime(remoteBook) > updatedTime(localBook);
    const metadata = mergeRecord(
      baseBook,
      localBook,
      remoteBook,
      preferRemote,
      new Set(["pages", "groups", "calendarEvents", "goalSystem", "updatedAt", "syncPristine"])
    );
    const groups = mergeEntityList(
      baseBook?.groups,
      localBook?.groups,
      remoteBook?.groups,
      preferRemote,
      mergeGroup
    );
    const pages = mergeEntityList(
      baseBook?.pages,
      localBook?.pages,
      remoteBook?.pages,
      preferRemote,
      mergePage
    );
    const calendarEvents = mergeEntityList(
      baseBook?.calendarEvents,
      localBook?.calendarEvents,
      remoteBook?.calendarEvents,
      preferRemote,
      mergeGroup
    );
    const goalSystem = mergeGoalSystem(
      baseBook?.goalSystem,
      localBook?.goalSystem,
      remoteBook?.goalSystem,
      preferRemote
    );
    const value = metadata.value;
    value.groups = groups.items;
    value.pages = pages.items;
    value.calendarEvents = calendarEvents.items;
    value.goalSystem = goalSystem.value;
    value.updatedAt = new Date().toISOString();
    value.syncPristine = false;
    return {
      book: value,
      hadConflict: metadata.conflict || groups.conflict || pages.conflict ||
        calendarEvents.conflict || goalSystem.conflict,
    };
  }

  function create(options) {
    const isWindowsHost =
      location.protocol === "http:" &&
      (location.hostname === "127.0.0.1" || location.hostname === "localhost");
    const adapter = window.BulletBookNative
      ? createNativeAdapter()
      : isWindowsHost
        ? createWindowsAdapter()
        : createUnavailableAdapter();

    let connected = false;
    let uploadTimer = null;
    let refreshTimer = null;
    let heartbeatTimer = null;
    let running = Promise.resolve();
    let loginGeneration = 0;
    let loginPending = false;
    let loginPollWake = null;
    let lastErrorMessage = "";
    let lastErrorAt = 0;

    const setState = (state, detail = "") => options.onState?.(state, detail);
    const notify = message => options.notify?.(message);
    const isValidBook = value => options.isValidBook
      ? options.isValidBook(value) === true
      : value && value.format === "bulletbook" && Array.isArray(value.pages) && value.pages.length > 0;
    const serialize = value => JSON.stringify(value, null, 2);

    function wakeLoginPoll() {
      loginPollWake?.();
    }

    function waitForLoginPoll(milliseconds) {
      return new Promise(resolve => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (loginPollWake === finish) loginPollWake = null;
          resolve();
        };
        const timer = setTimeout(finish, milliseconds);
        loginPollWake = finish;
      });
    }

    function startRefreshTimer() {
      clearInterval(refreshTimer);
      refreshTimer = setInterval(() => {
        if (connected && document.visibilityState === "visible") {
          queue(() => runSync(false));
        }
      }, CLOUD_REFRESH_MS);
    }

    // Windows 도우미에게 앱 창이 열려 있음을 주기적으로 알린다. 창이 닫히면
    // heartbeat가 멈추고, 도우미는 HEARTBEAT_TIMEOUT_MS 뒤 스스로 종료된다.
    // Android는 자체 서버가 없으므로 Windows에서만 보낸다.
    function startHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (adapter.kind === "windows" && navigator.onLine) {
          fetch("/api/heartbeat", { cache: "no-store" }).catch(() => {});
        }
      }, HEARTBEAT_MS);
    }

    async function loadSyncBase() {
      if (!options.getSyncBase) return null;
      const value = await options.getSyncBase();
      return isValidBook(value) ? value : null;
    }

    async function storeSyncBase(value) {
      if (!options.setSyncBase) return;
      const stored = await options.setSyncBase(clone(value));
      if (stored === false) {
        throw makeError(
          "동기화 기준본을 기기에 저장하지 못했습니다. 저장 공간을 확인해 주세요.",
          "SYNC_BASE_SAVE_FAILED"
        );
      }
    }

    async function preserveBook(value, source, reason) {
      if (!options.saveRecoverySnapshot || !isValidBook(value)) return;
      const stored = await options.saveRecoverySnapshot(clone(value), { source, reason });
      if (stored === false) {
        throw makeError(
          "동기화 전 복구본을 저장하지 못해 작업을 중단했습니다. 저장 공간을 확인해 주세요.",
          "RECOVERY_SAVE_FAILED"
        );
      }
    }

    function localBookChangedSince(value) {
      const current = options.getBook?.() || value;
      return options.isLocalDirty?.() === true ||
        bookContentSignature(current) !== bookContentSignature(value);
    }

    async function applyRemoteBook(remoteBook, localBook) {
      await preserveBook(localBook, "device", "before-download");
      // 복구본을 쓰는 동안 사용자가 다시 편집했다면 원격 책으로 교체하지 않는다.
      // 해당 편집의 자동 저장이 끝난 뒤 다음 동기화에서 다시 병합한다.
      if (localBookChangedSince(localBook)) return "deferred";
      await options.applyBook(remoteBook);
      const applied = options.getBook?.() || remoteBook;
      await storeSyncBase(applied);
      return "downloaded";
    }

    async function uploadLocalBook(localBook, remoteBook) {
      if (remoteBook) await preserveBook(remoteBook, "cloud", "before-upload");
      if (localBookChangedSince(localBook)) return "deferred";
      await adapter.write(serialize(localBook));
      await storeSyncBase(localBook);
      return "uploaded";
    }

    async function mergeAndUpload(baseBook, localBook, remoteBook) {
      await preserveBook(localBook, "device", "before-merge");
      await preserveBook(remoteBook, "cloud", "before-merge");
      if (localBookChangedSince(localBook)) return "deferred";
      const merged = mergeBooks(baseBook, localBook, remoteBook);
      if (!isValidBook(merged.book)) {
        throw makeError(
          "양쪽 기록을 안전하게 합치지 못했습니다. 기존 기록은 복구본에 보존했습니다.",
          "MERGE_FAILED"
        );
      }
      // 앱 정규화와 기기 저장을 먼저 끝내야 네트워크 실패 시에도 합친 기록이 남는다.
      await options.applyBook(merged.book);
      const applied = options.getBook?.() || merged.book;
      await adapter.write(serialize(applied));
      await storeSyncBase(applied);
      return merged.hadConflict ? "merged-conflict" : "merged";
    }

    async function applyCloudText(remoteText, localBook) {
      if (!remoteText.trim()) {
        if (options.isLocalDirty?.()) await options.flushLocalChanges?.();
        const latestLocalBook = options.getBook?.() || localBook;
        await adapter.write(serialize(latestLocalBook));
        await storeSyncBase(latestLocalBook);
        return "uploaded";
      }

      let remoteBook;
      try {
        remoteBook = JSON.parse(remoteText);
      } catch {
        throw makeError("OneDrive의 불렛북 데이터가 손상되었습니다.");
      }
      if (!isValidBook(remoteBook)) {
        throw makeError("OneDrive의 데이터가 올바른 불렛북 문서가 아닙니다.");
      }
      if (options.normalizeBook) {
        remoteBook = options.normalizeBook(remoteBook);
        if (!isValidBook(remoteBook)) {
          throw makeError("OneDrive 문서를 현재 버전으로 안전하게 변환하지 못했습니다.");
        }
      }

      // 원격 조회 중 편집된 내용은 먼저 기기에 확정한 뒤 같은 병합 절차로 처리한다.
      // 편집 중이라는 이유만으로 원격 책 전체를 덮어쓰지 않는다.
      if (options.isLocalDirty?.()) {
        await options.flushLocalChanges?.();
        localBook = options.getBook?.() || localBook;
      }

      if (bookContentSignature(localBook) === bookContentSignature(remoteBook)) {
        await storeSyncBase(updatedTime(remoteBook) > updatedTime(localBook) ? remoteBook : localBook);
        return "unchanged";
      }

      const localIsPristine = options.isPristineBook?.(localBook) === true;
      const remoteIsPristine = options.isPristineBook?.(remoteBook) === true;

      // 새 기기의 빈 책과 기존 기록이 만났을 때는 생성 시각과 관계없이 기록을 보존한다.
      if (localIsPristine && !remoteIsPristine) {
        return applyRemoteBook(remoteBook, localBook);
      }
      if (remoteIsPristine && !localIsPristine) {
        return uploadLocalBook(localBook, remoteBook);
      }

      const baseBook = await loadSyncBase();
      if (baseBook) {
        const baseSignature = bookContentSignature(baseBook);
        const localMatchesBase = bookContentSignature(localBook) === baseSignature;
        const remoteMatchesBase = bookContentSignature(remoteBook) === baseSignature;
        if (localMatchesBase && !remoteMatchesBase) {
          return applyRemoteBook(remoteBook, localBook);
        }
        if (remoteMatchesBase && !localMatchesBase) {
          return uploadLocalBook(localBook, remoteBook);
        }
      }

      // 기준본이 없거나 두 기기가 모두 바뀐 경우에는 어느 한쪽도 버리지 않는다.
      return mergeAndUpload(baseBook, localBook, remoteBook);
    }

    async function runSync(interactive = false) {
      if (!connected) return "disconnected";
      if (!navigator.onLine) {
        setState("offline", "오프라인 · 기기에 저장 중");
        return "offline";
      }
      setState("syncing", "OneDrive와 동기화 중…");
      const result = await applyCloudText(await adapter.read(), options.getBook());
      lastErrorMessage = "";
      lastErrorAt = 0;
      setState("synced", "Microsoft 계정 자동 동기화 켜짐");
      if (!interactive && result === "merged-conflict") {
        notify("동시에 수정된 기록을 합쳤습니다. 원본은 동기화 복구본에 보존했습니다.");
      }
      if (result === "deferred") {
        setState("ready", "편집 내용을 저장한 뒤 다시 동기화합니다");
      }
      if (interactive) {
        if (result === "uploaded") notify("현재 내용을 OneDrive에 반영했습니다.");
        else if (result === "downloaded") notify("OneDrive의 최신 내용을 불러왔습니다.");
        else if (result === "merged") notify("양쪽에서 추가한 기록을 안전하게 합쳤습니다.");
        else if (result === "merged-conflict") {
          notify("동시에 수정된 기록을 합쳤습니다. 원본은 동기화 복구본에 보존했습니다.");
        }
        else if (result === "deferred") notify("작성 중인 내용을 먼저 저장한 뒤 자동으로 다시 동기화합니다.");
        else if (result === "unchanged") notify("이미 최신 상태입니다.");
      }
      return result;
    }

    function queue(task) {
      running = running.then(task, task).catch(error => {
        console.error(error);
        if (error?.code === "AUTH_REQUIRED") {
          connected = false;
          clearInterval(refreshTimer);
          setState("disconnected", "Microsoft 계정 로그인이 필요합니다");
        } else {
          setState("error", error.message);
        }
        const now = Date.now();
        if (error.message !== lastErrorMessage || now - lastErrorAt > 60000) {
          notify(error.message);
          lastErrorMessage = error.message;
          lastErrorAt = now;
        }
        return "error";
      });
      return running;
    }

    async function waitForLogin(generation) {
      const challenge = await adapter.startLogin();
      if (generation !== loginGeneration) throw makeError("로그인을 취소했습니다.", "LOGIN_CANCELLED");
      loginPending = true;
      options.onAuthChallenge?.(challenge, adapter.kind);

      const expiresAt = Date.now() + Math.max(60, Number(challenge.expiresIn) || 900) * 1000;
      let intervalSeconds = Math.max(
        2,
        Number(challenge.interval) || LOGIN_POLL_FALLBACK_SECONDS
      );

      try {
        while (Date.now() < expiresAt) {
          await waitForLoginPoll(intervalSeconds * 1000);
          if (generation !== loginGeneration) {
            throw makeError("로그인을 취소했습니다.", "LOGIN_CANCELLED");
          }
          let result;
          try {
            result = await adapter.pollLogin();
          } catch (error) {
            if (error?.code === "LOGIN_NOT_STARTED") {
              const restored = await adapter.restore().catch(() => false);
              if (restored) return { status: "authorized" };
            }
            if (error?.code === "NETWORK_ERROR" || error?.code === "STATUS_ERROR") {
              // 외부 브라우저에서 돌아오는 순간의 일시적인 네트워크 오류는
              // 로그인 전체를 끝내지 않고 다음 확인에서 다시 시도한다.
              await waitForLoginPoll(1500);
              continue;
            }
            throw error;
          }
          if (result.status === "authorized") return result;
          if (result.status === "slow_down") {
            intervalSeconds += 5;
            continue;
          }
          if (result.status === "pending") continue;
          throw makeError(result.message || "Microsoft 로그인에 실패했습니다.", result.code);
        }
        throw makeError("로그인 시간이 만료되었습니다. 다시 시도해 주세요.", "LOGIN_EXPIRED");
      } finally {
        loginPending = false;
        wakeLoginPoll();
      }
    }

    // 앱이 로드되면 곧바로 heartbeat를 보낸다. 로그인 여부와 상관없이 Windows
    // 도구가 살아 있어야 앱 화면이 동작하므로, create() 시점에 한 번만 시작한다.
    startHeartbeat();

    return {
      async restore() {
        try {
          connected = await adapter.restore();
          if (!connected) {
            setState("disconnected", "Microsoft 계정 연결 안 됨");
            return false;
          }
          setState("ready", "OneDrive 자동 동기화 준비됨");
          await queue(() => runSync(false));
          if (connected) startRefreshTimer();
          return connected;
        } catch (error) {
          console.error(error);
          connected = false;
          setState("disconnected", "동기화 버튼을 눌러 Microsoft 계정 연결");
          return false;
        }
      },
      async connect() {
        const wasConnected = connected;
        const generation = ++loginGeneration;
        setState("connecting", "Microsoft 로그인 대기 중…");
        try {
          await waitForLogin(generation);
          if (generation !== loginGeneration) return false;
          connected = true;
          options.onAuthComplete?.();
          setState("ready", "OneDrive 자동 동기화 준비됨");
          await queue(() => runSync(true));
          startRefreshTimer();
          return true;
        } catch (error) {
          if (error?.code !== "LOGIN_CANCELLED" && !wasConnected) {
            const recovered = await adapter.restore().catch(() => false);
            if (recovered) {
              connected = true;
              options.onAuthComplete?.();
              setState("ready", "OneDrive 자동 동기화 준비됨");
              await queue(() => runSync(true));
              startRefreshTimer();
              return true;
            }
          }
          if (error?.code !== "LOGIN_CANCELLED") {
            console.error(error);
            notify(error.message || "Microsoft 계정을 연결하지 못했습니다.");
          }
          connected = wasConnected;
          setState(
            wasConnected ? "ready" : "disconnected",
            wasConnected ? "기존 Microsoft 계정 연결 유지" : "Microsoft 계정 연결 안 됨"
          );
          return false;
        }
      },
      async cancelConnect() {
        loginGeneration += 1;
        wakeLoginPoll();
        try { await adapter.cancelLogin(); } catch { /* ignore */ }
        setState(connected ? "ready" : "disconnected",
          connected ? "OneDrive 자동 동기화 준비됨" : "Microsoft 계정 연결 안 됨");
      },
      checkLoginNow() {
        wakeLoginPoll();
      },
      syncNow() {
        return queue(() => runSync(true));
      },
      refresh() {
        if (!connected) return Promise.resolve("disconnected");
        return queue(() => runSync(false));
      },
      scheduleUpload() {
        if (!connected) return;
        clearTimeout(uploadTimer);
        uploadTimer = setTimeout(() => {
          uploadTimer = null;
          queue(() => runSync(false));
        }, CLOUD_UPLOAD_IDLE_MS);
      },
      // 대기 중인 업로드가 있으면 기다리지 않고 지금 바로 실행한다.
      // 앱이 백그라운드로 가거나 닫힐 때, 25초를 다 못 채운 최근 편집이
      // 기기에만 남고 OneDrive에는 못 올라가는 상황을 막는다.
      flushPendingUpload() {
        if (!connected || uploadTimer === null) return Promise.resolve("noop");
        clearTimeout(uploadTimer);
        uploadTimer = null;
        return queue(() => runSync(false));
      },
      async disconnect() {
        loginGeneration += 1;
        clearTimeout(uploadTimer);
        uploadTimer = null;
        clearInterval(refreshTimer);
        await adapter.disconnect();
        await options.clearSyncBase?.();
        connected = false;
        setState("disconnected", "Microsoft 계정 연결 안 됨");
      },
    };
  }

  // 앱 업데이트는 동기화와 같은 OneDrive 앱 폴더·같은 토큰을 쓰므로
  // 여기서 네이티브 호출만 얇게 열어 준다.
  const appUpdate = {
    supported: () => Boolean(window.BulletBookNative?.checkAppUpdate),
    check: () => nativeCall("checkAppUpdate").then(text => parseJson(
      text, "업데이트 정보를 읽지 못했습니다."
    )),
    install: itemId => nativeCall("installAppUpdate", itemId),
  };

  window.BulletBookCloudSync = {
    create,
    appUpdate,
    __test: Object.freeze({
      bookContentSignature,
      mergeBooks,
    }),
  };
})();
