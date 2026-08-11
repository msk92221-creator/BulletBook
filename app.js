(() => {
  "use strict";

  // 사진 속 노트의 "모눈 40 × 28" 비율을 그대로 사용한다.
  const PAGE_W = 672;
  // 가로의 정확히 2배(모눈 24의 배수). Fold7 접었을 때(1080×2520)와 폈을 때
  // 2쪽(각 984×2184) 모두 이 비율에서 화면을 거의 다 채운다. 예전 960에서는
  // 세로가 2/3만 차 위아래 여백이 크게 남았다.
  const PAGE_H = 1224;
  const STORAGE_KEY = "bulletbook.document.v3";
  const WELCOME_KEY = "bulletbook.welcomed.v1";
  const DB_NAME = "BulletBookDB";
  const DB_STORE = "documents";
  const SEARCH_STORE = "searchEntries";
  const SYNC_STORE = "syncState";
  const RECOVERY_STORE = "recoverySnapshots";
  const DB_KEY = "current-v3";
  const SYNC_BASE_KEY = "onedrive-base-v1";
  const SYNC_BASE_FALLBACK_KEY = "bulletbook.sync-base.v1";
  const RECOVERY_FALLBACK_KEY = "bulletbook.recovery-latest.v1";
  const MAX_RECOVERY_SNAPSHOTS = 12;
  const COLLAPSED_GROUPS_KEY = "bulletbook.collapsed-groups.v1";
  const VIEW_MODE_KEY = "bulletbook.view-mode.v1";
  const PAGE_LIST_HEIGHT_KEY = "bulletbook.page-list-height.v1";
  const CURRENT_BOOK_VERSION = 6;
  const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
  const GRID_SIZE = 24;
  // Android의 표준 확장 화면 분기점. Fold7 커버 화면은 이보다 좁고,
  // 펼친 내부 화면은 이보다 넓어 자동 모드가 1쪽/2쪽으로 확실히 갈린다.
  const ANDROID_SPREAD_MIN_WIDTH = 600;
  const BULLET_SYMBOLS = {
    dot: { open: "•", migrated: "›", scheduled: "‹", completed: "×" },
    circle: { open: "○", migrated: "⧁", scheduled: "⧀", completed: "⊗" },
    memo: { open: "−" },
    idea: { open: "+" },
  };
  const BULLET_SHORTCUTS = [
    ["base", "dot"],
    ["base", "circle"],
    ["status", "migrated"],
    ["status", "scheduled"],
    ["status", "completed"],
    ["base", "memo"],
    ["base", "idea"],
  ];
  const isAndroidApp = Boolean(window.BulletBookNative) || /Android/i.test(navigator.userAgent);

  const templateNames = {
    cover: "표지",
    index: "인덱스",
    symbols: "기호",
    manual1: "매뉴얼 Ⅰ",
    manual2: "매뉴얼 Ⅱ",
    goals: "연간 목표",
    "future-h1": "미래 기록",
    "future-h2": "미래 기록",
    monthly: "월간 계획",
    "weekly-left": "주간 계획",
    "weekly-right": "주간 계획",
    feedback: "회고",
    blank: "빈 페이지",
    daily: "일간 계획",
  };
  // 새 계획 양식은 문서 v6의 `blank` 페이지에 하위 양식 표식만 더한다.
  // 이전 앱에서도 알 수 없는 페이지 타입으로 문서 전체를 거부하지 않고
  // 일반 빈 페이지로 열 수 있어 Windows·Android 교차 업데이트가 안전하다.
  // 연간 달력은 한 쪽에 한 달(m01~m12, 12쪽). 아래 normalizeBook()이
  // 여기에 없는 planTemplate을 지우므로 12개 키를 반드시 등록해야 한다.
  // q1~q3(4개월씩)·h1/h2(6개월씩)는 이전 문서를 열기 위한 호환용이다.
  const YEAR_CALENDAR_PLAN_PAGES = Object.freeze(
    Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return [
        `year-calendar-m${String(month).padStart(2, "0")}`,
        Object.freeze({ title: `연간 달력 · ${month}월`, titleKey: "year-calendar-title" }),
      ];
    }))
  );
  const PLAN_TEMPLATE_PAGES = Object.freeze({
    ...YEAR_CALENDAR_PLAN_PAGES,
    "year-calendar-q1": Object.freeze({
      title: "연간 달력 · 1–4월",
      titleKey: "year-calendar-title",
    }),
    "year-calendar-q2": Object.freeze({
      title: "연간 달력 · 5–8월",
      titleKey: "year-calendar-title",
    }),
    "year-calendar-q3": Object.freeze({
      title: "연간 달력 · 9–12월",
      titleKey: "year-calendar-title",
    }),
    "year-calendar-h1": Object.freeze({
      title: "연간 달력 · 1–6월",
      titleKey: "year-calendar-title",
    }),
    "year-calendar-h2": Object.freeze({
      title: "연간 달력 · 7–12월",
      titleKey: "year-calendar-title",
    }),
    project: Object.freeze({
      title: "프로젝트 계획",
      titleKey: "project-title",
    }),
    tracker: Object.freeze({
      title: "수치·습관 트래커",
      titleKey: "tracker-title",
    }),
    "life-map": Object.freeze({
      title: "인생 영역 지도",
      titleKey: "life-map-title",
    }),
    "goal-detail": Object.freeze({
      title: "결과 목표",
      titleKey: "goal-detail-title",
    }),
  });

  // 연간 달력 한 쪽에 담는 달. 쪽마다 4개월씩 2열×2행으로 배치한다.
  // 한 쪽에 4개월씩 넣으면 날짜 칸이 너무 좁아 일정이 보이지 않는다.
  // 한 쪽에 한 달만 크게 담아 12쪽으로 나눈다.
  const YEAR_CALENDAR_PAGES = Object.freeze(
    Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return Object.freeze({
        key: `year-calendar-m${String(month).padStart(2, "0")}`,
        months: Object.freeze([month]),
        range: `${month}월`,
      });
    })
  );
  const isYearCalendarTemplate = value =>
    typeof value === "string" && value.startsWith("year-calendar-");
  const yearCalendarMonths = page => {
    if (Array.isArray(page?.months) && page.months.length) return page.months;
    const preset = YEAR_CALENDAR_PAGES.find(item => item.key === page?.planTemplate);
    if (preset) return [...preset.months];
    // 이전 문서의 h1/h2 두 쪽 구조.
    return page?.planTemplate === "year-calendar-h2"
      ? [7, 8, 9, 10, 11, 12]
      : [1, 2, 3, 4, 5, 6];
  };
  const yearCalendarRangeLabel = months => {
    if (!months?.length) return "";
    return months.length === 1
      ? `${months[0]}월`
      : `${months[0]}–${months[months.length - 1]}월`;
  };
  const PAGE_TYPES = new Set(Object.keys(templateNames));
  const ELEMENT_TYPES = new Set(["text", "stroke", "line"]);
  const MOBILE_ADVANCED_TOOLS = new Set(["pen", "highlight", "line", "eraser"]);
  const DEFAULT_BOOK_SIGNATURE = Object.freeze([
    Object.freeze(["cover", "표지"]),
    Object.freeze(["index", "인덱스"]),
    Object.freeze(["symbols", "기호"]),
    Object.freeze(["goals", "연간 목표"]),
    Object.freeze(["future-h1", "미래 기록 · 1–6월"]),
    Object.freeze(["future-h2", "미래 기록 · 7–12월"]),
    Object.freeze(["monthly", ""]),
    Object.freeze(["weekly-left", "주간 계획 · 월–목"]),
    Object.freeze(["weekly-right", "주간 계획 · 금–일"]),
    Object.freeze(["manual1", "Bullet Journal Manual Ⅰ"]),
    Object.freeze(["manual2", "Bullet Journal Manual Ⅱ"]),
    Object.freeze(["feedback", "Feedback & Back"]),
    Object.freeze(["blank", "자유 기록"]),
  ]);
  const PAGE_TITLE_TEMPLATE_KEYS = Object.freeze({
    cover: "cover-title",
    index: "index-title",
    symbols: "symbols-title",
    manual1: "manual1-title",
    manual2: "manual2-title",
    goals: "goals-title",
    "future-h1": "future-title",
    "future-h2": "future-title",
    monthly: "monthly-title",
    "weekly-left": "weekly-title",
    "weekly-right": "weekly-title",
    feedback: "feedback-title",
    blank: "page-title",
    daily: "daily-title",
  });

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const uid = () => globalThis.crypto?.randomUUID?.() ??
    `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const snapToGrid = (value, min = 0, max = Number.POSITIVE_INFINITY) =>
    clamp(Math.round((Number(value) || 0) / GRID_SIZE) * GRID_SIZE, min, max);
  const snapSizeToGrid = value =>
    Math.max(GRID_SIZE, Math.round((Number(value) || GRID_SIZE) / GRID_SIZE) * GRID_SIZE);
  const rectsOverlap = (a, b) =>
    a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
  const escapeHtml = value => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const bulletSymbolInfo = symbol => {
    if (symbol === ".") return { base: "dot", status: "open", symbol: "•" };
    if (symbol === "O" || symbol === "o") {
      return { base: "circle", status: "open", symbol: "○" };
    }
    for (const [base, statuses] of Object.entries(BULLET_SYMBOLS)) {
      for (const [status, value] of Object.entries(statuses)) {
        if (value === symbol) return { base, status, symbol: value };
      }
    }
    if (["x", "X"].includes(symbol)) {
      return { base: "dot", status: "completed", symbol: "×" };
    }
    return null;
  };
  const replaceLeadingBullet = (value, options = {}) => {
    const text = String(value || "");
    const match = text.match(/^(\s*)([.•○Oo›‹×xX⧀⧁⊗−+★])(?:\s+|$)/u);
    const current = bulletSymbolInfo(match?.[2]) || { base: "dot", status: "open" };
    const base = options.base || current.base;
    const isPlan = base === "dot" || base === "circle";
    if (options.status && !options.base && !isPlan) return text;
    const status = isPlan ? (options.status || current.status || "open") : "open";
    const symbol = BULLET_SYMBOLS[base]?.[status] ||
      BULLET_SYMBOLS[base]?.open || BULLET_SYMBOLS.dot.open;
    const leading = match?.[1] || "";
    const body = match ? text.slice(match[0].length) : text.trimStart();
    return `${leading}${symbol}${body ? ` ${body}` : " "}`;
  };
  const storedCollapsedGroups = (() => {
    try {
      const value = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  })();
  const storedViewMode = (() => {
    try {
      const value = localStorage.getItem(VIEW_MODE_KEY);
      return ["auto", "single", "spread"].includes(value) ? value : "auto";
    } catch {
      return "auto";
    }
  })();
  if (isAndroidApp) document.documentElement.classList.add("android-app");

  function removeLegacyTemplatePlaceholders(value) {
    if (!value?.pages) return value;
    value.pages.forEach(page => {
      if (page.type === "monthly" && page.title === "_월") page.title = "";
    });
    return value;
  }

  const refs = {
    bookTitle: $("#bookTitle"),
    saveDot: $("#saveDot"),
    saveState: $("#saveState"),
    pageList: $("#pageList"),
    spread: $("#spread"),
    viewport: $("#bookViewport"),
    prev: $("#prevPage"),
    next: $("#nextPage"),
    pageStatus: $("#pageStatus"),
    viewStatus: $("#viewStatus"),
    sidebar: $("#sidebar"),
    sidebarListResizer: $("#sidebarListResizer"),
    sidebarTools: $("#sidebarTools"),
    sidebarScrim: $("#sidebarScrim"),
    importInput: $("#importInput"),
    toast: $("#toast"),
    printBook: $("#printBook"),
    welcome: $("#welcomeDialog"),
    color: $("#colorPicker"),
    strokeSize: $("#strokeSize"),
    fontSize: $("#fontSize"),
    fontSizeDown: $("#fontSizeDown"),
    fontSizeUp: $("#fontSizeUp"),
    cloudButton: $("#cloudButton"),
    cloudFileButton: $("#cloudFileButton"),
    cloudDisconnectButton: $("#cloudDisconnectButton"),
    cloudLabel: $("#cloudLabel"),
    cloudStatus: $("#cloudStatus"),
    cloudDialog: $("#cloudConnectDialog"),
    cloudLoginButton: $("#cloudLoginButton"),
    cloudDevicePanel: $("#cloudDevicePanel"),
    cloudDeviceCode: $("#cloudDeviceCode"),
    cloudDeviceLink: $("#cloudDeviceLink"),
    cloudCancelButton: $("#cloudCancelButton"),
    recoveryButton: $("#recoveryButton"),
    mobileRecoveryButton: $("#mobileRecoveryButton"),
    mobileUpdateButton: $("#mobileUpdateButton"),
    desktopUpdateButton: $("#desktopUpdateButton"),
    desktopUpdateStatus: $("#desktopUpdateStatus"),
    mobileUpdateStatus: $("#mobileUpdateStatus"),
    recoveryDialog: $("#recoveryDialog"),
    recoveryCloseButton: $("#recoveryCloseButton"),
    recoveryList: $("#recoveryList"),
    calendarEventDialog: $("#calendarEventDialog"),
    calendarEventTitle: $("#calendarEventTitle"),
    calendarEventForm: $("#calendarEventForm"),
    calendarEventRows: $("#calendarEventRows"),
    calendarEventAddButton: $("#calendarEventAddButton"),
    calendarEventCloseButton: $("#calendarEventCloseButton"),
    addGroupButton: $("#addGroupButton"),
    pageGroupSelect: $("#pageGroupSelect"),
    duplicatePageButton: $("#duplicatePage"),
    deletePageButton: $("#deletePage"),
    groupEditDialog: $("#groupEditDialog"),
    groupEditCloseButton: $("#groupEditCloseButton"),
    groupEditForm: $("#groupEditForm"),
    groupEditName: $("#groupEditName"),
    groupEditParent: $("#groupEditParent"),
    groupEditDeleteButton: $("#groupEditDeleteButton"),
    mobileTodayButton: $("#mobileTodayButton"),
    mobilePagesButton: $("#mobilePagesButton"),
    mobileSearchButton: $("#mobileSearchButton"),
    mobileSearchDialog: $("#mobileSearchDialog"),
    mobileSearchInput: $("#mobileSearchInput"),
    mobileSearchResults: $("#mobileSearchResults"),
    mobileSearchCloseButton: $("#mobileSearchCloseButton"),
    mobileMoreButton: $("#mobileMoreButton"),
    mobileMoreNavButton: $("#mobileMoreNavButton"),
    mobileMoreDialog: $("#mobileMoreDialog"),
    mobileMoreCloseButton: $("#mobileMoreCloseButton"),
    mobileAdvancedToggle: $("#mobileAdvancedToggle"),
    mobileSyncButton: $("#mobileSyncButton"),
    mobileExportButton: $("#mobileExportButton"),
    mobilePageWriteButton: $("#mobilePageWriteButton"),
    mobilePageWriteDialog: $("#mobilePageWriteDialog"),
    mobilePageWriteCloseButton: $("#mobilePageWriteCloseButton"),
    mobilePageWriteEyebrow: $("#mobilePageWriteEyebrow"),
    mobilePageWriteTitle: $("#mobilePageWriteTitle"),
    mobilePageWriteForm: $("#mobilePageWriteForm"),
    mobilePageWriteContext: $("#mobilePageWriteContext"),
    mobilePageWriteContextIcon: $("#mobilePageWriteContextIcon"),
    mobilePageWriteContextTitle: $("#mobilePageWriteContextTitle"),
    mobilePageWriteContextDescription: $("#mobilePageWriteContextDescription"),
    mobileWriteOnceFields: $("#mobileWriteOnceFields"),
    mobileWriteRoutineFields: $("#mobileWriteRoutineFields"),
    mobileWriteOpenRoutineListButton: $("#mobileWriteOpenRoutineListButton"),
    mobileRoutineSchedule: $("#mobileRoutineSchedule"),
    mobileRoutineWeeklyTargetField: $("#mobileRoutineWeeklyTargetField"),
    mobileRoutineWeeklyTarget: $("#mobileRoutineWeeklyTarget"),
    mobileRoutineOnceDateField: $("#mobileRoutineOnceDateField"),
    mobileRoutineDate: $("#mobileRoutineDate"),
    mobileRoutineWeekdayField: $("#mobileRoutineWeekdayField"),
    mobileRoutineMonthDayField: $("#mobileRoutineMonthDayField"),
    mobileRoutineMonthDay: $("#mobileRoutineMonthDay"),
    mobileRoutineYearlyField: $("#mobileRoutineYearlyField"),
    mobileRoutineYearlyDate: $("#mobileRoutineYearlyDate"),
    mobileRoutineIntervalField: $("#mobileRoutineIntervalField"),
    mobileRoutineIntervalStart: $("#mobileRoutineIntervalStart"),
    mobileRoutineIntervalCount: $("#mobileRoutineIntervalCount"),
    mobileRoutineIntervalUnit: $("#mobileRoutineIntervalUnit"),
    mobilePageWritePageSelect: $("#mobilePageWritePageSelect"),
    mobilePageWriteAddContinuationButton: $("#mobilePageWriteAddContinuationButton"),
    mobilePageWriteWeekField: $("#mobilePageWriteWeekField"),
    mobilePageWriteWeekNumber: $("#mobilePageWriteWeekNumber"),
    mobilePageWriteWeekStartField: $("#mobilePageWriteWeekStartField"),
    mobilePageWriteWeekStart: $("#mobilePageWriteWeekStart"),
    mobilePageWriteTargetLegend: $("#mobilePageWriteTargetLegend"),
    mobilePageWriteTargets: $("#mobilePageWriteTargets"),
    mobilePageWriteDetailField: $("#mobilePageWriteDetailField"),
    mobilePageWriteDetailLabel: $("#mobilePageWriteDetailLabel"),
    mobilePageWriteDetailSelect: $("#mobilePageWriteDetailSelect"),
    mobilePageWriteContentLabel: $("#mobilePageWriteContentLabel"),
    mobilePageWriteInput: $("#mobilePageWriteInput"),
    mobilePageWriteHint: $("#mobilePageWriteHint"),
    mobilePageWriteSubmit: $("#mobilePageWriteSubmit"),
    mobileTextContextDialog: $("#mobileTextContextDialog"),
    mobileTextContextCloseButton: $("#mobileTextContextCloseButton"),
    mobileTextContextInput: $("#mobileTextContextInput"),
    mobileTextContextFontSize: $("#mobileTextContextFontSize"),
    mobileTextFontDown: $("#mobileTextFontDown"),
    mobileTextFontUp: $("#mobileTextFontUp"),
    mobileTextContextSaveButton: $("#mobileTextContextSaveButton"),
    mobileTextContextDuplicateButton: $("#mobileTextContextDuplicateButton"),
    mobileTextContextCopyButton: $("#mobileTextContextCopyButton"),
    mobileTextContextPasteButton: $("#mobileTextContextPasteButton"),
    mobileTextContextCutButton: $("#mobileTextContextCutButton"),
    mobileTextContextFrontButton: $("#mobileTextContextFrontButton"),
    mobileTextContextBackButton: $("#mobileTextContextBackButton"),
    mobileTextContextDeleteButton: $("#mobileTextContextDeleteButton"),
    mobileTextContextEditRoutineButton: $("#mobileTextContextEditRoutineButton"),
    goalHubDialog: $("#goalHubDialog"),
    goalHubCloseButton: $("#goalHubCloseButton"),
    goalHubSummary: $("#goalHubSummary"),
    goalHubList: $("#goalHubList"),
    receiveTodayMissionsButton: $("#receiveTodayMissionsButton"),
    addLifeAreaButton: $("#addLifeAreaButton"),
    openLifeMapButton: $("#openLifeMapButton"),
    goalEditorDialog: $("#goalEditorDialog"),
    goalEditorEyebrow: $("#goalEditorEyebrow"),
    goalEditorTitle: $("#goalEditorTitle"),
    goalEditorCloseButton: $("#goalEditorCloseButton"),
    goalEditorForm: $("#goalEditorForm"),
    goalEditorDeleteButton: $("#goalEditorDeleteButton"),
    areaEditorFields: $("#areaEditorFields"),
    areaEditorName: $("#areaEditorName"),
    areaEditorPurpose: $("#areaEditorPurpose"),
    outcomeEditorFields: $("#outcomeEditorFields"),
    outcomeEditorArea: $("#outcomeEditorArea"),
    outcomeEditorTitle: $("#outcomeEditorTitle"),
    outcomeEditorResult: $("#outcomeEditorResult"),
    outcomeEditorMetric: $("#outcomeEditorMetric"),
    outcomeEditorUnit: $("#outcomeEditorUnit"),
    outcomeEditorStart: $("#outcomeEditorStart"),
    outcomeEditorCurrent: $("#outcomeEditorCurrent"),
    outcomeEditorTarget: $("#outcomeEditorTarget"),
    outcomeEditorDue: $("#outcomeEditorDue"),
    outcomeEditorStatus: $("#outcomeEditorStatus"),
    missionEditorFields: $("#missionEditorFields"),
    missionEditorGoal: $("#missionEditorGoal"),
    missionEditorTitle: $("#missionEditorTitle"),
    missionEditorBulletBase: $("#missionEditorBulletBase"),
    missionEditorSchedule: $("#missionEditorSchedule"),
    missionWeeklyTargetField: $("#missionWeeklyTargetField"),
    missionEditorWeeklyTarget: $("#missionEditorWeeklyTarget"),
    missionOnceDateField: $("#missionOnceDateField"),
    missionEditorDate: $("#missionEditorDate"),
    missionWeekdayField: $("#missionWeekdayField"),
    missionMonthDayField: $("#missionMonthDayField"),
    missionEditorMonthDay: $("#missionEditorMonthDay"),
    missionYearlyField: $("#missionYearlyField"),
    missionEditorYearlyDate: $("#missionEditorYearlyDate"),
    missionIntervalField: $("#missionIntervalField"),
    missionEditorIntervalStart: $("#missionEditorIntervalStart"),
    missionEditorIntervalCount: $("#missionEditorIntervalCount"),
    missionEditorIntervalUnit: $("#missionEditorIntervalUnit"),
    missionEditorActive: $("#missionEditorActive"),
  };

  let book = createDefaultBook();
  let currentIndex = 0;
  let viewMode = storedViewMode;
  let tool = "select";
  let selection = null;
  let saveTimer = null;
  let saveRevision = 0;
  let localSaveQueue = Promise.resolve();
  let toastTimer = null;
  let history = [];
  let historyIndex = -1;
  let drawing = null;
  let textEditBefore = null;
  let lastSpreadState = null;
  let activePageId = null;
  let elementClipboard = null;
  let cloudSync = null;
  let keyboardScope = "canvas";
  let mobileWriteSymbol = "•";
  let mobileWriteMode = "once";
  let mobileWriteTarget = "";
  let mobileWriteDetail = "";
  let mobileWriteDateContext = "";
  let advancedMobileEditing = false;
  let pageListDragState = null;
  let cloudAuthWindow = null;
  let pageZoom = 1;
  let pagePanX = 0;
  let pagePanY = 0;
  let zoomSpreadKey = "";
  let touchZoomActive = false;
  let editingGroupId = null;
  let cloudLoginWatchTimer = null;
  let cloudRecoveryPromise = null;
  let editingCalendarDate = "";
  let lastPageTitleClick = { pageId: "", at: 0 };
  let editingGoalEntity = null;
  let goalEditorReturnTarget = "hub";
  const collapsedGroups = new Set(storedCollapsedGroups);
  const selectedPageIds = new Set();

  function makePage(type, title, extra = {}) {
    return {
      id: uid(),
      type,
      title: title ?? templateNames[type] ?? "페이지",
      elements: [],
      templateText: {},
      createdAt: new Date().toISOString(),
      ...extra,
    };
  }

  function makeWeeklyPagePair() {
    const weeklyPairId = uid();
    const shared = { weekStart: null, weekNumber: "", weeklyPairId };
    return [
      makePage("weekly-left", "주간 계획 · 월–목", { ...shared, side: "left" }),
      makePage("weekly-right", "주간 계획 · 금–일", { ...shared, side: "right" }),
    ];
  }

  function makeText(x, y, text, options = {}) {
    const element = {
      id: uid(),
      type: "text",
      x,
      y,
      width: options.width ?? 260,
      height: options.height ?? 34,
      text,
      color: options.color ?? "#20201d",
      fontSize: options.fontSize ?? 18,
      fontWeight: options.fontWeight ?? 450,
      fontStyle: options.fontStyle ?? "normal",
      align: options.align ?? "left",
      gridLocked: options.gridLocked ?? false,
      layoutTarget: options.layoutTarget ?? null,
    };
    [
      "missionId", "goalId", "areaId", "missionDate",
      "calendarEventId", "calendarDate",
    ].forEach(key => {
      if (options[key]) element[key] = options[key];
    });
    return element;
  }

  function createEmptyGoalSystem() {
    return { version: 1, areas: [], goals: [], missions: [] };
  }

  function normalizeGoalSystem(value) {
    const source = value && typeof value === "object" ? value : {};
    const result = createEmptyGoalSystem();
    result.version = 1;
    result.areas = (Array.isArray(source.areas) ? source.areas : [])
      .filter(area => area && typeof area === "object")
      .map(area => ({
        id: String(area.id || uid()),
        name: String(area.name || "인생 영역").trim().slice(0, 40) || "인생 영역",
        purpose: String(area.purpose || "").trim().slice(0, 240),
        createdAt: area.createdAt || new Date().toISOString(),
      }));
    const areaIds = new Set(result.areas.map(area => area.id));
    const recoveredAreaId = "bulletbook-recovered-area";
    const ensureRecoveredArea = () => {
      if (!areaIds.has(recoveredAreaId)) {
        result.areas.push({
          id: recoveredAreaId,
          name: "복구된 목표",
          purpose: "연결 정보가 없어진 목표·미션을 데이터 손실 없이 보존한 영역",
          createdAt: new Date().toISOString(),
        });
        areaIds.add(recoveredAreaId);
      }
      return recoveredAreaId;
    };
    result.goals = (Array.isArray(source.goals) ? source.goals : [])
      .filter(goal => goal && typeof goal === "object")
      .map(goal => {
        const requestedAreaId = String(goal.areaId || "");
        return {
          id: String(goal.id || uid()),
          areaId: areaIds.has(requestedAreaId) ? requestedAreaId : ensureRecoveredArea(),
          title: String(goal.title || "결과 목표").trim().slice(0, 80) || "결과 목표",
          result: String(goal.result || "").trim().slice(0, 320),
          metricName: String(goal.metricName || "").trim().slice(0, 30),
          unit: String(goal.unit || "").trim().slice(0, 12),
          startValue: finiteOrNull(goal.startValue),
          currentValue: finiteOrNull(goal.currentValue),
          targetValue: finiteOrNull(goal.targetValue),
          dueDate: normalizedDateOrBlank(goal.dueDate),
          status: ["active", "paused", "completed"].includes(goal.status)
            ? goal.status : "active",
          createdAt: goal.createdAt || new Date().toISOString(),
        };
      });
    const goalIds = new Set(result.goals.map(goal => goal.id));
    result.missions = (Array.isArray(source.missions) ? source.missions : [])
      .filter(mission => mission && typeof mission === "object")
      .map(mission => {
        let goalId = String(mission.goalId || "");
        if (!goalIds.has(goalId)) {
          goalId ||= `bulletbook-recovered-goal-${uid()}`;
          result.goals.push({
            id: goalId,
            areaId: ensureRecoveredArea(),
            title: "복구된 미션 목표",
            result: "원래 연결된 결과 목표 정보가 없어 미션을 보존하기 위해 만든 목표",
            metricName: "", unit: "", startValue: null, currentValue: null,
            targetValue: null, dueDate: "", status: "paused",
            createdAt: new Date().toISOString(),
          });
          goalIds.add(goalId);
        }
        const scheduleTypes = [
          "daily", "weekly", "weekdays", "weekend", "custom", "once",
          "monthly-date", "monthly-last", "yearly-date", "interval",
        ];
        const intervalUnit = ["day", "week", "month", "year"].includes(mission.intervalUnit)
          ? mission.intervalUnit : "day";
        return {
          id: String(mission.id || uid()),
          goalId,
          title: String(mission.title || "미션").trim().slice(0, 100) || "미션",
          // 미션을 일간·주간에 받을 때 어떤 불렛(할일·일정·메모·아이디어)으로
          // 적을지. 일반 기록과 같은 기호·상태 체계를 그대로 쓴다.
          bulletBase: Object.keys(BULLET_SYMBOLS).includes(mission.bulletBase)
            ? mission.bulletBase : "dot",
          schedule: scheduleTypes.includes(mission.schedule) ? mission.schedule : "daily",
          weeklyTarget: clamp(Math.round(Number(mission.weeklyTarget) || 1), 1, 7),
          weekdays: [...new Set((Array.isArray(mission.weekdays) ? mission.weekdays : [])
            .map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))],
          scheduledDate: normalizedDateOrBlank(mission.scheduledDate),
          // 위젯·현재 페이지 쓰기에서 만든 빠른 루틴의 시작일. 비어 있으면
          // 기존 미션처럼 과거 날짜 제한 없이 반복 규칙만 적용한다.
          startDate: normalizedDateOrBlank(mission.startDate),
          // 매월 특정 날짜(monthly-date). 그 달에 없는 날짜(31일 등)는 건너뛴다 —
          // '매월 마지막 날'은 별도 종류라 여기서 달 길이에 맞춰 당기지 않는다.
          monthDay: clamp(Math.round(Number(mission.monthDay) || 1), 1, 31),
          // 매년 특정 날짜(yearly-date). 연도는 저장하지 않고 월·일만 쓴다.
          yearMonth: clamp(Math.round(Number(mission.yearMonth) || 1), 1, 12),
          yearDay: clamp(Math.round(Number(mission.yearDay) || 1), 1, 31),
          // 자유 간격(interval): 시작일로부터 N일/주/개월/년마다 반복.
          intervalUnit,
          intervalCount: clamp(Math.round(Number(mission.intervalCount) || 1), 1, 999),
          intervalStart: normalizedDateOrBlank(mission.intervalStart),
          active: mission.active !== false,
          createdAt: mission.createdAt || new Date().toISOString(),
        };
      });
    return result;
  }

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizedDateOrBlank(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const date = dateFromIso(text);
    return !Number.isNaN(date.getTime()) && isoDate(date) === text ? text : "";
  }

  function normalizeCalendarEvents(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .filter(event => event && typeof event === "object")
      .map(event => {
        // 일간 페이지의 어느 칸(할 일/오늘의 기록)에 놓였는지는 선택 정보다.
        // 월간·주간·연간에서 만든 일정에는 없고, 있어도 둘 중 하나가 아니면 버린다.
        const column = event.column === "daily-todo" || event.column === "daily-log"
          ? event.column
          : undefined;
        // 계획 상태(이월/예정/완료). 기본값(열림)은 저장하지 않는다.
        const status = ["migrated", "scheduled", "completed"].includes(event.status)
          ? event.status
          : undefined;
        return {
          id: String(event.id || uid()),
          date: normalizedDateOrBlank(event.date),
          title: String(event.title || "").replace(/\s+/g, " ").trim().slice(0, 240),
          createdAt: event.createdAt || new Date().toISOString(),
          updatedAt: event.updatedAt || event.createdAt || new Date().toISOString(),
          ...(column ? { column } : {}),
          ...(status ? { status } : {}),
          ...(event.missionId ? { missionId: String(event.missionId) } : {}),
        };
      })
      .filter(event => event.date && event.title && !seen.has(event.id) && seen.add(event.id));
  }

  function createDefaultBook() {
    const weeklyPages = makeWeeklyPagePair();
    const weeklyByType = new Map(weeklyPages.map(page => [page.type, page]));
    const pages = DEFAULT_BOOK_SIGNATURE.map(([type, title]) => {
      if (weeklyByType.has(type)) {
        const page = weeklyByType.get(type);
        page.title = title;
        return page;
      }
      if (type === "goals") return makePage(type, title, { year: null });
      if (type === "future-h1") {
        return makePage(type, title, { year: null, months: [1,2,3,4,5,6] });
      }
      if (type === "future-h2") {
        return makePage(type, title, { year: null, months: [7,8,9,10,11,12] });
      }
      if (type === "monthly") return makePage(type, title, { year: null, month: null });
      return makePage(type, title);
    });
    return {
      format: "bulletbook",
      version: CURRENT_BOOK_VERSION,
      id: uid(),
      title: "나의 불렛북",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncPristine: true,
      pages,
      groups: [],
      calendarEvents: [],
      goalSystem: createEmptyGoalSystem(),
    };
  }

  function migrateLegacyCaptures(value, captures) {
    const records = captures
      .map(capture => ({
        symbol: String(capture?.symbol || "−"),
        content: String(capture?.content || "").trim(),
        status: String(capture?.status || "inbox"),
      }))
      .filter(capture => capture.content);
    if (!records.length) return;

    const pageSize = 18;
    for (let start = 0; start < records.length; start += pageSize) {
      const pageNumber = Math.floor(start / pageSize) + 1;
      const archivePage = makePage(
        "blank",
        pageNumber === 1 ? "이전 빠른 메모" : `이전 빠른 메모 ${pageNumber}`
      );
      records.slice(start, start + pageSize).forEach((capture, row) => {
        const completed = capture.status === "done" ? "  ✓" : "";
        archivePage.elements.push(makeText(
          68,
          142 + row * 42,
          `${capture.symbol} ${capture.content}${completed}`,
          { width: 536, height: 34, fontSize: 16, color: "#20201d" }
        ));
      });
      value.pages.push(archivePage);
    }
    value.quickCaptureMigratedAt ||= new Date().toISOString();
    value.syncPristine = false;
  }

  function groupPathForId(groupId, groups = book.groups) {
    if (!groupId) return [];
    const groupById = new Map((groups || []).map(group => [group.id, group]));
    const reversed = [];
    const seen = new Set();
    let current = groupById.get(groupId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      reversed.push(current);
      current = current.parentId ? groupById.get(current.parentId) : null;
    }
    return reversed.reverse();
  }

  function yearFromLabel(value) {
    const match = String(value || "").match(/(?:^|[^\d])(\d{4}|\d{2})\s*년/u);
    if (!match) return null;
    const year = Number(match[1]);
    return match[1].length === 2 ? 2000 + year : year;
  }

  function monthFromLabel(value) {
    const match = String(value || "").match(/(?:^|[^\d])(1[0-2]|0?[1-9])\s*월/u);
    return match ? Number(match[1]) : null;
  }

  function monthlyDateContext(page, groups = book.groups) {
    const path = groupPathForId(page?.groupId, groups);
    let groupYear = null;
    let groupMonth = null;
    path.forEach(group => {
      groupYear = yearFromLabel(group.name) || groupYear;
      groupMonth = monthFromLabel(group.name) || groupMonth;
    });

    const titleYear = yearFromLabel(page?.title);
    const titleMonth = monthFromLabel(page?.title);
    const storedYear = Number.isInteger(page?.year) ? page.year : null;
    const storedMonth = Number.isInteger(page?.month) && page.month >= 1 && page.month <= 12
      ? page.month
      : null;
    const month = storedMonth || groupMonth || titleMonth;
    const year = storedYear || groupYear || titleYear ||
      (month ? new Date().getFullYear() : null);
    return {
      year,
      month,
      hasCalendarDate: Number.isInteger(year) && Number.isInteger(month),
    };
  }

  function monthlyDayCount(page, groups = book.groups) {
    const { year, month, hasCalendarDate } = monthlyDateContext(page, groups);
    return hasCalendarDate ? new Date(year, month, 0).getDate() : 31;
  }

  function pageTitleTemplateField(page) {
    const plan = PLAN_TEMPLATE_PAGES[page?.planTemplate];
    if (page?.type === "blank" && plan) return `x.${plan.titleKey}`;
    return `x.${PAGE_TITLE_TEMPLATE_KEYS[page?.type] || "page-title"}`;
  }

  function isWeeklyPage(page) {
    return page?.type === "weekly-left" || page?.type === "weekly-right";
  }

  // 주간 계획은 월-목/금-일 두 쪽이 하나의 논리 페이지다. 예전 버전이나
  // 개별 그룹 이동으로 두 쪽의 groupId가 달라졌다면 월요일이 있는 왼쪽 쪽을
  // 기준으로 다시 같은 그룹에 둔다. 기록은 합치거나 삭제하지 않는다.
  function alignWeeklyPairGroups(pages, groups) {
    const validGroupIds = new Set((groups || []).map(group => group.id));
    const pairs = new Map();
    (pages || []).forEach(page => {
      if (!isWeeklyPage(page) || !page.weeklyPairId) return;
      if (!pairs.has(page.weeklyPairId)) pairs.set(page.weeklyPairId, []);
      pairs.get(page.weeklyPairId).push(page);
    });
    pairs.forEach(pairPages => {
      if (pairPages.length < 2) return;
      const leftPage = pairPages.find(page => page.type === "weekly-left");
      const ownerGroupId = [leftPage, ...pairPages]
        .map(page => page?.groupId || null)
        .find(groupId => groupId && validGroupIds.has(groupId)) || null;
      pairPages.forEach(page => {
        page.groupId = ownerGroupId;
      });
    });
  }

  function isAutomaticWeeklyTitle(page, value) {
    const title = String(value || "").trim();
    if (!title) return true;
    if (/^주간 계획 · (?:월–목|금–일)(?: · 계속 \d+)?$/u.test(title)) return true;
    const range = page?.type === "weekly-right" ? "금-일" : "월-목";
    return new RegExp(
      `^\\s*\\d+(?:\\.\\d+)?\\s*주차\\s*주간\\s*계획\\s*\\(${range}\\)(?:\\s*·\\s*계속\\s*\\d+)?\\s*$`,
      "u"
    ).test(title);
  }

  function defaultStoredPageTitle(page) {
    const plan = PLAN_TEMPLATE_PAGES[page?.planTemplate];
    if (page?.type === "blank" && page.planTemplate === "goal-detail") {
      return book.goalSystem?.goals?.find(goal => goal.id === page.goalId)?.title || plan.title;
    }
    if (page?.type === "blank" && plan) return plan.title;
    if (isWeeklyPage(page)) return weeklyPageTitle(page);
    if (page?.type === "monthly" || page?.type === "daily") return "";
    return DEFAULT_BOOK_SIGNATURE.find(([type]) => type === page?.type)?.[1] ||
      templateNames[page?.type] || "페이지";
  }

  function setPageTitle(page, value) {
    if (!page) return "";
    const title = String(value ?? "").trim().slice(0, 120);
    const field = pageTitleTemplateField(page);
    page.templateText ||= {};
    if (!title) {
      delete page.titleCustomized;
      delete page.templateText[field];
      page.title = defaultStoredPageTitle(page);
      return "";
    }
    page.title = title;
    page.titleCustomized = true;
    page.templateText[field] = title;
    if (isWeeklyPage(page)) {
      const weekNumber = title.match(/^\s*(\d+(?:\.\d+)?)\s*주차/u)?.[1];
      if (weekNumber) setWeeklyNumberForPair(page, weekNumber);
    }
    return title;
  }

  function editPageTitle(page) {
    if (!page) return;
    const next = prompt(
      "페이지 제목을 입력하세요. 빈칸으로 확인하면 기본 제목으로 돌아갑니다.",
      pageDisplayTitle(page)
    );
    if (next === null) return;
    const title = setPageTitle(page, next);
    commitHistory();
    renderAll();
    showToast(title
      ? `페이지 제목을 “${title}”(으)로 변경했습니다`
      : "기본 페이지 제목으로 복원했습니다");
  }

  function continuationPageNumber(page) {
    const index = Math.round(Number(page?.continuationIndex) || 0);
    return index > 0 ? index + 1 : 0;
  }

  function continuedPageLabel(page, label) {
    const number = continuationPageNumber(page);
    return number ? `${label} · 계속 ${number}` : label;
  }

  function pageDisplayTitle(page, fallback = "페이지", groups = book.groups) {
    const title = page?.title?.trim();
    if (page?.titleCustomized === true && title) return title;
    if (page?.type === "daily" && page.pageDate) {
      const date = dateFromIso(page.pageDate);
      const automaticTitle = !title || title === templateNames.daily ||
        /^\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*\([일월화수목금토]\))?$/u.test(title);
      if (automaticTitle && !Number.isNaN(date.getTime())) {
        return continuedPageLabel(page, dailyDateLabel(date));
      }
    }
    if (title) return title;
    if (page?.type === "monthly") {
      const { month } = monthlyDateContext(page, groups);
      if (month) return `${month}월 월간 계획`;
    }
    return continuedPageLabel(page, templateNames[page?.type] || fallback);
  }

  function groupDescendantIdSet(groupId, groups = book.groups) {
    const result = new Set();
    (groups || []).forEach(group => {
      if (groupPathForId(group.id, groups).some(item => item.id === groupId)) {
        result.add(group.id);
      }
    });
    return result;
  }

  function canSetGroupParent(groupId, parentId, groups = book.groups) {
    if (!parentId) return true;
    if (groupId === parentId) return false;
    return !groupDescendantIdSet(groupId, groups).has(parentId);
  }

  function normalizeGroupPageOrder(pages, groups) {
    const pagePaths = new Map((pages || []).map(page => [
      page.id,
      groupPathForId(page.groupId, groups).map(group => group.id),
    ]));
    const normalizeSubtree = (groupId, candidates) => {
      const result = [];
      const emittedChildren = new Set();
      candidates.forEach(page => {
        const path = pagePaths.get(page.id) || [];
        const position = path.indexOf(groupId);
        if (position < 0) return;
        if (position === path.length - 1) {
          result.push(page);
          return;
        }
        const childId = path[position + 1];
        if (emittedChildren.has(childId)) return;
        emittedChildren.add(childId);
        const childPages = candidates.filter(candidate =>
          (pagePaths.get(candidate.id) || []).includes(childId)
        );
        result.push(...normalizeSubtree(childId, childPages));
      });
      return result;
    };

    const result = [];
    const emittedRoots = new Set();
    (pages || []).forEach(page => {
      const path = pagePaths.get(page.id) || [];
      if (!path.length) {
        result.push(page);
        return;
      }
      const rootId = path[0];
      if (emittedRoots.has(rootId)) return;
      emittedRoots.add(rootId);
      const rootPages = pages.filter(candidate =>
        (pagePaths.get(candidate.id) || [])[0] === rootId
      );
      result.push(...normalizeSubtree(rootId, rootPages));
    });
    return result;
  }

  // 이전 버전은 템플릿 글자를 문서 순서 인덱스(t0, t1 …)로 저장했다.
  // 각 페이지 종류의 옛 순서를 그대로 나열해 고정 키로 한 번 옮긴다.
  // 월간은 저장 당시의 날짜 수를 알 수 없어 현재 달 기준으로 옮긴다.
  const range = (count, make) => Array.from({ length: count }, (_, index) => make(index));
  const LEGACY_TEMPLATE_FIELDS = {
    cover: () => ["cover-title", "cover-caption"],
    index: () => ["index-title", "index-subtitle"],
    symbols: () => [
      "symbols-title", "symbols-subtitle",
      ...range(7, i => [`symbol-${i}-mark`, `symbol-${i}-label`]).flat(),
    ],
    manual1: () => ["manual1-title", "manual1-subtitle", ...range(11, i => `manual1-${i}`)],
    manual2: () => ["manual2-title", "manual2-subtitle", ...range(10, i => `manual2-${i}`)],
    goals: () => [
      "goals-title", "goals-subtitle",
      "goal-1", "goal-2", "goal-3", "goal-4", "goals-note",
    ],
    "future-h1": () => [
      "future-title", "future-subtitle",
      ...range(6, i => `future-month-${i}`),
      ...range(31, i => `future-day-${i + 1}`),
    ],
    // t{n} 키를 만든 0.16 이하의 monthlyTemplate은 page.year/page.month가 언제나
    // null이라 예외 없이 31줄로 렌더링했다. 저장 당시의 줄 수를 알 수 없으므로
    // 명시적으로 저장된 연·월이 있을 때만 그 달의 일수를 쓰고, 없으면 31로 본다.
    monthly: (page, groups) => {
      const storedMonth = Number.isInteger(page?.month) && page.month >= 1 && page.month <= 12
        ? page.month
        : null;
      const days = Number.isInteger(page?.year) && storedMonth
        ? monthlyDayCount(page, groups)
        : 31;
      return [
        "monthly-title", "monthly-subtitle",
        ...range(days, i => `monthly-day-${i + 1}`),
        "monthly-goal-heading",
        "monthly-goal-1", "monthly-goal-2", "monthly-goal-3",
        "monthly-queue",
      ];
    },
    "weekly-left": () => [
      "weekly-title", "weekly-subtitle",
      "weekly-day-0", "weekly-day-1", "weekly-day-2", "weekly-day-3",
      "weekly-overview-heading",
    ],
    "weekly-right": () => [
      "weekly-title", "weekly-subtitle",
      "weekly-day-4", "weekly-day-5", "weekly-day-6",
    ],
    daily: () => ["daily-title", "daily-subtitle", "daily-todo-heading", "daily-log-heading"],
    feedback: () => [
      "feedback-title", "feedback-subtitle",
      "feedback-good", "feedback-hard", "feedback-learn", "feedback-change", "feedback-back",
    ],
  };
  LEGACY_TEMPLATE_FIELDS["future-h2"] = LEGACY_TEMPLATE_FIELDS["future-h1"];

  function migrateTemplateTextKeys(page, groups) {
    const templateText = page.templateText;
    if (!templateText) return;
    const legacyFields = Object.keys(templateText).filter(field => /^t\d+$/.test(field));
    if (!legacyFields.length) return;
    const buildKeys = LEGACY_TEMPLATE_FIELDS[page.type];
    const keys = buildKeys ? buildKeys(page, groups) : ["page-title", "page-subtitle"];
    legacyFields.forEach(field => {
      const value = templateText[field];
      delete templateText[field];
      const key = keys[Number(field.slice(1))];
      if (!key) return;
      const nextField = `x.${key}`;
      if (!Object.prototype.hasOwnProperty.call(templateText, nextField)) {
        templateText[nextField] = value;
      }
    });
  }

  // 연간 달력을 6개월 두 쪽(h1/h2)에서 4개월 세 쪽(q1~q3)으로 옮긴다.
  // 달력은 book.calendarEvents에서 그려지므로 쪽 자체에는 사용자 기록이 없어
  // 구조만 바꿔도 일정이 사라지지 않는다.
  //
  // 반드시 멱등이어야 한다: Windows·Android가 각자 읽은 원격 문서에 이 함수를
  // 따로 실행한 뒤 3방향 병합으로 합치므로, 실행할 때마다 같은 입력에서 같은
  // id·같은 months가 나오지 않으면 두 기기가 서로 다른 페이지를 만들어 내고
  // 병합이 그걸 중복으로 쌓는다. 예전 버전은 옛 페이지를 슬롯 순서대로
  // 재사용하면서 id는 그대로 두어(h1→q1인데 id는 …-h1) 이 문제를 만들었다.
  // 그래서 연도별로 몇 쪽이 있든 항상 지우고 고정 id 3개로 다시 만든다.
  function migrateYearCalendarPages(value) {
    const calendarPages = value.pages.filter(page => isYearCalendarTemplate(page.planTemplate));
    if (!calendarPages.length) return;
    const years = [...new Set(calendarPages.map(page => Number(page.year)).filter(Number.isInteger))];
    years.forEach(year => {
      const pagesForYear = calendarPages.filter(page => Number(page.year) === year);
      const canonicalKeys = YEAR_CALENDAR_PAGES.map(({ key }) => key);
      const alreadyCanonical = pagesForYear.length === canonicalKeys.length &&
        canonicalKeys.every(key => pagesForYear.filter(page => page.planTemplate === key).length === 1) &&
        pagesForYear.every(page => {
          const preset = YEAR_CALENDAR_PAGES.find(item => item.key === page.planTemplate);
          const months = Array.isArray(page.months) ? page.months : [];
          return preset && preset.months.length === months.length &&
            preset.months.every((month, index) => month === months[index]) &&
            page.id === `calendar-year-page-${year}-${page.planTemplate.slice("year-calendar-".length)}`;
        });
      if (alreadyCanonical) return;

      const anchor = pagesForYear[0];
      const pairId = anchor.calendarPairId || `calendar-year-pair-${year}`;
      const groupId = anchor.groupId || null;
      const insertAt = value.pages.indexOf(anchor);
      const rebuilt = YEAR_CALENDAR_PAGES.map(({ key, months, range }) => {
        const id = `calendar-year-page-${year}-${key.slice("year-calendar-".length)}`;
        // 옛 구조에서 같은 슬롯(같은 planTemplate)에 있던 페이지의 사용자 지정
        // 제목만 옮겨 오고, 나머지(특히 months)는 항상 고정 프리셋을 쓴다.
        const matchingSlot = pagesForYear.find(page => page.planTemplate === key);
        const page = makePage("blank", `${year}년 연간 계획 · ${range}`, {
          id, planTemplate: key, year, months: [...months],
          calendarPairId: pairId, groupId,
        });
        if (matchingSlot?.titleCustomized === true) {
          page.title = matchingSlot.title;
          page.titleCustomized = true;
        }
        return page;
      });
      value.pages = value.pages.filter(page => !pagesForYear.includes(page));
      const target = insertAt >= 0 ? Math.min(insertAt, value.pages.length) : value.pages.length;
      value.pages.splice(target, 0, ...rebuilt);
    });
  }

  // 공유 일정 기능(0.24.0)이 생기기 전에 일간·주간·월간 페이지에 그냥 글자로
  // 적어 둔 `○ …` 기록은 페이지 안 텍스트일 뿐이라 다른 날짜 계획에 전혀
  // 나타나지 않는다. 이를 한 번만 공유 일정으로 승격해 연간·월간·주간·일간에
  // 함께 보이게 한다.
  //
  // 새로 만드는 일정의 id는 반드시 결정적이어야 한다. uid()를 쓰면 Windows와
  // Android가 각자 승격할 때 서로 다른 id가 생겨 3방향 병합이 같은 일정을
  // 중복으로 쌓는다(연간 달력에서 겪은 것과 같은 문제). 원본 요소 id는 문서에
  // 저장된 값이라 두 기기에서 동일하므로 그것을 그대로 쓴다.
  function migrateLegacyCircleTextToEvents(value) {
    const existingIds = new Set((value.calendarEvents || []).map(event => event.id));
    value.pages.forEach(page => {
      if (!Array.isArray(page.elements) || !page.elements.length) return;
      const keep = [];
      page.elements.forEach(element => {
        // 루틴이 만든 요소는 승격 대상이 아니다. 승격하면 원본이 지워져
        // "이미 받았는지" 검사가 실패하고 같은 루틴이 계속 쌓인다.
        if (element?.missionId) return keep.push(element);
        const text = element?.type === "text" ? String(element.text || "").trim() : "";
        if (!/^○(?:\s+|$)/u.test(text)) return keep.push(element);
        const title = text.replace(/^○\s*/u, "").replace(/\s+/g, " ").trim().slice(0, 240);
        const date = title ? calendarDateForPageElement(page, element) : "";
        if (!date) return keep.push(element);
        const id = `legacy-event-${element.id}`;
        if (!existingIds.has(id)) {
          existingIds.add(id);
          const createdAt = element.createdAt || page.createdAt || value.createdAt ||
            new Date().toISOString();
          const event = { id, date, title, createdAt, updatedAt: createdAt };
          // 일간 페이지는 원래 적혀 있던 좌우 위치를 그대로 유지한다.
          if (page.type === "daily") {
            event.column = (Number(element.x) || 0) + (Number(element.width) || 0) / 2 < PAGE_W / 2
              ? "daily-todo" : "daily-log";
          }
          value.calendarEvents.push(event);
        }
      });
      if (keep.length !== page.elements.length) page.elements = keep;
    });
  }

  // 0.32.0까지의 결함으로 같은 ○ 루틴이 같은 날짜에 여러 벌 승격돼 쌓였다.
  // 승격으로 생긴 일정(legacy-event-*)만 대상으로, 날짜·제목·칸·상태가 모두
  // 같은 것들을 하나만 남긴다. 사용자가 편집창에서 직접 만든 일정은 uid()라
  // 여기에 걸리지 않으므로 안전하다.
  function dedupeDuplicatedLegacyEvents(value) {
    const events = Array.isArray(value.calendarEvents) ? value.calendarEvents : [];
    if (events.length < 2) return;
    // 같은 날짜·같은 내용·같은 칸이면 한 건만 남긴다. 상태(이월·예정·완료)를
    // 지정해 둔 것이 있으면 그것을 우선 남겨 사용자가 표시한 결과를 잃지 않는다.
    const best = new Map();
    events.forEach(event => {
      const key = JSON.stringify([event.date, event.title, event.column || ""]);
      const current = best.get(key);
      if (!current) return best.set(key, event);
      const score = item => (item.status ? 2 : 0) + (item.missionId ? 1 : 0);
      if (score(event) > score(current)) best.set(key, event);
    });
    const keep = new Set([...best.values()].map(event => event.id));
    if (keep.size === events.length) return;
    value.calendarEvents = events.filter(event => keep.has(event.id));
  }

  function missionDuplicateSignature(mission) {
    const schedule = String(mission?.schedule || "daily");
    const title = String(mission?.title || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
    const signature = [String(mission?.goalId || ""), title, String(mission?.bulletBase || "dot"), schedule];
    if (schedule === "weekly") signature.push(Number(mission.weeklyTarget) || 1);
    if (schedule === "custom") signature.push(...(mission.weekdays || []).map(Number).sort((a, b) => a - b));
    if (schedule === "once") signature.push(normalizedDateOrBlank(mission.scheduledDate));
    if (schedule === "monthly-date") signature.push(Number(mission.monthDay) || 1);
    if (schedule === "yearly-date") signature.push(Number(mission.yearMonth) || 1, Number(mission.yearDay) || 1);
    if (schedule === "interval") {
      signature.push(
        normalizedDateOrBlank(mission.intervalStart),
        String(mission.intervalUnit || "day"),
        Number(mission.intervalCount) || 1
      );
    }
    return JSON.stringify(signature);
  }

  // 날짜 일정만 지워도 반복 루틴 원본은 남는다. 같은 루틴을 다시 만들거나
  // 두 기기의 변경이 합쳐질 때 동일 원본이 여러 개 생기면 날짜별 개수도 함께
  // 늘어나므로, 같은 목표·이름·불렛·반복 규칙은 하나의 루틴으로 합친다.
  function dedupeDuplicatedMissions(value) {
    const system = value?.goalSystem;
    if (!Array.isArray(system?.missions) || system.missions.length < 2) return 0;
    const groups = new Map();
    system.missions.forEach(mission => {
      const signature = missionDuplicateSignature(mission);
      if (!groups.has(signature)) groups.set(signature, []);
      groups.get(signature).push(mission);
    });
    const duplicateGroups = [...groups.values()].filter(group => group.length > 1);
    if (!duplicateGroups.length) return 0;

    const canonicalIdByDuplicateId = new Map();
    const canonicalMissions = [];
    let removed = 0;
    groups.forEach(group => {
      // 기기마다 배열 순서가 달라도 같은 id를 대표로 고르도록 결정적으로 정렬한다.
      const ordered = [...group].sort((left, right) =>
        String(left.id).localeCompare(String(right.id))
      );
      const canonical = ordered[0];
      canonical.active = ordered.some(mission => mission.active);
      const starts = ordered.map(mission => mission.startDate).filter(Boolean).sort();
      if (starts.length) canonical.startDate = starts[0];
      ordered.slice(1).forEach(mission => {
        canonicalIdByDuplicateId.set(mission.id, canonical.id);
        removed += 1;
      });
      canonicalMissions.push(canonical);
    });
    system.missions = canonicalMissions;

    (value.pages || []).forEach(page => {
      const seenMissionRows = new Set();
      page.elements = (page.elements || []).filter(element => {
        const canonicalId = canonicalIdByDuplicateId.get(element.missionId);
        if (canonicalId) element.missionId = canonicalId;
        if (!element.missionId) return true;
        const date = element.missionDate || page.pageDate || "";
        const key = JSON.stringify([element.missionId, date, element.layoutTarget || ""]);
        if (seenMissionRows.has(key)) return false;
        seenMissionRows.add(key);
        return true;
      });
    });

    const bestEventByKey = new Map();
    (value.calendarEvents || []).forEach(event => {
      const canonicalId = canonicalIdByDuplicateId.get(event.missionId);
      if (canonicalId) event.missionId = canonicalId;
      if (!event.missionId) return;
      const key = `${event.missionId}|${event.date}`;
      const current = bestEventByKey.get(key);
      const score = item => (item.status ? 2 : 0) + (item.column ? 1 : 0);
      if (!current || score(event) > score(current)) bestEventByKey.set(key, event);
    });
    const emittedMissionDates = new Set();
    value.calendarEvents = (value.calendarEvents || []).filter(event => {
      if (!event.missionId) return true;
      const key = `${event.missionId}|${event.date}`;
      if (emittedMissionDates.has(key) || bestEventByKey.get(key) !== event) return false;
      emittedMissionDates.add(key);
      event.id = `mission-event-${event.missionId}-${event.date}`;
      return true;
    });
    return removed;
  }

  function removeMissionsFromDate(value, missionIds, dateValue) {
    const ids = new Set(missionIds || []);
    const date = normalizedDateOrBlank(dateValue);
    if (!ids.size || !date) return 0;
    const before = value.goalSystem.missions.length;
    value.goalSystem.missions = value.goalSystem.missions
      .filter(mission => !ids.has(mission.id));
    value.calendarEvents = (value.calendarEvents || []).filter(event =>
      !ids.has(event.missionId) || event.date < date
    );
    (value.pages || []).forEach(page => {
      page.elements = (page.elements || []).filter(element => {
        if (!ids.has(element.missionId)) return true;
        const missionDate = normalizedDateOrBlank(element.missionDate || page.pageDate);
        return !missionDate || missionDate < date;
      });
    });
    return before - value.goalSystem.missions.length;
  }

  // 연/월/주 그룹은 페이지를 만들 때 자동으로 생기는데, 그 안의 페이지를 모두
  // 지우면 빈 껍데기만 남아 목록 맨 아래에 "만든 적 없는 그룹"으로 보인다.
  // 사용자가 직접 만든 그룹(kind 없음)은 비어 있어도 그대로 둔다.
  function pruneEmptyCalendarGroups(value) {
    const autoKinds = new Set(["year", "month", "week"]);
    for (let pass = 0; pass < 4; pass += 1) {
      const usedByPage = new Set(value.pages.map(page => page.groupId).filter(Boolean));
      const usedByChild = new Set(value.groups.map(group => group.parentId).filter(Boolean));
      const before = value.groups.length;
      value.groups = value.groups.filter(group =>
        !autoKinds.has(group.kind) || usedByPage.has(group.id) || usedByChild.has(group.id)
      );
      if (value.groups.length === before) break;
    }
  }

  function normalizeBook(value) {
    if (!value || typeof value !== "object") value = createDefaultBook();
    removeLegacyTemplatePlaceholders(value);
    value.version = Math.max(Number(value.version) || 3, 6);
    value.goalSystem = normalizeGoalSystem(value.goalSystem);
    value.calendarEvents = normalizeCalendarEvents(value.calendarEvents);
    dedupeDuplicatedLegacyEvents(value);
    value.groups = Array.isArray(value.groups) ? value.groups : [];
    value.groups.forEach(group => {
      group.id ||= uid();
      group.name = String(group.name || "페이지 그룹");
      group.parentId = group.parentId || null;
      if (Number.isInteger(Number(group.year))) group.year = Number(group.year);
      if (Number.isInteger(Number(group.month)) && Number(group.month) >= 1 &&
          Number(group.month) <= 12) group.month = Number(group.month);
      if (group.weekStart) group.weekStart = normalizedDateOrBlank(group.weekStart) || null;
    });
    const groupById = new Map(value.groups.map(group => [group.id, group]));
    value.groups.forEach(group => {
      if (group.parentId === group.id || !groupById.has(group.parentId)) {
        group.parentId = null;
      }
      const seen = new Set([group.id]);
      let cursor = group.parentId;
      while (cursor) {
        if (seen.has(cursor)) {
          group.parentId = null;
          break;
        }
        seen.add(cursor);
        cursor = groupById.get(cursor)?.parentId || null;
      }
    });
    const legacyCaptures = Array.isArray(value.captures) ? value.captures : [];
    value.pages = Array.isArray(value.pages) && value.pages.length
      ? value.pages
      : createDefaultBook().pages;
    migrateLegacyCaptures(value, legacyCaptures);
    delete value.captures;
    value.pages.forEach((page, index) => {
      page.id ||= uid();
      page.elements = Array.isArray(page.elements) ? page.elements : [];
      page.templateText = page.templateText && typeof page.templateText === "object"
        ? page.templateText : {};
      if (!Object.prototype.hasOwnProperty.call(PLAN_TEMPLATE_PAGES, page.planTemplate)) {
        delete page.planTemplate;
      }
      if (isYearCalendarTemplate(page.planTemplate)) {
        const calendarYear = Number(page.year);
        page.year = Number.isInteger(calendarYear) && calendarYear >= 1900 && calendarYear <= 2200
          ? calendarYear : new Date().getFullYear();
        // months는 아래 migrateYearCalendarPages()가 연도별로 한 번에 책임진다.
        // 예전 h1/h2 두 쪽 시절 코드가 여기서 endsWith("h1") 기준으로 매번
        // [7,8,9,10,11,12]를 덮어썼는데, 새 q1/q2/q3 키는 하나도 "h1"로 끝나지
        // 않아 항상 걸려 버렸다. 그 결과 아래 마이그레이션이 "달이 틀렸다"고
        // 오판해 정상 문서도 정규화할 때마다 다시 만들었고, createdAt이 매번
        // 바뀌어 기기 간 서명이 어긋나 동기화 때마다 "합쳤습니다" 알림이
        // 반복되고 OneDrive 버전이 15초마다 계속 쌓였다.
      }
      page.createdAt ||= new Date().toISOString();
      if (page.groupId && !value.groups.some(group => group.id === page.groupId)) {
        page.groupId = null;
      }
      if (index === 0 && page.type === "cover") page.groupId = null;
      // 그룹 정리가 끝난 뒤에 옮겨야 월간 페이지의 달을 정확히 읽는다.
      migrateTemplateTextKeys(page, value.groups);
    });
    migrateYearCalendarPages(value);
    migrateLegacyCircleTextToEvents(value);
    dedupeDuplicatedMissions(value);
    // 이미 pair id가 있는 주간 양면은 페이지 순서를 재배치하기 전에 먼저
    // 같은 그룹으로 복구한다. 그렇지 않으면 한쪽이 그룹 밖 맨 아래로 밀린다.
    alignWeeklyPairGroups(value.pages, value.groups);
    // 그룹 계층을 먼저 연속된 쪽 순서로 복구해야 떨어져 저장된 주간 양면도
    // 다시 이웃한 페이지로 인식해 같은 주차로 연결할 수 있다.
    value.pages = normalizeGroupPageOrder(value.pages, value.groups);
    value.pages.forEach((page, index) => {
      if (page.type !== "weekly-left" && page.type !== "weekly-right") return;
      page.weekNumber = String(page.weekNumber || "").replace(/\s*주차\s*$/u, "").trim();
      if (page.weeklyPairId) return;
      const neighbor = page.type === "weekly-left"
        ? value.pages[index + 1]
        : value.pages[index - 1];
      if (neighbor && neighbor.type !== page.type &&
          (neighbor.type === "weekly-left" || neighbor.type === "weekly-right")) {
        page.weeklyPairId = neighbor.weeklyPairId || uid();
        neighbor.weeklyPairId = page.weeklyPairId;
      } else {
        page.weeklyPairId = uid();
      }
    });
    const weeklyPairs = new Map();
    value.pages.forEach(page => {
      if (!page.weeklyPairId) return;
      if (!weeklyPairs.has(page.weeklyPairId)) weeklyPairs.set(page.weeklyPairId, []);
      weeklyPairs.get(page.weeklyPairId).push(page);
    });
    weeklyPairs.forEach(pages => {
      const number = pages.map(page => page.weekNumber).find(Boolean) || "";
      const weekStart = pages.map(page => normalizedWeekStart(page.weekStart)).find(Boolean) || null;
      pages.forEach(page => {
        page.weekNumber = number;
        page.weekStart = weekStart;
        const titleField = pageTitleTemplateField(page);
        const existingTitle = String(page.title || "").trim();
        const storedTitle = String(page.templateText?.[titleField] || "").trim();
        if (page.titleCustomized !== true && (storedTitle || (
          existingTitle && !isAutomaticWeeklyTitle(page, existingTitle)
        ))) {
          page.titleCustomized = true;
          page.title = storedTitle || existingTitle;
          page.templateText[titleField] = page.title;
        }
        if (page.titleCustomized !== true) {
          page.title = weeklyPageTitle(page, number);
          delete page.templateText[titleField];
        }
      });
    });
    alignWeeklyPairGroups(value.pages, value.groups);
    // 페이지가 하나도 남지 않은 연/월/주 그룹은 여기서 걷어낸다. 남겨두면
    // 페이지 목록 맨 아래에 "만든 적 없는 빈 그룹"으로 떠 보인다.
    pruneEmptyCalendarGroups(value);
    // 상위 그룹과 모든 하위 그룹을 하나의 연속된 페이지 블록으로 유지한다.
    value.pages = normalizeGroupPageOrder(value.pages, value.groups);
    return value;
  }

  function isoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function mondayOf(date) {
    const copy = new Date(date);
    const day = copy.getDay();
    copy.setDate(copy.getDate() - (day === 0 ? 6 : day - 1));
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function dateFromIso(value) {
    const [y, m, d] = String(value).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function offsetDate(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function dayLabel(date) {
    return `${date.getMonth() + 1}/${date.getDate()} (${["일","월","화","수","목","금","토"][date.getDay()]})`;
  }

  function dailyDateLabel(date) {
    return `${date.getMonth() + 1}월${date.getDate()}일(${["일","월","화","수","목","금","토"][date.getDay()]})`;
  }

  function calendarEventsForDate(value, sourceBook = book) {
    const date = normalizedDateOrBlank(value);
    if (!date) return [];
    return (sourceBook.calendarEvents || [])
      .filter(event => event.date === date)
      .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  }

  function calendarEventSymbol(event) {
    return BULLET_SYMBOLS.circle[event?.status] || BULLET_SYMBOLS.circle.open;
  }

  function calendarEventText(event) {
    return `${calendarEventSymbol(event)} ${String(event?.title || "").trim()}`.trim();
  }

  function addCalendarEvent(dateValue, titleValue, column, status) {
    const date = normalizedDateOrBlank(dateValue);
    const title = String(titleValue || "").replace(/^\s*[○Oo]\s*/u, "")
      .replace(/\s+/g, " ").trim().slice(0, 240);
    if (!date || !title) return null;
    // 같은 날짜에 같은 내용이 이미 있으면 새로 만들지 않는다. ○ 글자 승격,
    // `현재 페이지 쓰기`, 루틴, 일정 편집창 등 여러 경로가 같은 일정을 각각
    // 만들면서 uid()로 서로 다른 id를 붙여 중복이 계속 쌓이던 것을 막는다.
    book.calendarEvents ||= [];
    const existing = book.calendarEvents.find(event =>
      event.date === date && event.title === title &&
      (event.column || "") === (column === "daily-todo" || column === "daily-log" ? column : "")
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const event = { id: uid(), date, title, createdAt: now, updatedAt: now };
    if (column === "daily-todo" || column === "daily-log") event.column = column;
    if (["migrated", "scheduled", "completed"].includes(status)) event.status = status;
    book.calendarEvents ||= [];
    book.calendarEvents.push(event);
    return event;
  }

  // ---- 홈 화면 캘린더 위젯용 snapshot ----
  // .buj 전체 구조 대신, 위젯이 날짜별 일정 수와 짧은 제목만 알 수 있도록
  // 요약본을 만든다. 제목은 홈 화면 달력 칸 안에 최대 세 개까지 표시한다.
  // 향후 goalSystem.missions(반복 일정) projection을 이 함수 안에 추가하면
  // 위젯에도 반복 일정이 반영된다. V2에서는 명시 calendarEvents만 사용한다.
  let lastWidgetSnapshotJson = "";
  let widgetNativeSequence = 0;

  function addCalendarWidgetItem(days, date, status, item) {
    if (!date) return;
    const bucket = days[date] || (days[date] = {
      open: 0, completed: 0, migrated: 0, scheduled: 0, items: [],
    });
    if (status === "completed") bucket.completed += 1;
    else if (status === "migrated") bucket.migrated += 1;
    else if (status === "scheduled") bucket.scheduled += 1;
    else bucket.open += 1;
    const cleanItem = String(item || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (cleanItem && bucket.items.length < 3 && !bucket.items.includes(cleanItem)) {
      bucket.items.push(cleanItem);
    }
  }

  function buildCalendarWidgetSnapshot() {
    const days = {};
    const representedMissionDates = new Set();
    for (const event of book.calendarEvents || []) {
      const date = String(event?.date || "");
      if (!date) continue;
      const missionKey = event?.missionId ? `${date}|${event.missionId}` : "";
      if (missionKey && representedMissionDates.has(missionKey)) continue;
      if (missionKey) representedMissionDates.add(missionKey);
      addCalendarWidgetItem(days, date, event.status || "open", calendarEventText(event));
    }

    // Project active routines directly into the widget. Previously only materialized
    // calendarEvents were exported, so routines could disappear until a daily/weekly
    // page happened to create an event for them. Keep a bounded multi-year window so
    // month navigation remains useful without making the native snapshot unbounded.
    const today = new Date();
    const projectionStart = new Date(today.getFullYear() - 1, 0, 1);
    const projectionEnd = new Date(today.getFullYear() + 2, 11, 31);
    for (let date = projectionStart; date <= projectionEnd; date = offsetDate(date, 1)) {
      const dateValue = isoDate(date);
      for (const mission of missionsDueOn(date)) {
        const missionKey = `${dateValue}|${mission.id}`;
        if (representedMissionDates.has(missionKey)) continue;
        representedMissionDates.add(missionKey);
        addCalendarWidgetItem(days, dateValue, "open", missionBulletText(mission));
      }
    }
    return { version: 3, days };
  }

  function syncCalendarWidget() {
    if (!isAndroidApp) return;
    const native = window.BulletBookNative;
    if (!native?.pushCalendarWidget) return;
    const snapshot = buildCalendarWidgetSnapshot();
    const stableJson = JSON.stringify(snapshot);
    if (stableJson === lastWidgetSnapshotJson) return; // 내용이 같으면 위젯을 다시 그리지 않는다.
    lastWidgetSnapshotJson = stableJson;
    const json = JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() });
    const requestId = `widget-${Date.now()}-${++widgetNativeSequence}`;
    try {
      native.pushCalendarWidget(requestId, json);
    } catch {
      // 위젯 동기화 실패가 앱 본 기능을 방해하지 않도록 조용히 넘긴다.
    }
  }

  // 일정을 칸 안에 놓을 때 쓰는 지오메트리. mobileWriteTargetsForPage의 같은
  // id를 가진 타깃과 반드시 같은 값을 써야 일정 줄과 손으로 쓴 기록이 같은
  // 모눈 위에서 나란히 정렬된다.
  const DAILY_COLUMN_TARGETS = {
    "daily-todo": { x: 58, width: 246, yStart: 202, rowGap: 42, maxRows: 21, fontSize: 16 },
    "daily-log": { x: 374, width: 238, yStart: 202, rowGap: 42, maxRows: 21, fontSize: 16 },
  };

  function weeklyColumnTarget(page, offset) {
    const offsets = page.type === "weekly-left" ? [0, 1, 2, 3] : [4, 5, 6];
    const index = offsets.indexOf(offset);
    if (index < 0) return null;
    const columnWidth = PAGE_W / offsets.length;
    return {
      x: index * columnWidth + 14,
      width: columnWidth - 28,
      yStart: 342,
      rowGap: 38,
      maxRows: 21,
      fontSize: 14,
    };
  }

  // 일간 페이지 특정 칸에 속한 ○ 일정만 고른다. 칸 정보가 없는 일정(월간·
  // 주간·연간에서 만든 것, 또는 일정 편집창에서 새로 추가한 것)은 '할 일'
  // 칸의 기본값으로 묶는다.
  function dailyColumnCalendarEvents(page, columnId) {
    if (page?.type !== "daily" || page.continuationOf) return [];
    const date = normalizedDateOrBlank(page.pageDate);
    if (!date) return [];
    return calendarEventsForDate(date).filter(event =>
      columnId === "daily-todo"
        ? event.column === "daily-todo" || !event.column
        : event.column === columnId
    );
  }

  // 각 일정이 놓일 칸 안 줄 좌표를 계산한다. 손으로 쓴 기록(page.elements)이
  // 이미 그 줄을 차지하고 있으면 다음 빈 줄로 내려 겹치지 않게 한다.
  // nextMobileWriteSlot()이 새 기록을 놓을 때도 같은 결과를 참조해 일정이
  // 차지한 줄을 건너뛴다.
  function columnEventRects(page, target, events) {
    if (!target || !events.length) return [];
    const x = snapToGrid(target.x, 0, PAGE_W - GRID_SIZE);
    const width = Math.min(snapSizeToGrid(target.width), PAGE_W - x);
    const yStart = snapToGrid(target.yStart, 0, PAGE_H - GRID_SIZE);
    const rowGap = snapSizeToGrid(target.rowGap);
    const height = GRID_SIZE;
    const existing = (page.elements || []).filter(element => element.type === "text");
    const overlapsExisting = candidate => existing.some(element => rectsOverlap(candidate, {
      x: Number(element.x) || 0,
      y: Number(element.y) || 0,
      width: Number(element.width) || 0,
      height: Number(element.height) || 0,
    }));
    const rects = [];
    let row = 0;
    events.forEach(event => {
      while (row < target.maxRows) {
        const candidate = { x, y: yStart + row * rowGap, width, height };
        row += 1;
        if (!overlapsExisting(candidate)) {
          rects.push({ event, fontSize: target.fontSize, ...candidate });
          break;
        }
      }
    });
    return rects;
  }

  function dailyColumnEventRects(page, columnId) {
    return columnEventRects(
      page,
      DAILY_COLUMN_TARGETS[columnId],
      dailyColumnCalendarEvents(page, columnId)
    );
  }

  // 칸 안 한 줄짜리 ○ 일정 버튼. 일간·주간이 같은 모양을 쓴다.
  function calendarEventRowHtml(rect, dateValue) {
    return `<button type="button" class="calendar-event-row-chip" data-calendar-date="${dateValue}" ` +
      `style="left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;font-size:${rect.fontSize}px">` +
      `${escapeHtml(calendarEventText(rect.event))}</button>`;
  }

  // 주간 페이지는 칸마다 날짜가 다르므로 날짜로만 나누면 된다.
  function weeklyColumnEventRects(page, offset) {
    if (page?.continuationOf) return [];
    const weekStart = normalizedWeekStart(page?.weekStart);
    if (!weekStart) return [];
    const date = isoDate(offsetDate(dateFromIso(weekStart), offset));
    return columnEventRects(page, weeklyColumnTarget(page, offset), calendarEventsForDate(date));
  }

  function calendarDateForPageElement(page, element) {
    const explicit = normalizedDateOrBlank(element?.calendarDate);
    if (explicit) return explicit;
    if (page?.type === "daily") return normalizedDateOrBlank(page.pageDate);
    if (isWeeklyPage(page)) {
      const weekStart = normalizedWeekStart(page.weekStart);
      if (!weekStart) return "";
      const targetOffset = String(element?.layoutTarget || "").match(/^weekly-day-(\d)$/u);
      let offset = targetOffset ? Number(targetOffset[1]) : null;
      if (offset === null) {
        const minY = page.type === "weekly-left" ? 300 : 140;
        if ((Number(element?.y) || 0) < minY) return "";
        const offsets = page.type === "weekly-left" ? [0, 1, 2, 3] : [4, 5, 6];
        const centerX = (Number(element?.x) || 0) + (Number(element?.width) || 0) / 2;
        offset = offsets[clamp(Math.floor(centerX / (PAGE_W / offsets.length)), 0, offsets.length - 1)];
      }
      return isoDate(offsetDate(dateFromIso(weekStart), offset));
    }
    if (page?.type === "monthly") {
      const { year, month, hasCalendarDate } = monthlyDateContext(page);
      if (!hasCalendarDate) return "";
      const centerX = (Number(element?.x) || 0) + (Number(element?.width) || 0) / 2;
      if (centerX > 420) return "";
      const day = Math.round(((Number(element?.y) || 164) - 164) / 32) + 1;
      if (day < 1 || day > new Date(year, month, 0).getDate()) return "";
      return isoDate(new Date(year, month - 1, day));
    }
    return "";
  }

  // 자유 편집에서 날짜 칸에 ○ 이벤트를 적은 경우에도 구조화된 일정으로 승격한다.
  // 날짜를 확정할 수 없는 빈 페이지의 ○는 일반 텍스트로 그대로 둔다.
  function captureCalendarEventElement(page, element) {
    if (!page || !element || element.type !== "text") return false;
    const text = String(element.text || "").trim();
    if (!/^○(?:\s+|$)/u.test(text)) return false;
    const title = text.replace(/^○\s*/u, "").trim();
    const date = calendarDateForPageElement(page, element);
    if (!title || !date) return false;
    // ○ 일정은 일간 페이지에서 항상 '할 일' 칸에 정리한다.
    const column = page.type === "daily" ? "daily-todo" : undefined;
    addCalendarEvent(date, title, column);
    page.elements = page.elements.filter(candidate => candidate.id !== element.id);
    selection = null;
    return true;
  }

  function calendarEventSummary(dateValue, maxLength = 38) {
    // 월간 요약 한 줄에는 그날의 ○ 일정과, 일간·주간에 자동으로 채워지는
    // 반복 미션도 함께 보여준다 — 월간 페이지에는 따로 쓸 칸이 없으므로
    // 미션은 여기서 요약으로만 보이고, 실제 상태 변경은 일간·주간의
    // 불렛에서 한다.
    const calendarEvents = calendarEventsForDate(dateValue);
    const events = calendarEvents.map(event => calendarEventText(event));
    const representedMissionIds = new Set(
      calendarEvents.map(event => String(event?.missionId || "")).filter(Boolean)
    );
    const date = normalizedDateOrBlank(dateValue);
    const missions = date ? missionsDueOn(dateFromIso(date))
      .filter(mission => !representedMissionIds.has(String(mission.id)))
      .map(mission => missionBulletText(mission)) : [];
    const items = [...events, ...missions];
    if (!items.length) return "";
    const text = items.join(" · ");
    return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
  }

  const CALENDAR_EVENT_STATUS_LABELS = {
    migrated: "› 이월", scheduled: "‹ 예정", completed: "× 완료",
  };

  function appendCalendarEventEditorRow(event = null) {
    const row = document.createElement("div");
    row.className = "calendar-event-row";
    if (event?.id) row.dataset.eventId = event.id;
    if (event?.missionId) row.dataset.missionId = event.missionId;
    row.dataset.status = ["migrated", "scheduled", "completed"].includes(event?.status)
      ? event.status : "open";

    const main = document.createElement("div");
    main.className = "calendar-event-row-main";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 240;
    input.placeholder = "일정 내용을 입력하세요";
    input.value = event?.title || "";
    input.setAttribute("aria-label", "일정 내용");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button danger-icon-button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", event?.missionId ? "이 반복 루틴 전체 삭제" : "이 일정 삭제");
    remove.addEventListener("click", () => row.remove());
    main.append(input, remove);

    // 다른 계획(•)과 같은 방식으로 이월·예정·완료 상태를 붙였다 뗄 수 있다.
    // 같은 버튼을 다시 누르면 기본 상태(열림)로 돌아간다.
    const statusRow = document.createElement("div");
    statusRow.className = "calendar-event-row-status";
    const updateStatusButtons = () => {
      $$("button", statusRow).forEach(button => {
        button.classList.toggle("active", button.dataset.status === row.dataset.status);
      });
    };
    Object.entries(CALENDAR_EVENT_STATUS_LABELS).forEach(([status, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.status = status;
      button.textContent = label;
      button.addEventListener("click", () => {
        row.dataset.status = row.dataset.status === status ? "open" : status;
        updateStatusButtons();
      });
      statusRow.append(button);
    });
    updateStatusButtons();

    row.append(main);
    if (event?.missionId) {
      const routineNote = document.createElement("small");
      routineNote.className = "calendar-event-routine-note";
      routineNote.textContent = "반복 루틴 · ×로 지우면 이 날짜부터 반복을 종료합니다";
      row.append(routineNote);
    }
    row.append(statusRow);
    refs.calendarEventRows.append(row);
    return input;
  }

  function openCalendarEventEditor(dateValue) {
    const date = normalizedDateOrBlank(dateValue);
    if (!date) return;
    editingCalendarDate = date;
    const parsed = dateFromIso(date);
    refs.calendarEventTitle.textContent = `${dailyDateLabel(parsed)} 일정`;
    refs.calendarEventRows.innerHTML = "";
    const events = calendarEventsForDate(date);
    events.forEach(event => appendCalendarEventEditorRow(event));
    if (!events.length) appendCalendarEventEditorRow();
    if (!refs.calendarEventDialog.open) refs.calendarEventDialog.showModal();
    requestAnimationFrame(() => $("input", refs.calendarEventRows)?.focus());
  }

  function closeCalendarEventEditor() {
    editingCalendarDate = "";
    if (refs.calendarEventDialog.open) refs.calendarEventDialog.close();
  }

  function saveCalendarEventEditor() {
    const date = normalizedDateOrBlank(editingCalendarDate);
    if (!date) return closeCalendarEventEditor();
    const before = JSON.stringify({
      calendarEvents: book.calendarEvents || [],
      missions: currentGoalSystem().missions || [],
    });
    const existing = new Map(calendarEventsForDate(date).map(event => [event.id, event]));
    const keptIds = new Set();
    const now = new Date().toISOString();
    $$(".calendar-event-row", refs.calendarEventRows).forEach(row => {
      const title = $("input", row)?.value.replace(/\s+/g, " ").trim().slice(0, 240) || "";
      if (!title) return;
      const id = row.dataset.eventId || "";
      const status = ["migrated", "scheduled", "completed"].includes(row.dataset.status)
        ? row.dataset.status
        : undefined;
      const event = existing.get(id);
      if (event) {
        keptIds.add(event.id);
        if (event.title !== title || event.status !== status) {
          event.title = title;
          if (status) event.status = status;
          else delete event.status;
          event.updatedAt = now;
        }
        const mission = event.missionId ? missionById(event.missionId) : null;
        if (mission && mission.title !== title) {
          mission.title = title;
          (book.calendarEvents || []).forEach(candidate => {
            if (candidate.missionId !== mission.id) return;
            candidate.title = title;
            candidate.updatedAt = now;
          });
        }
      } else {
        const added = addCalendarEvent(date, title, undefined, status);
        if (added) keptIds.add(added.id);
      }
    });
    const keptMissionIds = new Set(
      [...existing.values()]
        .filter(event => event.missionId && keptIds.has(event.id))
        .map(event => event.missionId)
    );
    const removedMissionIds = new Set(
      [...existing.values()]
        .filter(event => event.missionId && !keptIds.has(event.id) && !keptMissionIds.has(event.missionId))
        .map(event => event.missionId)
    );
    book.calendarEvents = (book.calendarEvents || []).filter(event =>
      event.date !== date || keptIds.has(event.id)
    );
    // 지난 수행 기록은 보존하고, 선택한 날짜부터 생성된 반복 일정만 정리한다.
    const removedRoutineCount = removeMissionsFromDate(book, removedMissionIds, date);
    closeCalendarEventEditor();
    const after = JSON.stringify({
      calendarEvents: book.calendarEvents || [],
      missions: currentGoalSystem().missions || [],
    });
    if (before !== after) commitHistory();
    renderAll();
    showToast(removedRoutineCount
      ? `날짜 일정과 반복 루틴 ${removedRoutineCount}개를 함께 정리했습니다`
      : "날짜 일정을 연간·월간·주간·일간에 반영했습니다");
  }

  function movePagesToStructuredGroup(pages, group) {
    const ids = new Set(pages.filter(Boolean).map(page => page.id));
    pages.forEach(page => {
      if (page?.type !== "cover") page.groupId = group?.id || null;
    });
    pruneEmptyCalendarGroups();
    const focusedId = activePageId || pages[0]?.id;
    book.pages = normalizeGroupPageOrder(book.pages, book.groups);
    currentIndex = Math.max(0, book.pages.findIndex(page => page.id === focusedId));
    activePageId = book.pages[currentIndex]?.id || [...ids][0] || null;
  }

  function pruneEmptyCalendarGroups() {
    let removed = true;
    while (removed) {
      removed = false;
      const removable = new Set(book.groups
        .filter(group => ["year", "month", "week"].includes(group.kind))
        .filter(group => !book.pages.some(page => page.groupId === group.id))
        .filter(group => !book.groups.some(candidate => candidate.parentId === group.id))
        .map(group => group.id));
      if (!removable.size) break;
      book.groups = book.groups.filter(group => !removable.has(group.id));
      removable.forEach(groupId => collapsedGroups.delete(groupId));
      removed = true;
    }
  }

  function setYearCalendarYear(page, yearValue) {
    const year = Number(yearValue);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) return false;
    const pair = page.calendarPairId
      ? book.pages.filter(candidate => candidate.calendarPairId === page.calendarPairId)
      : [page];
    const duplicate = book.pages.find(candidate =>
      !pair.some(item => item.id === candidate.id) &&
      (isYearCalendarTemplate(candidate.planTemplate)) && Number(candidate.year) === year
    );
    if (duplicate) {
      showToast(`${year}년 연간 달력이 이미 있습니다`);
      navigateToBookPage(duplicate);
      return false;
    }
    const group = yearGroupForYear(year);
    pair.forEach(candidate => {
      candidate.year = year;
      if (candidate.titleCustomized !== true) {
        candidate.title =
          `${year}년 연간 계획 · ${yearCalendarRangeLabel(yearCalendarMonths(candidate))}`;
      }
    });
    movePagesToStructuredGroup(pair, group);
    return true;
  }

  function setMonthlyPageDate(page, yearValue, monthValue) {
    const year = Number(yearValue);
    const month = Number(monthValue);
    if (!Number.isInteger(year) || year < 1900 || year > 2200 ||
        !Number.isInteger(month) || month < 1 || month > 12) return false;
    const duplicate = book.pages.find(candidate => candidate.id !== page.id &&
      candidate.type === "monthly" && (() => {
        const context = monthlyDateContext(candidate);
        return context.hasCalendarDate && context.year === year && context.month === month;
      })());
    if (duplicate) {
      showToast(`${year}년 ${month}월 월간 계획이 이미 있습니다`);
      navigateToBookPage(duplicate);
      return false;
    }
    page.year = year;
    page.month = month;
    if (page.titleCustomized !== true) page.title = "";
    movePagesToStructuredGroup([page], monthGroupForYearMonth(year, month));
    return true;
  }

  function setWeeklyPageDate(page, value) {
    const parsed = normalizedDateOrBlank(value);
    if (!parsed) return false;
    const monday = mondayOf(dateFromIso(parsed));
    const weekStart = isoDate(monday);
    const pair = weeklyPairPages(page);
    const duplicate = book.pages.find(candidate =>
      isWeeklyPage(candidate) && !pair.some(item => item.id === candidate.id) &&
      normalizedWeekStart(candidate.weekStart) === weekStart
    );
    if (duplicate) {
      showToast(`${dailyDateLabel(monday)} 시작 주간 계획이 이미 있습니다`);
      navigateToBookPage(duplicate);
      return false;
    }
    const number = weekNumberForMonday(monday);
    pair.forEach(candidate => {
      candidate.weekStart = weekStart;
      candidate.weekNumber = String(number);
      if (candidate.titleCustomized !== true) candidate.title = weeklyPageTitle(candidate, number);
    });
    movePagesToStructuredGroup(pair, weekGroupForDate(monday));
    return true;
  }

  function setDailyPageDate(page, value) {
    const dateValue = normalizedDateOrBlank(value);
    if (!dateValue) return false;
    const duplicate = book.pages.find(candidate =>
      candidate.id !== page.id && candidate.type === "daily" && candidate.pageDate === dateValue
    );
    if (duplicate) {
      showToast(`${dailyDateLabel(dateFromIso(dateValue))} 일간 계획이 이미 있습니다`);
      navigateToBookPage(duplicate);
      return false;
    }
    page.pageDate = dateValue;
    if (page.titleCustomized !== true) page.title = "";
    movePagesToStructuredGroup([page], weekGroupForDate(dateFromIso(dateValue)));
    return true;
  }

  function editStructuredPageDate(page, action) {
    let changed = false;
    if (action === "year-calendar") {
      const value = prompt("연간 달력의 연도를 입력하세요", String(page.year || new Date().getFullYear()));
      if (value !== null) changed = setYearCalendarYear(page, value.trim());
    } else if (action === "monthly") {
      const context = monthlyDateContext(page);
      const initial = context.hasCalendarDate
        ? `${context.year}-${String(context.month).padStart(2, "0")}`
        : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      const value = prompt("월간 계획의 연도와 월을 YYYY-MM으로 입력하세요", initial);
      const match = value?.trim().match(/^(\d{4})-(\d{1,2})$/u);
      if (value !== null && !match) showToast("예: 2026-08 형식으로 입력해 주세요");
      else if (match) changed = setMonthlyPageDate(page, Number(match[1]), Number(match[2]));
    } else if (action === "weekly") {
      const value = prompt(
        "이 주에 포함된 날짜를 YYYY-MM-DD로 입력하세요. 월요일로 자동 맞춥니다.",
        normalizedWeekStart(page.weekStart) || isoDate(new Date())
      );
      if (value !== null) changed = setWeeklyPageDate(page, value.trim());
      if (value !== null && !changed && !normalizedDateOrBlank(value.trim())) {
        showToast("예: 2026-08-03 형식으로 입력해 주세요");
      }
    } else if (action === "daily") {
      const value = prompt("일간 계획 날짜를 YYYY-MM-DD로 입력하세요", page.pageDate || isoDate(new Date()));
      if (value !== null) changed = setDailyPageDate(page, value.trim());
      if (value !== null && !changed && !normalizedDateOrBlank(value.trim())) {
        showToast("예: 2026-08-03 형식으로 입력해 주세요");
      }
    }
    if (!changed) return;
    commitHistory();
    renderAll();
    showToast("날짜와 페이지 그룹을 함께 갱신했습니다");
  }

  // 다른 손글씨 불렛은 길게 눌러 상태 메뉴를 연다. ○ 일정 칸은 원래
  // 탭 한 번으로 그날 일정 편집창(이월·예정·완료 버튼 포함)이 열리지만,
  // 길게 눌러도 같은 편집창이 열리도록 맞춰 손에 익은 동작을 그대로 쓸 수
  // 있게 한다. 짧게 탭하면 기존 click 리스너가 그대로 처리한다.
  function wireCalendarDateLongPress(node, dateValue) {
    if (!isAndroidApp) return;
    let timer = null;
    let longPressed = false;
    let startX = 0;
    let startY = 0;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
    };
    node.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse") return;
      longPressed = false;
      startX = event.clientX;
      startY = event.clientY;
      cancel();
      timer = window.setTimeout(() => {
        timer = null;
        longPressed = true;
        navigator.vibrate?.(28);
        openCalendarEventEditor(dateValue);
      }, 460);
    });
    node.addEventListener("pointermove", event => {
      if (!timer) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 8) cancel();
    });
    node.addEventListener("pointerup", event => {
      if (longPressed) {
        event.preventDefault();
        event.stopPropagation();
      }
      cancel();
    });
    node.addEventListener("pointercancel", cancel);
    node.addEventListener("pointerleave", cancel);
  }

  function wireCalendarTemplateControls(page, template, options = {}) {
    if (options.print) return;
    $$('[data-calendar-date]', template).forEach(node => {
      node.addEventListener("pointerdown", event => event.stopPropagation());
      node.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openCalendarEventEditor(node.dataset.calendarDate);
      });
      wireCalendarDateLongPress(node, node.dataset.calendarDate);
    });
    $$('[data-date-edit]', template).forEach(node => {
      node.addEventListener("pointerdown", event => event.stopPropagation());
      node.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        editStructuredPageDate(page, node.dataset.dateEdit);
      });
    });
  }

  function normalizedWeekNumber(value) {
    return String(value || "").replace(/\s*주차\s*$/u, "").trim();
  }

  function weeklyPageTitle(page, value = page?.weekNumber) {
    const number = normalizedWeekNumber(value);
    const title = number
      ? `${number}주차 주간 계획 (${page?.type === "weekly-right" ? "금-일" : "월-목"})`
      : page?.type === "weekly-right"
        ? "주간 계획 · 금–일"
        : "주간 계획 · 월–목";
    return continuedPageLabel(page, title);
  }

  function normalizedWeekStart(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const parsed = dateFromIso(text);
    return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === text ? text : null;
  }

  function weeklyPairPages(page) {
    if (!page?.weeklyPairId) return page ? [page] : [];
    const pair = book.pages.filter(candidate =>
      candidate.weeklyPairId === page.weeklyPairId &&
      (candidate.type === "weekly-left" || candidate.type === "weekly-right")
    );
    return pair.length ? pair : [page];
  }

  function weeklyDateLinkedPages(page) {
    const root = page?.continuationOf
      ? book.pages.find(candidate => candidate.id === page.continuationOf) || page
      : page;
    const pair = weeklyPairPages(root);
    const rootIds = new Set(pair.map(candidate => candidate.id));
    return [...new Map([
      ...pair,
      ...book.pages.filter(candidate => rootIds.has(candidate.continuationOf)),
    ].map(candidate => [candidate.id, candidate])).values()];
  }

  function setWeeklyNumberForPair(page, value) {
    const number = normalizedWeekNumber(value);
    weeklyDateLinkedPages(page).forEach(candidate => {
      candidate.weekNumber = number;
      if (candidate.titleCustomized !== true) {
        candidate.title = weeklyPageTitle(candidate, number);
        delete candidate.templateText?.[pageTitleTemplateField(candidate)];
      }
    });
    return number;
  }

  function setWeeklyStartForPair(page, value) {
    const weekStart = normalizedWeekStart(value);
    weeklyDateLinkedPages(page).forEach(candidate => {
      candidate.weekStart = weekStart;
      candidate.templateText ||= {};
      // 시작 날짜를 바꾸면 손으로 고친 요일 표시는 새 날짜로 되돌린다.
      const offsets = candidate.type === "weekly-left" ? [0, 1, 2, 3] : [4, 5, 6];
      offsets.forEach(offset => delete candidate.templateText[`x.weekly-day-${offset}`]);
    });
    return weekStart || "";
  }

  function currentGoalSystem() {
    book.goalSystem ||= createEmptyGoalSystem();
    return book.goalSystem;
  }

  function lifeAreaById(id) {
    return currentGoalSystem().areas.find(area => area.id === id) || null;
  }

  function outcomeGoalById(id) {
    return currentGoalSystem().goals.find(goal => goal.id === id) || null;
  }

  function missionById(id) {
    return currentGoalSystem().missions.find(mission => mission.id === id) || null;
  }

  function goalForMission(mission) {
    return mission ? outcomeGoalById(mission.goalId) : null;
  }

  function areaForGoal(goal) {
    return goal ? lifeAreaById(goal.areaId) : null;
  }

  function weekRangeFor(date) {
    const start = mondayOf(date);
    const end = offsetDate(start, 6);
    return { start: isoDate(start), end: isoDate(end) };
  }

  function isDateInRange(value, start, end) {
    return Boolean(value) && value >= start && value <= end;
  }

  function completedMissionElements(missionId, startDate = "", endDate = "") {
    const records = [];
    const seenDates = new Set();
    book.pages.forEach(page => {
      page.elements.forEach(element => {
        if (element.type !== "text" || element.missionId !== missionId) return;
        const date = element.missionDate || page.pageDate || "";
        if (startDate && !isDateInRange(date, startDate, endDate)) return;
        if (bulletMeta(element.text).status !== "completed") return;
        const completionKey = date || element.id;
        if (seenDates.has(completionKey)) return;
        seenDates.add(completionKey);
        records.push({ page, element, date });
      });
    });
    return records;
  }

  function missionCompletionCount(missionId, startDate = "", endDate = "") {
    return completedMissionElements(missionId, startDate, endDate).length;
  }

  // pageId를 주면 그 페이지 안에서만 이미 받았는지 확인한다. 일간·주간 페이지가
  // 같은 날짜의 같은 미션을 각자 독립적으로 받을 수 있어야(연동) 하므로, 전체
  // 문서를 뒤지는 전역 검사로는 한쪽에 이미 있으면 다른 쪽에 못 들어간다.
  // ○ 루틴은 페이지 안 텍스트가 아니라 공유 일정으로 만든다. 텍스트로 두면
  // migrateLegacyCircleTextToEvents()가 정규화 때마다 일정으로 승격시키면서
  // 원본 요소를 지우고, 그러면 "이미 받았는지" 검사가 매번 실패해 같은 루틴이
  // 무한히 쌓인다(0.32.0까지 실제로 발생). id를 미션·날짜로 고정해 두면
  // 일간·주간이 각각 호출해도, PC와 폰이 각각 만들어도 하나로 합쳐진다.
  const missionEventId = (missionId, dateValue) => `mission-event-${missionId}-${dateValue}`;

  function missionExistsOnDate(missionId, dateValue, pageId = null) {
    const eventId = missionEventId(missionId, dateValue);
    if ((book.calendarEvents || []).some(event => event.id === eventId)) return true;
    return book.pages.some(page => {
      if (pageId && page.id !== pageId) return false;
      return page.elements.some(element =>
        element.type === "text" && element.missionId === missionId &&
        (element.missionDate || page.pageDate || "") === dateValue
      );
    });
  }

  // ○ 루틴 하나를 그 날짜의 공유 일정으로 확정한다. 이미 있으면 아무것도 안 한다.
  function ensureMissionCalendarEvent(mission, dateValue, column) {
    const date = normalizedDateOrBlank(dateValue);
    const title = String(mission?.title || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!date || !title) return false;
    const id = missionEventId(mission.id, date);
    book.calendarEvents ||= [];
    if (book.calendarEvents.some(event => event.id === id)) return false;
    const now = new Date().toISOString();
    const event = { id, date, title, createdAt: now, updatedAt: now, missionId: mission.id };
    if (column === "daily-todo" || column === "daily-log") event.column = column;
    book.calendarEvents.push(event);
    return true;
  }

  function missionRunsOnDate(mission, date) {
    const goal = goalForMission(mission);
    if (!mission?.active || !goal || goal.status !== "active") return false;
    const day = date.getDay();
    const dateValue = isoDate(date);
    const startDate = normalizedDateOrBlank(mission.startDate);
    if (startDate && dateValue < startDate) return false;
    if (mission.schedule === "once") return mission.scheduledDate === dateValue;
    if (mission.schedule === "weekdays") return day >= 1 && day <= 5;
    if (mission.schedule === "weekend") return day === 0 || day === 6;
    if (mission.schedule === "custom") return mission.weekdays.includes(day);
    if (mission.schedule === "weekly") {
      const { start, end } = weekRangeFor(date);
      return missionCompletionCount(mission.id, start, end) < mission.weeklyTarget;
    }
    if (mission.schedule === "monthly-date") {
      return date.getDate() === mission.monthDay;
    }
    if (mission.schedule === "monthly-last") {
      return offsetDate(date, 1).getMonth() !== date.getMonth();
    }
    if (mission.schedule === "yearly-date") {
      return date.getMonth() + 1 === mission.yearMonth && date.getDate() === mission.yearDay;
    }
    if (mission.schedule === "interval") {
      const start = normalizedDateOrBlank(mission.intervalStart);
      if (!start || dateValue < start) return false;
      const startDate = dateFromIso(start);
      const cleanDate = dateFromIso(dateValue);
      const count = Math.max(1, Number(mission.intervalCount) || 1);
      const diffDays = Math.round((cleanDate - startDate) / 86400000);
      if (mission.intervalUnit === "week") {
        return diffDays % 7 === 0 && (diffDays / 7) % count === 0;
      }
      if (mission.intervalUnit === "month") {
        if (cleanDate.getDate() !== startDate.getDate()) return false;
        const monthsDiff = (cleanDate.getFullYear() - startDate.getFullYear()) * 12 +
          (cleanDate.getMonth() - startDate.getMonth());
        return monthsDiff % count === 0;
      }
      if (mission.intervalUnit === "year") {
        if (cleanDate.getDate() !== startDate.getDate() || cleanDate.getMonth() !== startDate.getMonth()) {
          return false;
        }
        return (cleanDate.getFullYear() - startDate.getFullYear()) % count === 0;
      }
      return diffDays % count === 0;
    }
    return true;
  }

  function missionsDueOn(date) {
    const seen = new Set();
    return currentGoalSystem().missions.filter(mission => {
      if (!missionRunsOnDate(mission, date)) return false;
      const signature = missionDuplicateSignature(mission);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
  }

  function missionBulletText(mission) {
    const symbol = BULLET_SYMBOLS[mission.bulletBase]?.open || BULLET_SYMBOLS.dot.open;
    return `${symbol} ${mission.title}`;
  }

  function missionScheduleLabel(mission) {
    if (!mission) return "";
    if (mission.schedule === "daily") return "매일";
    if (mission.schedule === "weekly") return `주 ${mission.weeklyTarget}회`;
    if (mission.schedule === "weekdays") return "평일";
    if (mission.schedule === "weekend") return "주말";
    if (mission.schedule === "once") return mission.scheduledDate || "날짜 미정";
    if (mission.schedule === "monthly-date") return `매월 ${mission.monthDay}일`;
    if (mission.schedule === "monthly-last") return "매월 마지막 날";
    if (mission.schedule === "yearly-date") return `매년 ${mission.yearMonth}월 ${mission.yearDay}일`;
    if (mission.schedule === "interval") {
      const unitLabel = { day: "일", week: "주", month: "개월", year: "년" }[mission.intervalUnit] || "일";
      return `${mission.intervalCount}${unitLabel}마다`;
    }
    const labels = ["일", "월", "화", "수", "목", "금", "토"];
    return mission.weekdays.map(day => labels[day]).join("·") || "요일 미정";
  }

  function missionWeeklyExpectation(mission, range) {
    if (!mission?.active) return 0;
    if (mission.schedule === "weekly") return mission.weeklyTarget;
    if (mission.schedule === "daily") return 7;
    if (mission.schedule === "weekdays") return 5;
    if (mission.schedule === "weekend") return 2;
    if (mission.schedule === "custom") return mission.weekdays.length;
    if (mission.schedule === "once") {
      return isDateInRange(mission.scheduledDate, range.start, range.end) ? 1 : 0;
    }
    // 달마다·해마다·자유 간격은 요일처럼 딱 떨어지지 않으므로, 이번 주 7일을
    // 하나씩 실제로 검사해 며칠에 해당하는지 센다.
    if (["monthly-date", "monthly-last", "yearly-date", "interval"].includes(mission.schedule)) {
      let count = 0;
      let cursor = dateFromIso(range.start);
      const end = dateFromIso(range.end);
      while (cursor <= end) {
        if (missionRunsOnDate(mission, cursor)) count += 1;
        cursor = offsetDate(cursor, 1);
      }
      return count;
    }
    return 0;
  }

  function goalProgressData(goal, date = new Date()) {
    if (!goal) return { percent: 0, label: "목표 정보 없음" };
    if (goal.status === "completed") return { percent: 100, label: "달성 완료" };
    const hasMetric = [goal.startValue, goal.currentValue, goal.targetValue]
      .every(value => Number.isFinite(value)) && goal.startValue !== goal.targetValue;
    if (hasMetric) {
      const percent = clamp(
        ((goal.currentValue - goal.startValue) / (goal.targetValue - goal.startValue)) * 100,
        0,
        100
      );
      const metric = goal.metricName ? `${goal.metricName} ` : "";
      const unit = goal.unit || "";
      return {
        percent,
        label: `${metric}${goal.currentValue}${unit} / ${goal.targetValue}${unit}`,
      };
    }
    const range = weekRangeFor(date);
    const missions = currentGoalSystem().missions.filter(mission => mission.goalId === goal.id);
    const target = missions.reduce((sum, mission) =>
      sum + missionWeeklyExpectation(mission, range), 0);
    const completed = missions.reduce((sum, mission) =>
      sum + missionCompletionCount(mission.id, range.start, range.end), 0);
    return {
      percent: target ? clamp(completed / target * 100, 0, 100) : 0,
      label: target ? `이번 주 미션 ${completed}/${target}` : "연결된 반복 미션 없음",
    };
  }

  function ensureDailyPage(date) {
    const pageDate = isoDate(date);
    let index = book.pages.findIndex(page =>
      page.type === "daily" && page.pageDate === pageDate && !page.continuationOf
    );
    if (index >= 0) return { page: book.pages[index], index, created: false };
    ensureWeeklyPagePair(date);
    const group = weekGroupForDate(date);
    const page = makePage("daily", "", {
      id: `calendar-day-${pageDate}`,
      pageDate,
      groupId: group.id,
    });
    index = insertIndexForGroup(group.id, currentIndex + 1);
    book.pages.splice(index, 0, page);
    return { page, index, created: true };
  }

  function receiveMissionsForDate(date, page) {
    const target = mobileWriteTargetsForPage(page)
      .find(item => item.id === "daily-todo");
    const dateValue = isoDate(date);
    const due = missionsDueOn(date);
    let added = 0;
    let skipped = 0;
    due.forEach(mission => {
      if (missionExistsOnDate(mission.id, dateValue, page.id)) return;
      if (mission.bulletBase === "circle") {
        if (ensureMissionCalendarEvent(mission, dateValue, "daily-todo")) added += 1;
        return;
      }
      const goal = goalForMission(mission);
      const area = areaForGoal(goal);
      const text = missionBulletText(mission);
      const slot = nextMobileWriteSlot(page, target, text);
      if (!slot) {
        skipped += 1;
        return;
      }
      page.elements.push(makeText(slot.x, slot.y, text, {
        width: slot.width,
        height: slot.height,
        fontSize: target.fontSize,
        color: target.color,
        gridLocked: true,
        layoutTarget: target.id,
        missionId: mission.id,
        goalId: goal?.id,
        areaId: area?.id,
        missionDate: dateValue,
      }));
      added += 1;
    });
    return { due: due.length, added, skipped };
  }

  // 그 주의 요일 칸에 미션을 채운다. receiveMissionsForDate와 같은 방식이지만
  // 페이지 하나가 아니라 그 주 월~일 7일을 훑어 각 요일 칸에 나눠 넣는다.
  // 일간 페이지에 이미 받은 미션도 페이지별로 따로 확인하므로 함께 표시된다.
  function receiveMissionsForWeek(weekStartValue) {
    const weekStart = normalizedWeekStart(weekStartValue);
    if (!weekStart) return { due: 0, added: 0, skipped: 0 };
    const anchor = book.pages.find(page =>
      isWeeklyPage(page) && !page.continuationOf && normalizedWeekStart(page.weekStart) === weekStart
    );
    if (!anchor) return { due: 0, added: 0, skipped: 0 };
    const pages = weeklyPairPages(anchor);
    let due = 0;
    let added = 0;
    let skipped = 0;
    pages.forEach(page => {
      const targets = mobileWriteTargetsForPage(page);
      for (let offset = 0; offset < 7; offset += 1) {
        const target = targets.find(item => item.id === `weekly-day-${offset}`);
        if (!target) continue;
        const date = offsetDate(dateFromIso(weekStart), offset);
        const dateValue = isoDate(date);
        const dueMissions = missionsDueOn(date);
        due += dueMissions.length;
        dueMissions.forEach(mission => {
          if (missionExistsOnDate(mission.id, dateValue, page.id)) return;
          if (mission.bulletBase === "circle") {
            if (ensureMissionCalendarEvent(mission, dateValue)) added += 1;
            return;
          }
          const goal = goalForMission(mission);
          const area = areaForGoal(goal);
          const text = missionBulletText(mission);
          const slot = nextMobileWriteSlot(page, target, text);
          if (!slot) {
            skipped += 1;
            return;
          }
          page.elements.push(makeText(slot.x, slot.y, text, {
            width: slot.width,
            height: slot.height,
            fontSize: target.fontSize,
            color: target.color,
            gridLocked: true,
            layoutTarget: target.id,
            missionId: mission.id,
            goalId: goal?.id,
            areaId: area?.id,
            missionDate: dateValue,
          }));
          added += 1;
        });
      }
    });
    return { due, added, skipped };
  }

  // '오늘' 버튼을 누르지 않아도, 이미 만들어진 daily·weekly 페이지에는 미리
  // 루틴을 채운다. 기본 범위는 '올해 12월 31일까지' — 예를 들어 2026년이면
  // 2026-12-31까지의 페이지에 미리 들어간다. 아직 없는 미래 페이지를 새로
  // 만들지는 않으므로(사용자가 그 날짜 페이지를 만들면 그때 함께 채워진다)
  // 범위를 넓혀도 페이지가 쌓이지 않는다.
  function materializeDueMissions(horizonEndValue = "") {
    const today = new Date();
    const todayValue = isoDate(today);
    const horizonEnd = normalizedDateOrBlank(horizonEndValue) ||
      isoDate(new Date(today.getFullYear(), 11, 31));
    let added = 0;
    book.pages.forEach(page => {
      if (page.type !== "daily" || page.continuationOf) return;
      const pageDate = normalizedDateOrBlank(page.pageDate);
      if (!pageDate || !isDateInRange(pageDate, todayValue, horizonEnd)) return;
      added += receiveMissionsForDate(dateFromIso(pageDate), page).added;
    });
    const weekStarts = new Set();
    book.pages.forEach(page => {
      if (!isWeeklyPage(page)) return;
      const weekStart = normalizedWeekStart(page.weekStart);
      if (!weekStart) return;
      const weekEnd = isoDate(offsetDate(dateFromIso(weekStart), 6));
      if (weekEnd < todayValue || weekStart > horizonEnd) return;
      weekStarts.add(weekStart);
    });
    weekStarts.forEach(weekStart => {
      added += receiveMissionsForWeek(weekStart).added;
    });
    return added;
  }

  function initializeHistory() {
    history = [JSON.stringify(book)];
    historyIndex = 0;
    updateUndoRedo();
  }

  function commitHistory() {
    const snapshot = JSON.stringify(book);
    if (history[historyIndex] === snapshot) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    if (history.length > 80) history.shift();
    historyIndex = history.length - 1;
    updateUndoRedo();
    markDirty();
  }

  function restoreHistory(index) {
    if (index < 0 || index >= history.length) return;
    historyIndex = index;
    book = normalizeBook(JSON.parse(history[historyIndex]));
    currentIndex = clamp(currentIndex, 0, book.pages.length - 1);
    selection = null;
    refs.bookTitle.value = book.title;
    renderAll();
    markDirty();
    updateUndoRedo();
  }

  function updateUndoRedo() {
    $("#undoButton").disabled = historyIndex <= 0;
    $("#redoButton").disabled = historyIndex >= history.length - 1;
  }

  function androidWindowWidthDp() {
    if (!isAndroidApp) return 0;
    try {
      return Math.max(0, Number(window.BulletBookNative?.getWindowWidthDp?.()) || 0);
    } catch {
      return 0;
    }
  }

  function updateViewModeControls() {
    $$(".view-switch button, .mobile-view-switch button").forEach(button => {
      const active = button.dataset.view === viewMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setViewMode(nextMode) {
    if (!["auto", "single", "spread"].includes(nextMode)) return;
    viewMode = nextMode;
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch { /* ignore */ }
    updateViewModeControls();
    lastSpreadState = null;
    pageZoom = 1;
    pagePanX = 0;
    pagePanY = 0;
    renderAll();
    if (isAndroidApp && refs.mobileMoreDialog.open) refs.mobileMoreDialog.close();
    showToast(viewMode === "auto"
      ? "자동 보기 · 접으면 1쪽, 펼치면 2쪽"
      : viewMode === "single" ? "1쪽 보기로 고정했습니다" : "2쪽 보기로 고정했습니다");
  }

  function isSpreadView() {
    if (viewMode === "single") return false;
    if (viewMode === "spread") return true;
    const browserWidth = Math.max(
      refs.viewport.clientWidth || 0,
      window.innerWidth || 0,
      window.visualViewport?.width || 0
    );
    if (isAndroidApp) {
      // 실제 Android 창 폭이 있으면 WebView/물리 픽셀값을 섞지 않는다.
      // 둘 중 큰 값을 사용하면 커버 화면에서도 2쪽으로 오인될 수 있다.
      const nativeWidth = androidWindowWidthDp();
      return (nativeWidth > 0 ? nativeWidth : browserWidth) >= ANDROID_SPREAD_MIN_WIDTH;
    }
    return (refs.viewport.clientWidth || 0) >= 1030;
  }

  function visibleIndexes() {
    if (!isSpreadView()) return [currentIndex];
    const left = currentIndex % 2 === 0 ? currentIndex : currentIndex - 1;
    return [left, left + 1].filter(index => index < book.pages.length);
  }

  function renderAll() {
    renderPageList();
    renderSpread();
    updateStatus();
    if (refs.goalHubDialog?.open) renderGoalHub();
  }

  function capturePageListScrollAnchor(element) {
    if (!element) return null;
    const listRect = refs.pageList.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    return {
      groupId: element.dataset.groupId || "",
      pageId: element.dataset.pageId || "",
      offset: elementRect.top - listRect.top,
      scrollTop: refs.pageList.scrollTop,
    };
  }

  function restorePageListScrollAnchor(anchor) {
    if (!anchor) return;
    const candidates = anchor.groupId
      ? $$(".page-group-header", refs.pageList)
      : $$(".page-item", refs.pageList);
    const element = candidates.find(item =>
      anchor.groupId
        ? item.dataset.groupId === anchor.groupId
        : item.dataset.pageId === anchor.pageId
    );
    if (!element) {
      refs.pageList.scrollTop = anchor.scrollTop;
      return;
    }
    const listRect = refs.pageList.getBoundingClientRect();
    const nextOffset = element.getBoundingClientRect().top - listRect.top;
    refs.pageList.scrollTop += nextOffset - anchor.offset;
  }

  function renderPageList(options = {}) {
    const validPageIds = new Set(book.pages
      .filter(page => page.type !== "cover")
      .map(page => page.id));
    [...selectedPageIds].forEach(pageId => {
      if (!validPageIds.has(pageId)) selectedPageIds.delete(pageId);
    });
    // 목록에 실제로 그려진 페이지만 선택 상태로 남긴다. 접힌 그룹 안의 페이지가
    // 체크된 채로 남으면 사용자가 보지도 해제하지도 못한 페이지가 삭제·복제·이동된다.
    const renderedPageIds = new Set();
    refs.pageList.innerHTML = "";
    const appendPage = (page, index, depth = 0) => {
      renderedPageIds.add(page.id);
      const item = document.createElement("div");
      item.className = [
        "page-item",
        depth > 0 ? "grouped" : "",
        visibleIndexes().includes(index) ? "active" : "",
        page.id === activePageId ? "current" : "",
        selectedPageIds.has(page.id) ? "multi-selected" : "",
      ].filter(Boolean).join(" ");
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.dataset.pageId = page.id;
      item.dataset.groupId = page.groupId || "";
      item.dataset.groupPath = groupPathForId(page.groupId).map(group => group.id).join(" ");
      item.style.setProperty("--group-indent", `${Math.max(0, depth - 1) * 12}px`);
      const displayTitle = pageDisplayTitle(page);
      item.innerHTML = `
        <input class="page-select-checkbox" type="checkbox"
          aria-label="${escapeHtml(displayTitle)} 페이지 선택"
          ${selectedPageIds.has(page.id) ? "checked" : ""}
          ${page.type === "cover" ? "disabled" : ""}>
        <span class="page-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="page-name">${escapeHtml(displayTitle)}</span>
        <span class="page-type">${escapeHtml(shortType(page.type, page.planTemplate))}</span>
        <button type="button" class="page-title-edit-button"
          aria-label="${escapeHtml(displayTitle)} 페이지 제목 변경"
          title="페이지 제목 변경">✎</button>`;
      const checkbox = $(".page-select-checkbox", item);
      const titleEditButton = $(".page-title-edit-button", item);
      checkbox.addEventListener("click", event => event.stopPropagation());
      checkbox.addEventListener("dblclick", event => event.stopPropagation());
      checkbox.addEventListener("change", event => {
        event.stopPropagation();
        if (checkbox.checked) selectedPageIds.add(page.id);
        else selectedPageIds.delete(page.id);
        item.classList.toggle("multi-selected", checkbox.checked);
        item.setAttribute("aria-checked", String(checkbox.checked));
        updateSelectedPageActions();
      });
      ["click", "dblclick", "pointerdown"].forEach(type =>
        titleEditButton.addEventListener(type, event => event.stopPropagation())
      );
      titleEditButton.addEventListener("click", () => editPageTitle(page));
      item.addEventListener("click", event => {
        if (item._suppressPageClick) {
          event.preventDefault();
          event.stopPropagation();
          item._suppressPageClick = false;
          return;
        }
        const now = Date.now();
        if (!isAndroidApp && event.target.closest(".page-name") &&
            lastPageTitleClick.pageId === page.id && now - lastPageTitleClick.at <= 340) {
          event.preventDefault();
          lastPageTitleClick = { pageId: "", at: 0 };
          editPageTitle(page);
          return;
        }
        lastPageTitleClick = event.target.closest(".page-name")
          ? { pageId: page.id, at: now }
          : { pageId: "", at: 0 };
        keyboardScope = "sidebar";
        currentIndex = index;
        activePageId = page.id;
        selection = null;
        renderAll();
        closeSidebar();
      });
      item.addEventListener("keydown", event => {
        if (event.target === checkbox || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        item.click();
      });
      wirePageListReorder(item, page);
      refs.pageList.append(item);
    };

    const groupCounts = new Map();
    book.pages.forEach(page => {
      groupPathForId(page.groupId).forEach(group =>
        groupCounts.set(group.id, (groupCounts.get(group.id) || 0) + 1)
      );
    });
    const renderedGroups = new Set();
    const appendGroupHeader = (group, depth = 0) => {
      const header = document.createElement("div");
      const collapsed = collapsedGroups.has(group.id);
      const path = groupPathForId(group.id);
      header.className = "page-group-header";
      header.dataset.groupId = group.id;
      header.dataset.groupPath = path.map(item => item.id).join(" ");
      header.style.setProperty("--group-indent", `${depth * 12}px`);
      header.title = "드래그해 순서를 바꾸거나 다른 그룹 제목·페이지에 놓아 하위 그룹으로 이동";
      header.innerHTML = `<button type="button" class="group-toggle" aria-expanded="${!collapsed}">
          <span class="group-chevron">${collapsed ? "›" : "⌄"}</span>
          <span class="group-name">${escapeHtml(group.name)}</span>
        </button>
        <span class="group-count">${groupCounts.get(group.id) || 0}</span>
        <button type="button" class="group-menu-button" aria-label="${escapeHtml(group.name)} 그룹 편집" title="그룹 이름 변경 또는 삭제">⋯</button>`;
      $(".group-toggle", header).addEventListener("click", event => {
        event.preventDefault();
        if (header._suppressGroupClick) {
          event.stopPropagation();
          header._suppressGroupClick = false;
          return;
        }
        const scrollAnchor = capturePageListScrollAnchor(header);
        if (collapsed) collapsedGroups.delete(group.id);
        else collapsedGroups.add(group.id);
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsedGroups]));
        renderPageList({ scrollAnchor });
      });
      $(".group-menu-button", header).addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openPageGroupEditor(group.id);
      });
      wirePageGroupReorder(header, group);
      refs.pageList.append(header);
      renderedGroups.add(group.id);
    };

    // 각 페이지의 상위→하위 그룹 경로를 펼쳐 실제 책 순서와 같은 계층 목록을 만든다.
    book.pages.forEach((page, index) => {
      const path = groupPathForId(page.groupId);
      let hidden = false;
      path.forEach((group, depth) => {
        if (hidden) return;
        if (!renderedGroups.has(group.id)) appendGroupHeader(group, depth);
        if (collapsedGroups.has(group.id)) hidden = true;
      });
      if (!hidden) appendPage(page, index, path.length);
    });
    // 페이지가 없는 그룹도 계층을 유지한 채 편집할 수 있도록 남긴다.
    const childrenByParent = new Map();
    book.groups.forEach(group => {
      const parentId = group.parentId || "";
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(group);
    });
    const appendMissingTree = (group, depth = 0) => {
      if (!renderedGroups.has(group.id)) appendGroupHeader(group, depth);
      if (collapsedGroups.has(group.id)) return;
      (childrenByParent.get(group.id) || []).forEach(child =>
        appendMissingTree(child, depth + 1)
      );
    };
    (childrenByParent.get("") || []).forEach(group => appendMissingTree(group));
    book.groups.filter(group => !renderedGroups.has(group.id))
      .forEach(group => appendMissingTree(group, groupPathForId(group.id).length - 1));
    [...selectedPageIds].forEach(pageId => {
      if (!renderedPageIds.has(pageId)) selectedPageIds.delete(pageId);
    });
    updateSelectedPageActions();
    renderPageGroupSelect();
    if (options.scrollAnchor) {
      restorePageListScrollAnchor(options.scrollAnchor);
    } else {
      const active = $(".page-item.active", refs.pageList);
      active?.scrollIntoView({ block: "nearest" });
    }
  }

  function clearPageListDropVisuals() {
    $$(".page-item.page-reorder-source, .page-item.group-drop-after, .page-item.page-drop-before, .page-item.page-drop-after, .page-item.group-nest-page-target",
      refs.pageList).forEach(item => {
        item.classList.remove(
          "page-reorder-source", "group-drop-after", "page-drop-before", "page-drop-after", "group-nest-page-target"
        );
      });
    $$(".page-group-header.page-group-drop-target, .page-group-header.group-nest-target, .page-group-header.group-reorder-source, .page-group-header.group-drop-before, .page-group-header.group-drop-after", refs.pageList)
      .forEach(item => item.classList.remove(
        "page-group-drop-target", "group-nest-target", "group-reorder-source", "group-drop-before", "group-drop-after"
      ));
    refs.pageList.classList.remove("reordering");
  }

  function pageListTargetAt(clientX, clientY) {
    const candidates = $$(".page-item, .page-group-header", refs.pageList);
    let target = document.elementFromPoint?.(clientX, clientY)
      ?.closest?.(".page-item, .page-group-header");
    if (target && refs.pageList.contains(target)) return target;
    target = candidates.find(item => {
      const rect = item.getBoundingClientRect();
      return clientY >= rect.top && clientY <= rect.bottom;
    });
    if (target || !candidates.length) return target || null;
    const firstRect = candidates[0].getBoundingClientRect();
    const lastRect = candidates.at(-1).getBoundingClientRect();
    if (clientY < firstRect.top) return candidates[0];
    if (clientY > lastRect.bottom) return candidates.at(-1);
    return null;
  }

  function orderedMovablePageIds(sourceIds) {
    const sourceSet = new Set(Array.isArray(sourceIds) ? sourceIds : [sourceIds]);
    const weeklyPairIds = new Set(book.pages
      .filter(page => sourceSet.has(page.id) && isWeeklyPage(page) && page.weeklyPairId)
      .map(page => page.weeklyPairId));
    const calendarPairIds = new Set(book.pages
      .filter(page => sourceSet.has(page.id) && page.calendarPairId)
      .map(page => page.calendarPairId));
    return book.pages
      .filter(page => page.type !== "cover" && (
        sourceSet.has(page.id) ||
        (isWeeklyPage(page) && weeklyPairIds.has(page.weeklyPairId)) ||
        (page.calendarPairId && calendarPairIds.has(page.calendarPairId))
      ))
      .map(page => page.id);
  }

  // 페이지·그룹을 끌어 옮길 때 목록 위/아래 가장자리에 닿으면 그 방향으로
  // 스크롤한다. 없으면 지금 화면에 보이는 범위 밖으로는 옮길 수가 없다.
  let pageListAutoScrollFrame = null;
  let pageListAutoScrollSpeed = 0;

  function stopPageListAutoScroll() {
    if (pageListAutoScrollFrame !== null) cancelAnimationFrame(pageListAutoScrollFrame);
    pageListAutoScrollFrame = null;
    pageListAutoScrollSpeed = 0;
  }

  function updatePageListAutoScroll(clientY) {
    const list = refs.pageList;
    if (!list) return;
    const rect = list.getBoundingClientRect();
    const zone = 72;
    let speed = 0;
    if (clientY < rect.top + zone) {
      speed = -Math.min(22, Math.ceil((rect.top + zone - clientY) / 3));
    } else if (clientY > rect.bottom - zone) {
      speed = Math.min(22, Math.ceil((clientY - (rect.bottom - zone)) / 3));
    }
    pageListAutoScrollSpeed = speed;
    if (!speed) return stopPageListAutoScroll();
    if (pageListAutoScrollFrame !== null) return;
    const step = () => {
      if (!pageListAutoScrollSpeed) return stopPageListAutoScroll();
      list.scrollTop += pageListAutoScrollSpeed;
      pageListAutoScrollFrame = requestAnimationFrame(step);
    };
    pageListAutoScrollFrame = requestAnimationFrame(step);
  }

  function pageDragIdsForSource(sourceId) {
    const selectedIds = selectedPageIds.has(sourceId)
      ? orderedMovablePageIds([...selectedPageIds])
      : [];
    return selectedIds.length ? selectedIds : orderedMovablePageIds([sourceId]);
  }

  function markPageDragSources(sourceIds) {
    const sourceSet = new Set(sourceIds);
    $$(".page-item", refs.pageList).forEach(item => {
      if (sourceSet.has(item.dataset.pageId)) item.classList.add("page-reorder-source");
    });
  }

  function pageListDropPosition(clientX, clientY, sourceIds) {
    const target = pageListTargetAt(clientX, clientY);
    if (!target) return null;
    const sourceSet = new Set(orderedMovablePageIds(sourceIds));

    $$(".page-item.page-drop-before, .page-item.page-drop-after", refs.pageList)
      .forEach(item => item.classList.remove("page-drop-before", "page-drop-after"));
    $$(".page-group-header.page-group-drop-target", refs.pageList)
      .forEach(item => item.classList.remove("page-group-drop-target"));

    if (target.classList.contains("page-group-header")) {
      const group = book.groups.find(item => item.id === target.dataset.groupId);
      if (!group) return null;
      target.classList.add("page-group-drop-target");
      return { groupId: group.id, atStart: true };
    }

    const targetPage = book.pages.find(page => page.id === target.dataset.pageId);
    if (!targetPage) return null;
    if (sourceSet.has(targetPage.id)) return null;
    const rect = target.getBoundingClientRect();
    let after = clientY >= rect.top + rect.height / 2;
    if (targetPage.type === "cover") after = true;

    target.classList.add(after ? "page-drop-after" : "page-drop-before");
    return { targetId: target.dataset.pageId, after };
  }

  function markGroupDropBoundary(groupId, after) {
    const blockItems = $$(".page-item, .page-group-header", refs.pageList)
      .filter(item => (item.dataset.groupPath || "").split(" ").includes(groupId));
    const header = blockItems.find(item =>
      item.classList.contains("page-group-header") && item.dataset.groupId === groupId
    );
    if (!header) return;
    if (!after) {
      header.classList.add("group-drop-before");
      return;
    }
    (blockItems.at(-1) || header).classList.add("group-drop-after");
  }

  function groupListDropPosition(clientX, clientY, sourceGroupId) {
    const target = pageListTargetAt(clientX, clientY);
    if (!target) return null;

    $$(".page-item.page-drop-before, .page-item.page-drop-after, .page-item.group-drop-after, .page-item.group-nest-page-target", refs.pageList)
      .forEach(item => item.classList.remove(
        "page-drop-before", "page-drop-after", "group-drop-after", "group-nest-page-target"
      ));
    $$(".page-group-header.page-group-drop-target, .page-group-header.group-nest-target, .page-group-header.group-drop-before, .page-group-header.group-drop-after", refs.pageList)
      .forEach(item => item.classList.remove(
        "page-group-drop-target", "group-nest-target", "group-drop-before", "group-drop-after"
      ));

    const targetPage = target.classList.contains("page-item")
      ? book.pages.find(page => page.id === target.dataset.pageId)
      : null;
    const targetGroupId = target.classList.contains("page-group-header")
      ? target.dataset.groupId
      : targetPage?.groupId;

    if (targetGroupId) {
      const canNest = canSetGroupParent(sourceGroupId, targetGroupId);
      const header = $$(".page-group-header", refs.pageList)
        .find(item => item.dataset.groupId === targetGroupId);
      if (targetPage) {
        // 그룹 안의 페이지 어디에 놓아도 그 페이지가 속한 가장 안쪽 그룹으로 들어간다.
        if (!canNest) return null;
        header?.classList.add("group-nest-target");
        target.classList.add("group-nest-page-target");
        return { nestIntoGroupId: targetGroupId };
      }
      if (target.classList.contains("page-group-header")) {
        const headerRect = target.getBoundingClientRect();
        // 순서 변경 영역을 비율(위·아래 14%)이 아니라 실제 픽셀로 잡는다.
        // 머리글 높이가 40px로 줄면서 14%는 5.6px밖에 안 돼 손가락으로는
        // 맞출 수가 없었고, 그래서 거의 모든 드롭이 '그룹 안으로 넣기'로
        // 빠져 순서가 바뀌지 않았다.
        const edge = clamp(headerRect.height * 0.38, 12, 20);
        const inMiddle = clientY > headerRect.top + edge &&
          clientY < headerRect.bottom - edge;
        if (inMiddle && canNest) {
          target.classList.add("group-nest-target");
          return { nestIntoGroupId: targetGroupId };
        }
      }
      const blockItems = $$(".page-item, .page-group-header", refs.pageList)
        .filter(item => (item.dataset.groupPath || "").split(" ").includes(targetGroupId));
      const firstRect = (header || blockItems[0])?.getBoundingClientRect();
      const lastRect = (blockItems.at(-1) || header)?.getBoundingClientRect();
      if (!firstRect || !lastRect) return null;
      const after = clientY >= (firstRect.top + lastRect.bottom) / 2;
      markGroupDropBoundary(targetGroupId, after);
      return { targetGroupId, after };
    }

    if (!targetPage) return null;
    const rect = target.getBoundingClientRect();
    let after = clientY >= rect.top + rect.height / 2;
    if (targetPage.type === "cover") after = true;
    target.classList.add(after ? "page-drop-after" : "page-drop-before");
    return { targetPageId: targetPage.id, after };
  }

  function syncGroupOrderToPageOrder() {
    const groupById = new Map(book.groups.map(group => [group.id, group]));
    const ordered = [];
    const seen = new Set();
    const appendPath = groupId => groupPathForId(groupId).forEach(group => {
      if (seen.has(group.id) || !groupById.has(group.id)) return;
      seen.add(group.id);
      ordered.push(groupById.get(group.id));
    });
    book.pages.forEach(page => appendPath(page.groupId));
    book.groups.forEach(group => {
      appendPath(group.id);
    });
    book.groups = ordered;
  }

  function reorderGroupFromList(sourceGroupId, drop) {
    const sourceGroup = book.groups.find(group => group.id === sourceGroupId);
    if (!sourceGroup || !drop) return false;
    const sourceGroupIds = groupDescendantIdSet(sourceGroupId);
    const movedPages = book.pages.filter(page => sourceGroupIds.has(page.groupId));
    const remainingPages = book.pages.filter(page => !sourceGroupIds.has(page.groupId));
    const originalSourceIndex = book.pages.findIndex(page => sourceGroupIds.has(page.groupId));
    const beforeState = JSON.stringify({
      pages: book.pages.map(page => page.id),
      groups: book.groups.map(group => [group.id, group.parentId || null]),
    });
    let insertIndex = -1;
    let nextParentId = sourceGroup.parentId || null;
    let nested = false;
    if (drop.nestIntoGroupId) {
      if (!canSetGroupParent(sourceGroupId, drop.nestIntoGroupId)) return false;
      const targetIds = groupDescendantIdSet(drop.nestIntoGroupId);
      const indexes = remainingPages
        .map((page, index) => targetIds.has(page.groupId) ? index : -1)
        .filter(index => index >= 0);
      insertIndex = indexes.length
        ? indexes.at(-1) + 1
        : clamp(originalSourceIndex, 1, remainingPages.length);
      nextParentId = drop.nestIntoGroupId;
      nested = true;
    } else if (drop.targetGroupId) {
      if (sourceGroupIds.has(drop.targetGroupId)) return false;
      const targetGroup = book.groups.find(group => group.id === drop.targetGroupId);
      if (!targetGroup) return false;
      const targetIds = groupDescendantIdSet(drop.targetGroupId);
      const indexes = remainingPages
        .map((page, index) => targetIds.has(page.groupId) ? index : -1)
        .filter(index => index >= 0);
      insertIndex = indexes.length
        ? (drop.after ? indexes.at(-1) + 1 : indexes[0])
        : clamp(originalSourceIndex, 1, remainingPages.length);
      nextParentId = targetGroup.parentId || null;
    } else if (drop.targetPageId) {
      insertIndex = remainingPages.findIndex(page => page.id === drop.targetPageId);
      if (insertIndex < 0) return false;
      if (drop.after) insertIndex += 1;
      nextParentId = null;
    }
    if (insertIndex < 0) return false;

    sourceGroup.parentId = nextParentId;
    insertIndex = clamp(insertIndex, 1, remainingPages.length);
    book.pages = [
      ...remainingPages.slice(0, insertIndex),
      ...movedPages,
      ...remainingPages.slice(insertIndex),
    ];
    book.pages = normalizeGroupPageOrder(book.pages, book.groups);
    syncGroupOrderToPageOrder();
    const afterState = JSON.stringify({
      pages: book.pages.map(page => page.id),
      groups: book.groups.map(group => [group.id, group.parentId || null]),
    });
    if (afterState === beforeState) return false;
    currentIndex = Math.max(0, book.pages.findIndex(page => page.id === activePageId));
    selection = null;
    commitHistory();
    renderAll();
    const parentName = book.groups.find(group => group.id === nextParentId)?.name;
    showToast(nested
      ? `"${sourceGroup.name}"을(를) "${parentName}" 안의 그룹으로 이동했습니다`
      : `"${sourceGroup.name}" 그룹과 페이지 순서를 변경했습니다`);
    return true;
  }

  function reorderPagesFromList(sourceIds, targetId, after) {
    const orderedIds = orderedMovablePageIds(sourceIds);
    const sourceSet = new Set(orderedIds);
    if (!orderedIds.length || !targetId || sourceSet.has(targetId)) return false;
    const targetPage = book.pages.find(page => page.id === targetId);
    if (!targetPage) return false;
    const beforeState = JSON.stringify(book.pages.map(page => [page.id, page.groupId || null]));
    const movedPages = book.pages.filter(page => sourceSet.has(page.id));
    const remainingPages = book.pages.filter(page => !sourceSet.has(page.id));
    let insertIndex = remainingPages.findIndex(page => page.id === targetId);
    if (insertIndex < 0) return false;
    if (after) insertIndex += 1;
    movedPages.forEach(page => page.groupId = targetPage.groupId || null);
    remainingPages.splice(Math.max(1, insertIndex), 0, ...movedPages);
    book.pages = normalizeGroupPageOrder(remainingPages, book.groups);
    const afterState = JSON.stringify(book.pages.map(page => [page.id, page.groupId || null]));
    if (afterState === beforeState) return false;
    currentIndex = Math.max(0, book.pages.findIndex(page => page.id === activePageId));
    selection = null;
    commitHistory();
    renderAll();
    showToast(orderedIds.length > 1
      ? `${orderedIds.length}개 페이지를 함께 이동했습니다`
      : "페이지 순서를 변경했습니다");
    return true;
  }

  function reorderPageFromList(sourceId, targetId, after) {
    return reorderPagesFromList([sourceId], targetId, after);
  }

  function movePagesIntoGroup(sourceIds, groupId, atStart = false) {
    const orderedIds = orderedMovablePageIds(sourceIds);
    const sourceSet = new Set(orderedIds);
    const group = book.groups.find(item => item.id === groupId);
    if (!orderedIds.length || !group) return false;
    const sourceIndexes = orderedIds.map(id => book.pages.findIndex(page => page.id === id));
    const movedPages = book.pages.filter(page => sourceSet.has(page.id));
    const remainingPages = book.pages.filter(page => !sourceSet.has(page.id));
    movedPages.forEach(page => page.groupId = group.id);
    const targetGroupIds = groupDescendantIdSet(group.id);
    let insertIndex = atStart
      ? remainingPages.findIndex(page => targetGroupIds.has(page.groupId))
      : -1;
    if (!atStart) {
      remainingPages.forEach((page, index) => {
        if (targetGroupIds.has(page.groupId)) insertIndex = index + 1;
      });
    }
    // 비어 있는 그룹이면 원래 쪽 위치를 유지한다. 그룹 헤더에 놓으면 맨 앞,
    // 그룹 선택 메뉴로 넣으면 기존처럼 맨 뒤에 붙인다.
    if (insertIndex < 0) {
      insertIndex = Math.min(Math.max(1, Math.min(...sourceIndexes)), remainingPages.length);
    }
    remainingPages.splice(insertIndex, 0, ...movedPages);
    book.pages = normalizeGroupPageOrder(remainingPages, book.groups);
    collapsedGroups.delete(group.id);
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsedGroups]));
    if (!book.pages.some(page => page.id === activePageId)) activePageId = movedPages[0].id;
    currentIndex = Math.max(0, book.pages.findIndex(page => page.id === activePageId));
    selection = null;
    commitHistory();
    renderAll();
    showToast(orderedIds.length > 1
      ? `${orderedIds.length}개 페이지를 "${group.name}" 그룹${atStart ? " 맨 위" : ""}에 넣었습니다`
      : `페이지를 "${group.name}" 그룹${atStart ? " 맨 위" : ""}에 넣었습니다`);
    return true;
  }

  function movePageIntoGroup(sourceId, groupId) {
    return movePagesIntoGroup([sourceId], groupId);
  }

  function applyPageListDrop(sourceIds, drop) {
    if (!drop) return false;
    if (drop.groupId) return movePagesIntoGroup(sourceIds, drop.groupId, drop.atStart === true);
    return reorderPagesFromList(sourceIds, drop.targetId, drop.after);
  }

  function applyPageListDragDrop(state, drop = state?.drop) {
    if (!state || !drop) return false;
    return state.kind === "group"
      ? reorderGroupFromList(state.sourceId, drop)
      : applyPageListDrop(state.sourceIds || [state.sourceId], drop);
  }

  function wirePageGroupReorder(header, group) {
    let touchState = null;
    let longPressTimer = null;

    const finishTouch = (event, cancelled = false) => {
      if (!touchState) return;
      const wasArmed = touchState.armed;
      let drop = touchState.drop;
      const finalTouch = Array.from(event.changedTouches || [])
        .find(candidate => candidate.identifier === touchState.identifier) ||
        event.changedTouches?.[0];
      if (!cancelled && wasArmed && finalTouch) {
        drop = groupListDropPosition(finalTouch.clientX, finalTouch.clientY, group.id) || drop;
      }
      clearTimeout(longPressTimer);
      longPressTimer = null;
      touchState = null;
      stopPageListAutoScroll();
      clearPageListDropVisuals();
      if (!wasArmed) return;
      event.preventDefault();
      event.stopPropagation();
      header._suppressGroupClick = true;
      window.setTimeout(() => {
        if (header.isConnected) header._suppressGroupClick = false;
      }, 500);
      if (!cancelled && drop) reorderGroupFromList(group.id, drop);
    };

    header.addEventListener("touchstart", event => {
      if (event.touches.length !== 1 || event.target.closest(".group-menu-button")) return;
      const touch = event.touches[0];
      clearTimeout(longPressTimer);
      touchState = {
        identifier: touch.identifier,
        clientX: touch.clientX,
        clientY: touch.clientY,
        armed: false,
        drop: null,
      };
      longPressTimer = window.setTimeout(() => {
        if (!touchState) return;
        touchState.armed = true;
        header.classList.add("group-reorder-source");
        refs.pageList.classList.add("reordering");
        navigator.vibrate?.(24);
      }, 450);
    }, { passive: true });

    header.addEventListener("touchmove", event => {
      if (!touchState) return;
      const touch = Array.from(event.touches)
        .find(candidate => candidate.identifier === touchState.identifier);
      if (!touch) return;
      const distance = Math.hypot(
        touch.clientX - touchState.clientX,
        touch.clientY - touchState.clientY
      );
      if (!touchState.armed) {
        if (distance > 10) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
          touchState = null;
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      updatePageListAutoScroll(touch.clientY);
      touchState.drop = groupListDropPosition(
        touch.clientX, touch.clientY, group.id
      );
    }, { passive: false });

    header.addEventListener("touchend", event => finishTouch(event), { passive: false });
    header.addEventListener("touchcancel", event => finishTouch(event, true), { passive: false });

    header.draggable = true;
    header.addEventListener("dragstart", event => {
      if (event.target.closest(".group-menu-button")) {
        event.preventDefault();
        return;
      }
      pageListDragState = { kind: "group", sourceId: group.id, drop: null };
      header._suppressGroupClick = true;
      header.classList.add("group-reorder-source");
      refs.pageList.classList.add("reordering");
      event.dataTransfer?.setData("text/plain", `group:${group.id}`);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    header.addEventListener("dragover", event => {
      if (!pageListDragState) return;
      event.preventDefault();
      if (pageListDragState.kind === "group") {
        pageListDragState.drop = groupListDropPosition(
          event.clientX, event.clientY, pageListDragState.sourceId
        );
      } else {
        $$(".page-item.page-drop-before, .page-item.page-drop-after", refs.pageList)
          .forEach(item => item.classList.remove("page-drop-before", "page-drop-after"));
        $$(".page-group-header.page-group-drop-target", refs.pageList)
          .forEach(item => item.classList.remove("page-group-drop-target"));
        header.classList.add("page-group-drop-target");
        pageListDragState.drop = { groupId: group.id };
      }
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    header.addEventListener("drop", event => {
      if (!pageListDragState) return;
      event.preventDefault();
      event.stopPropagation();
      const state = pageListDragState;
      const drop = state.kind === "group"
        ? groupListDropPosition(event.clientX, event.clientY, state.sourceId)
        : pageListDropPosition(event.clientX, event.clientY, state.sourceIds || [state.sourceId]);
      pageListDragState = null;
      clearPageListDropVisuals();
      applyPageListDragDrop(state, drop || state.drop);
    });
    header.addEventListener("dragend", () => {
      pageListDragState = null;
      clearPageListDropVisuals();
      window.setTimeout(() => {
        if (header.isConnected) header._suppressGroupClick = false;
      }, 250);
    });
  }

  function wirePageListReorder(item, page) {
    if (page.type === "cover") {
      item.classList.add("page-fixed");
      return;
    }

    let touchState = null;
    let longPressTimer = null;

    const finishTouch = (event, cancelled = false) => {
      if (!touchState) return;
      const wasArmed = touchState.armed;
      const sourceIds = touchState.sourceIds || pageDragIdsForSource(page.id);
      let drop = touchState.drop;
      const finalTouch = Array.from(event.changedTouches || [])
        .find(candidate => candidate.identifier === touchState.identifier) ||
        event.changedTouches?.[0];
      if (!cancelled && wasArmed && finalTouch) {
        drop = pageListDropPosition(finalTouch.clientX, finalTouch.clientY, sourceIds) || drop;
      }
      clearTimeout(longPressTimer);
      longPressTimer = null;
      touchState = null;
      stopPageListAutoScroll();
      clearPageListDropVisuals();
      if (!wasArmed) return;
      event.preventDefault();
      event.stopPropagation();
      item._suppressPageClick = true;
      window.setTimeout(() => {
        if (item.isConnected) item._suppressPageClick = false;
      }, 500);
      if (!cancelled && drop) applyPageListDrop(sourceIds, drop);
    };

    item.addEventListener("touchstart", event => {
      if (event.touches.length !== 1 ||
          event.target.closest(".page-select-checkbox, .page-title-edit-button")) return;
      const touch = event.touches[0];
      clearTimeout(longPressTimer);
      touchState = {
        identifier: touch.identifier,
        clientX: touch.clientX,
        clientY: touch.clientY,
        armed: false,
        drop: null,
      };
      longPressTimer = window.setTimeout(() => {
        if (!touchState) return;
        touchState.armed = true;
        touchState.sourceIds = pageDragIdsForSource(page.id);
        markPageDragSources(touchState.sourceIds);
        refs.pageList.classList.add("reordering");
        navigator.vibrate?.(24);
      }, 450);
    }, { passive: true });

    item.addEventListener("touchmove", event => {
      if (!touchState) return;
      const touch = Array.from(event.touches)
        .find(candidate => candidate.identifier === touchState.identifier);
      if (!touch) return;
      const distance = Math.hypot(
        touch.clientX - touchState.clientX,
        touch.clientY - touchState.clientY
      );
      if (!touchState.armed) {
        if (distance > 10) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
          touchState = null;
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      updatePageListAutoScroll(touch.clientY);
      touchState.drop = pageListDropPosition(
        touch.clientX, touch.clientY, touchState.sourceIds || [page.id]
      );
    }, { passive: false });

    item.addEventListener("touchend", event => finishTouch(event), { passive: false });
    item.addEventListener("touchcancel", event => finishTouch(event, true), { passive: false });

    item.draggable = true;
    item.addEventListener("dragstart", event => {
      if (event.target.closest(".page-select-checkbox, .page-title-edit-button")) {
        event.preventDefault();
        return;
      }
      const sourceIds = pageDragIdsForSource(page.id);
      pageListDragState = { kind: "pages", sourceId: page.id, sourceIds, drop: null };
      markPageDragSources(sourceIds);
      refs.pageList.classList.add("reordering");
      event.dataTransfer?.setData("text/plain", sourceIds.join(","));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragover", event => {
      if (!pageListDragState || (
        pageListDragState.kind === "pages" &&
        pageListDragState.sourceIds?.includes(page.id)
      )) return;
      event.preventDefault();
      pageListDragState.drop = pageListDragState.kind === "group"
        ? groupListDropPosition(event.clientX, event.clientY, pageListDragState.sourceId)
        : pageListDropPosition(
            event.clientX, event.clientY,
            pageListDragState.sourceIds || [pageListDragState.sourceId]
          );
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    item.addEventListener("drop", event => {
      if (!pageListDragState) return;
      event.preventDefault();
      const state = pageListDragState;
      const drop = state.kind === "group"
        ? groupListDropPosition(event.clientX, event.clientY, state.sourceId)
        : pageListDropPosition(event.clientX, event.clientY, state.sourceIds || [state.sourceId]);
      pageListDragState = null;
      clearPageListDropVisuals();
      applyPageListDragDrop(state, drop || state.drop);
    });
    item.addEventListener("dragend", () => {
      pageListDragState = null;
      clearPageListDropVisuals();
    });
  }

  function renderPageGroupSelect() {
    const page = book.pages[currentIndex];
    refs.pageGroupSelect.innerHTML = `<option value="">그룹 없음</option>` +
      book.groups.map(group => {
        const depth = Math.max(0, groupPathForId(group.id).length - 1);
        const label = `${"— ".repeat(depth)}${group.name}`;
        return `<option value="${escapeHtml(group.id)}">${escapeHtml(label)}</option>`;
      }).join("");
    refs.pageGroupSelect.value = page?.groupId || "";
    refs.pageGroupSelect.disabled = page?.type === "cover";
  }

  function shortType(type, planTemplate = "") {
    if (type === "blank" && planTemplate === "project") return "프로젝트";
    if (type === "blank" && planTemplate === "tracker") return "습관";
    if (type === "blank" && planTemplate === "life-map") return "영역";
    if (type === "blank" && planTemplate === "goal-detail") return "실행";
    if (type === "blank" && isYearCalendarTemplate(planTemplate)) return "연간";
    const map = {
      cover: "표지", index: "목차", symbols: "기호", goals: "목표",
      "future-h1": "미래", "future-h2": "미래", monthly: "월간",
      "weekly-left": "주간", "weekly-right": "주간",
      daily: "일간", manual1: "안내", manual2: "안내", feedback: "회고", blank: "메모",
    };
    return map[type] || "페이지";
  }

  function renderSpread() {
    refs.spread.innerHTML = "";
    currentIndex = clamp(Number.isInteger(currentIndex) ? currentIndex : 0, 0, book.pages.length - 1);
    let indexes = visibleIndexes().filter(index => book.pages[index]);
    if (!indexes.length && book.pages.length) {
      currentIndex = 0;
      indexes = [0];
    }
    const nextSpreadKey = indexes.map(index => book.pages[index]?.id || index).join(":");
    if (nextSpreadKey !== zoomSpreadKey) {
      zoomSpreadKey = nextSpreadKey;
      pageZoom = 1;
      pagePanX = 0;
      pagePanY = 0;
    }
    indexes.forEach((index, position) => {
      const side = indexes.length === 1 ? "single" : position === 0 ? "left" : "right";
      refs.spread.append(createPageDOM(book.pages[index], index, side));
    });
    requestAnimationFrame(updatePageScale);
  }

  function updatePageScale() {
    const indexes = visibleIndexes();
    const count = Math.max(1, indexes.length);
    const viewportRect = refs.viewport.getBoundingClientRect();
    const rect = {
      width: refs.spread.clientWidth > 1 ? refs.spread.clientWidth : viewportRect.width,
      height: refs.spread.clientHeight > 1 ? refs.spread.clientHeight : viewportRect.height,
    };
    if (rect.width <= 1 || rect.height <= 1) {
      window.setTimeout(updatePageScale, 80);
      return;
    }
    const gap = count === 2 ? clamp(rect.width * 0.012, 2, 14) : 0;
    const widthScale = (rect.width - (count - 1) * gap) / (PAGE_W * count);
    const heightScale = rect.height / PAGE_H;
    // 고해상도 Fold 화면에서도 원본 1배에 묶이지 않고 사용 가능한 영역을 채운다.
    const fitScale = clamp(Math.min(widthScale, heightScale), 0.16, 4);
    const scale = clamp(fitScale * pageZoom, 0.12, 8);
    const contentWidth = PAGE_W * scale * count + (count - 1) * gap;
    const contentHeight = PAGE_H * scale;
    const maxPanX = Math.max(0, (contentWidth - rect.width) / 2) + (pageZoom > 1 ? 26 : 0);
    const maxPanY = Math.max(0, (contentHeight - rect.height) / 2) + (pageZoom > 1 ? 26 : 0);
    pagePanX = clamp(pagePanX, -maxPanX, maxPanX);
    pagePanY = clamp(pagePanY, -maxPanY, maxPanY);
    refs.spread.style.setProperty("--page-gap", `${gap.toFixed(2)}px`);
    refs.spread.style.setProperty("--page-scale", scale.toFixed(4));
    refs.spread.style.setProperty("--scaled-page-w", `${(PAGE_W * scale).toFixed(2)}px`);
    refs.spread.style.setProperty("--scaled-page-h", `${(PAGE_H * scale).toFixed(2)}px`);
    refs.spread.style.transform =
      `translate3d(${pagePanX.toFixed(1)}px, ${pagePanY.toFixed(1)}px, 0)`;
    refs.viewStatus.textContent =
      `${viewMode === "auto" ? "자동" : "고정"} · ${count === 2 ? "두 쪽" : "한 쪽"} · ${Math.round(pageZoom * 100)}%`;
    lastSpreadState = isSpreadView();
  }

  function createPageDOM(page, pageIndex, side = "single", options = {}) {
    const wrap = document.createElement("div");
    wrap.className = `page-wrap ${side}`;
    wrap.dataset.pageId = page.id;

    const pageEl = document.createElement("div");
    pageEl.className = "journal-page";
    pageEl.dataset.pageId = page.id;
    pageEl.dataset.pageIndex = pageIndex;

    const template = document.createElement("div");
    template.className = "page-template";
    template.innerHTML = templateHTML(page, pageIndex);
    wireTemplateEditing(page, template, options);
    wireCalendarTemplateControls(page, template, options);
    wireGoalEditorTriggers(template, options);
    if (!options.print && page.type === "index") wireIndexSearch(template);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("ink-layer");
    svg.setAttribute("viewBox", `0 0 ${PAGE_W} ${PAGE_H}`);
    svg.setAttribute("width", PAGE_W);
    svg.setAttribute("height", PAGE_H);

    const elements = document.createElement("div");
    elements.className = "page-elements";

    for (const element of page.elements) {
      if (element.type === "text") elements.append(renderTextElement(page, element, options));
      if (element.type === "stroke" || element.type === "line") svg.append(renderStrokeElement(page, element, options));
    }

    const number = document.createElement("div");
    number.className = "page-footer-number";
    number.textContent = pageIndex + 1;

    pageEl.append(template, svg, elements, number);
    wrap.append(pageEl);

    if (!options.print) {
      pageEl.addEventListener("pointerdown", event => {
        keyboardScope = "canvas";
        onPagePointerDown(event, page, svg, elements);
      });
    }
    return wrap;
  }

  function goalTemplateBinding(node) {
    const kind = node.dataset.goalEntity || "";
    const id = node.dataset.goalId || "";
    const field = node.dataset.goalField || "";
    const settings = {
      area: {
        collection: "areas",
        fields: { name: [40, true, true], purpose: [240, false, false] },
      },
      goal: {
        collection: "goals",
        fields: { title: [80, true, true], result: [320, false, false] },
      },
      mission: {
        collection: "missions",
        fields: { title: [100, true, true] },
      },
    }[kind];
    const fieldSettings = settings?.fields?.[field];
    const entity = settings
      ? currentGoalSystem()[settings.collection].find(item => item.id === id)
      : null;
    if (!entity || !fieldSettings) return null;
    return {
      kind,
      entity,
      field,
      maxLength: fieldSettings[0],
      required: fieldSettings[1],
      singleLine: fieldSettings[2],
    };
  }

  function normalizeGoalTemplateValue(binding, value, fallback = "") {
    let text = String(value ?? "").replace(/\r/g, "");
    if (binding.singleLine) text = text.replace(/\s+/g, " ");
    text = text.trim().slice(0, binding.maxLength);
    if (binding.required && !text) return String(fallback || "").trim();
    return text;
  }

  function finishGoalTemplateEdit(binding, value, previousValue) {
    const next = normalizeGoalTemplateValue(binding, value, previousValue);
    binding.entity[binding.field] = next;
    if (binding.kind === "goal" && binding.field === "title" && next !== previousValue) {
      book.pages
        .filter(page => page.planTemplate === "goal-detail" && page.goalId === binding.entity.id)
        .forEach(page => {
          if (page.titleCustomized !== true || page.title === previousValue) page.title = next;
        });
    }
    return next;
  }

  function wireGoalEditorTriggers(template, options = {}) {
    if (options.print) return;
    $$('[data-goal-editor-kind][data-goal-editor-id]', template).forEach(node => {
      const kind = node.dataset.goalEditorKind;
      const id = node.dataset.goalEditorId;
      let touch = null;
      let lastTapAt = 0;
      let lastOpenAt = 0;
      const open = event => {
        const now = Date.now();
        if (now - lastOpenAt < 500) return;
        lastOpenAt = now;
        event?.preventDefault?.();
        event?.stopPropagation?.();
        openGoalEditor(kind, id, "", "page");
      };
      node.classList.add("goal-data-editable");
      node.title = "두 번 누르면 목표·미션 정보를 편집합니다";
      node.addEventListener("dblclick", open);
      node.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" || event.button > 0) return;
        touch = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startedAt: Date.now(),
        };
        event.stopPropagation();
      });
      node.addEventListener("pointermove", event => {
        if (!touch || event.pointerId !== touch.pointerId) return;
        if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 7) touch = null;
      });
      node.addEventListener("pointerup", event => {
        if (!touch || event.pointerId !== touch.pointerId) return;
        const tap = touch;
        touch = null;
        if (Date.now() - tap.startedAt > 420) return;
        const now = Date.now();
        if (lastTapAt > 0 && now - lastTapAt <= 340) {
          lastTapAt = 0;
          open(event);
        } else {
          lastTapAt = now;
        }
      });
      node.addEventListener("pointercancel", () => { touch = null; });
    });
  }

  function wireTemplateEditing(page, template, options = {}) {
    const legacySelector = [
      ".template-title",
      ".template-subtitle",
      ".template-label",
      ".template-note",
      ".template-month-title",
      ".template-day-title",
      ".template-goal-section strong",
      ".cover-frame h1",
      ".cover-frame p",
    ].join(",");
    const nodes = $$(`${legacySelector},[data-template-key],[data-goal-entity][data-goal-id][data-goal-field]`, template);
    const templateText = page.templateText || (options.print ? {} : (page.templateText = {}));
    const simpleMobile = isAndroidApp && !advancedMobileEditing;

    nodes.forEach((node, nodeIndex) => {
      if (node.dataset.fixedDate === "true") {
        node.contentEditable = "false";
        node.classList.add("fixed-date-control");
        return;
      }
      const goalBinding = goalTemplateBinding(node);
      const property = node.dataset.templateProperty || "";
      // 키가 없는 노드는 위치에 따라 밀릴 수 있으므로 옛 t{n} 값과 섞이지 않게 분리한다.
      const field = node.dataset.templateKey
        ? `x.${node.dataset.templateKey}`
        : `auto.${page.type}.${nodeIndex}`;
      node.classList.add("template-editable");
      node.dataset.templateField = goalBinding
        ? `goal.${goalBinding.kind}.${goalBinding.entity.id}.${goalBinding.field}`
        : property || field;
      if (!goalBinding && Object.prototype.hasOwnProperty.call(templateText, field)) {
        node.innerText = templateText[field];
      }
      node.contentEditable = !options.print && tool === "text" && !simpleMobile
        ? "true" : "false";
      node.spellcheck = false;
      if (options.print) return;

      let mobileTap = null;
      let lastMobileTapAt = 0;
      let goalValueBefore = goalBinding ? String(goalBinding.entity[goalBinding.field] || "") : "";
      let goalValueChanged = false;
      node.addEventListener("pointerdown", event => {
        activePageId = page.id;
        if (simpleMobile && !node.classList.contains("mobile-template-editing") &&
            event.pointerType !== "mouse" && event.button <= 0) {
          mobileTap = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            startedAt: Date.now(),
          };
        }
        event.stopPropagation();
      });
      node.addEventListener("pointermove", event => {
        if (!mobileTap || event.pointerId !== mobileTap.pointerId) return;
        if (Math.hypot(
          event.clientX - mobileTap.clientX,
          event.clientY - mobileTap.clientY
        ) > 7) mobileTap = null;
      });
      node.addEventListener("pointerup", event => {
        if (!mobileTap || event.pointerId !== mobileTap.pointerId) return;
        const tap = mobileTap;
        mobileTap = null;
        if (Date.now() - tap.startedAt > 420) return;
        const now = Date.now();
        const isDoubleTap = lastMobileTapAt > 0 && now - lastMobileTapAt <= 340;
        if (!isDoubleTap) {
          lastMobileTapAt = now;
          return;
        }
        lastMobileTapAt = 0;
        event.preventDefault();
        event.stopPropagation();
        selection = null;
        node.contentEditable = "true";
        node.classList.add("editing", "mobile-template-editing");
        if (textEditBefore === null) textEditBefore = JSON.stringify(book);
        requestAnimationFrame(() => {
          node.focus({ preventScroll: true });
          placeCaretAtPoint(node, event.clientX, event.clientY);
        });
      });
      node.addEventListener("focus", () => {
        activePageId = page.id;
        selection = null;
        textEditBefore = JSON.stringify(book);
        if (goalBinding) {
          goalValueBefore = String(goalBinding.entity[goalBinding.field] || "");
          goalValueChanged = false;
          if (!goalValueBefore && node.dataset.goalPlaceholder === "true") node.innerText = "";
        }
        node.classList.add("editing");
      });
      node.addEventListener("input", () => {
        if (goalBinding) {
          goalValueChanged = true;
          const draft = String(node.innerText || "")
            .replace(/\r/g, "").slice(0, goalBinding.maxLength);
          goalBinding.entity[goalBinding.field] = goalBinding.required && !draft.trim()
            ? goalValueBefore
            : draft;
          markDirty();
        } else {
          page.templateText[field] = node.innerText;
          if (field === pageTitleTemplateField(page)) {
            const nextTitle = node.innerText.trim();
            if (nextTitle) setPageTitle(page, nextTitle);
          }
          markDirty();
        }
      });
      node.addEventListener("blur", () => {
        node.classList.remove("editing", "mobile-template-editing");
        if (simpleMobile) node.contentEditable = "false";
        if (goalBinding) {
          if (goalValueChanged) {
            node.innerText = finishGoalTemplateEdit(
              goalBinding,
              node.innerText,
              goalValueBefore
            );
          } else {
            goalBinding.entity[goalBinding.field] = goalValueBefore;
          }
        } else if (field === pageTitleTemplateField(page)) {
          setPageTitle(page, node.innerText);
          node.innerText = pageDisplayTitle(page);
        }
        if (textEditBefore !== null && textEditBefore !== JSON.stringify(book)) commitHistory();
        textEditBefore = null;
        renderAll();
      });
      wireTextEditingKeys(node);
    });
  }

  function renderTextElement(page, element, options = {}) {
    const node = document.createElement("div");
    node.className = `text-element ${selection?.elementId === element.id ? "selected" : ""}`;
    node.dataset.elementId = element.id;
    if (element.layoutTarget) node.dataset.layoutTarget = element.layoutTarget;
    node.contentEditable = "false";
    Object.assign(node.style, {
      left: `${element.x}px`,
      top: `${element.y}px`,
      width: `${element.width}px`,
      height: `${element.height}px`,
      color: element.color,
      fontSize: `${element.fontSize}px`,
      fontWeight: element.fontWeight,
      fontStyle: element.fontStyle,
      textAlign: element.align,
    });

    const content = document.createElement("div");
    content.className = "text-content";
    content.contentEditable = !options.print &&
      !(isAndroidApp && !advancedMobileEditing) &&
      (tool === "select" || tool === "text")
      ? "true"
      : "false";
    content.tabIndex = -1;
    content.draggable = false;
    content.spellcheck = false;
    content.textContent = element.text;
    node.append(content);

    if (options.print) return node;

    content.addEventListener("focus", () => {
      keyboardScope = "canvas";
      activePageId = page.id;
      selection = { pageId: page.id, elementId: element.id };
      node.classList.add("selected");
      if (!(isAndroidApp && !advancedMobileEditing)) {
        attachTextControls(page, element, node);
      }
      syncFontSizeControl(element);
      if (textEditBefore === null) textEditBefore = JSON.stringify(book);
    });
    content.addEventListener("input", () => {
      element.text = content.innerText.replace(/\n$/, "");
      if (!element.fixedSize) autoGrowTextElement(content, element, node);
      markDirty();
    });
    content.addEventListener("blur", () => {
      const wasMobileEditing = node.classList.contains("mobile-text-editing");
      const capturedAsEvent = captureCalendarEventElement(page, element);
      if (textEditBefore !== null && textEditBefore !== JSON.stringify(book)) commitHistory();
      textEditBefore = null;
      if (capturedAsEvent) {
        showToast("○ 이벤트를 날짜 일정으로 연동했습니다");
        renderAll();
        return;
      }
      if (wasMobileEditing) {
        node.classList.remove("mobile-text-editing");
        content.contentEditable = "false";
        selection = null;
        window.getSelection?.()?.removeAllRanges?.();
        requestAnimationFrame(() => renderSpread());
      }
    });
    content.addEventListener("dragstart", event => event.preventDefault());
    content.addEventListener("drop", event => event.preventDefault());
    wireTextEditingKeys(content);
    content.addEventListener("pointerdown", event => {
      activePageId = page.id;
      if (isAndroidApp && !advancedMobileEditing) {
        event.stopPropagation();
        return;
      }
      if (tool === "eraser") return;
      if (tool === "select" || tool === "text") {
        event.stopPropagation();
        selectTextElement(page, element, node);
      }
    });
    node.addEventListener("pointerdown", event => {
      activePageId = page.id;
      if (isAndroidApp && !advancedMobileEditing) {
        event.stopPropagation();
        return;
      }
      if (tool === "eraser") {
        event.stopPropagation();
        removeElement(page, element.id);
        return;
      }
      if ((tool === "select" || tool === "text") && event.target === node) {
        event.preventDefault();
        event.stopPropagation();
        selectTextElement(page, element, node);
        startTextDrag(event, page, element, node);
      }
    });
    if (isAndroidApp) wireMobileTextGestures(page, element, node, content);
    if (!(isAndroidApp && !advancedMobileEditing) &&
        (tool === "select" || tool === "text") &&
        selection?.pageId === page.id &&
        selection?.elementId === element.id) attachTextControls(page, element, node);
    return node;
  }

  function wireMobileTextGestures(page, element, node, content) {
    let timer = null;
    let gesture = null;
    let longPressed = false;
    let dragging = false;
    let lastTapAt = 0;

    const clearVisuals = () => {
      node.classList.remove("mobile-long-pressing", "mobile-long-dragging");
    };

    const reset = () => {
      clearTimeout(timer);
      timer = null;
      gesture = null;
      longPressed = false;
      dragging = false;
      clearVisuals();
    };

    // 간단 모드의 손가락 제스처는 그대로 유지한다. 고급 모드에서도
    // 선택 도구일 때는 글자 위를 잡아 박스를 옮길 수 있어야 한다.
    // 펜·선·지우개·글자 생성 도구에서는 각 도구의 입력을 우선한다.
    const gestureEnabled = () => !advancedMobileEditing || tool === "select";

    node.addEventListener("pointerdown", event => {
      if (!gestureEnabled() || node.classList.contains("mobile-text-editing") ||
          event.pointerType === "mouse" || event.button > 0) return;
      if (event.target.closest?.(".text-resize-handle")) return;
      const pageEl = node.closest(".journal-page");
      if (!pageEl) return;
      event.preventDefault();
      event.stopPropagation();
      if (advancedMobileEditing) event.stopImmediatePropagation();
      reset();
      gesture = {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        pageEl,
        pagePoint: pagePoint(event, pageEl),
        originX: Number(element.x) || 0,
        originY: Number(element.y) || 0,
      };
      node.setPointerCapture?.(event.pointerId);
      timer = window.setTimeout(() => {
        timer = null;
        if (!gesture || dragging) return;
        longPressed = true;
        selection = { pageId: page.id, elementId: element.id };
        activePageId = page.id;
        node.classList.add("mobile-long-pressing", "selected");
        navigator.vibrate?.(28);
      }, 460);
    }, true);

    node.addEventListener("pointermove", event => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      if (touchZoomActive) {
        reset();
        return;
      }
      const screenDistance = Math.hypot(
        event.clientX - gesture.clientX,
        event.clientY - gesture.clientY
      );
      if (longPressed) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!dragging && screenDistance > 5) {
        clearTimeout(timer);
        timer = null;
        dragging = true;
        element.gridLocked = true;
        selection = { pageId: page.id, elementId: element.id };
        activePageId = page.id;
        node.classList.add("mobile-long-dragging");
      }
      if (!dragging) return;
      const point = pagePoint(event, gesture.pageEl);
      const width = Math.max(18, Number(element.width) || 260);
      const height = Math.max(8, Number(element.height) || 34);
      element.x = snapToGrid(
        gesture.originX + point.x - gesture.pagePoint.x,
        0,
        Math.max(0, PAGE_W - width)
      );
      element.y = snapToGrid(
        gesture.originY + point.y - gesture.pagePoint.y,
        0,
        Math.max(0, PAGE_H - height)
      );
      node.style.left = `${element.x}px`;
      node.style.top = `${element.y}px`;
    }, true);

    const finish = (event, cancelled = false) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const pointerId = gesture.pointerId;
      const wasLongPressed = longPressed;
      const wasDragging = dragging;
      const tapX = event.clientX;
      const tapY = event.clientY;
      clearTimeout(timer);
      timer = null;
      clearVisuals();
      gesture = null;
      longPressed = false;
      dragging = false;
      node.releasePointerCapture?.(pointerId);
      event.preventDefault();
      event.stopPropagation();
      if (wasDragging) {
        lastTapAt = 0;
        selection = null;
        commitHistory();
        renderSpread();
        showToast("모눈 한 칸 단위로 기록 위치를 옮겼습니다");
      } else if (wasLongPressed && !cancelled) {
        lastTapAt = 0;
        // pointerup 직후 합성되는 잔여 탭이 메뉴 버튼을 누르지 않도록 한 프레임 뒤 연다.
        window.setTimeout(() => {
          if (selection?.pageId === page.id && selection?.elementId === element.id) {
            openMobileTextContext();
          }
        }, 70);
      } else if (!cancelled) {
        const now = Date.now();
        const isDoubleTap = lastTapAt > 0 && now - lastTapAt <= 330;
        selection = { pageId: page.id, elementId: element.id };
        activePageId = page.id;
        clearElementSelectionVisuals();
        node.classList.add("selected");
        if (isDoubleTap) {
          lastTapAt = 0;
          beginMobileTextEditing(page, element, node, content, tapX, tapY);
        } else {
          lastTapAt = now;
          attachTextControls(page, element, node);
          syncFontSizeControl(element);
        }
      }
    };

    node.addEventListener("pointerup", event => finish(event), true);
    node.addEventListener("pointercancel", event => finish(event, true), true);
    node.addEventListener("lostpointercapture", event => {
      if (gesture) finish(event, true);
    }, true);
    node.addEventListener("contextmenu", event => {
      if (!gestureEnabled() || node.classList.contains("mobile-text-editing")) return;
      event.preventDefault();
      event.stopPropagation();
      // Android WebView는 손을 떼기 전에 contextmenu를 먼저 발생시킬 수 있다.
      // 커스텀 pointerup 처리만 사용해야 메뉴 아래 버튼이 오작동하지 않는다.
    });
    node.addEventListener("selectstart", event => {
      if (!gestureEnabled() || node.classList.contains("mobile-text-editing")) return;
      event.preventDefault();
      event.stopPropagation();
      window.getSelection?.()?.removeAllRanges?.();
    }, true);
  }

  function beginMobileTextEditing(page, element, node, content, clientX, clientY) {
    selection = { pageId: page.id, elementId: element.id };
    activePageId = page.id;
    node.classList.add("selected", "mobile-text-editing");
    content.contentEditable = "true";
    content.spellcheck = false;
    if (textEditBefore === null) textEditBefore = JSON.stringify(book);
    requestAnimationFrame(() => {
      content.focus({ preventScroll: true });
      placeCaretAtPoint(content, clientX, clientY);
    });
  }

  function wireTextEditingKeys(node) {
    node.addEventListener("keydown", event => {
      if (((event.ctrlKey || event.metaKey) && event.key === "Enter") || event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        node.blur();
        setTimeout(() => {
          if (tool === "text") setTool("select");
          else renderSpread();
        }, 0);
      }
    });
  }

  function autoGrowTextElement(content, element, node) {
    content.style.height = "auto";
    const minimumHeight = Math.max(8, Math.ceil(Number(element.fontSize || 18) * 1.35 + 6));
    const maximumHeight = Math.max(8, PAGE_H - element.y);
    element.height = Math.min(Math.max(minimumHeight, content.scrollHeight + 6), maximumHeight);
    node.style.height = `${element.height}px`;
    content.style.height = "";
  }

  function clearElementSelectionVisuals() {
    $$(".text-element.selected", refs.spread).forEach(item => item.classList.remove("selected"));
    $$(".stroke-path.selected, .line-element.selected", refs.spread)
      .forEach(item => item.classList.remove("selected"));
    $$(".text-resize-handle", refs.spread).forEach(item => item.remove());
  }

  function selectTextElement(page, element, node) {
    const alreadySelected =
      selection?.pageId === page.id && selection?.elementId === element.id;
    selection = { pageId: page.id, elementId: element.id };
    if (alreadySelected && node.querySelector(".text-resize-handle")) return;
    clearElementSelectionVisuals();
    node.classList.add("selected");
    attachTextControls(page, element, node);
    syncFontSizeControl(element);
  }

  function attachTextControls(page, element, node) {
    if (node.querySelector(".text-resize-handle")) return;

    const directions = {
      nw: "왼쪽 위", n: "위", ne: "오른쪽 위", e: "오른쪽",
      se: "오른쪽 아래", s: "아래", sw: "왼쪽 아래", w: "왼쪽",
    };
    Object.entries(directions).forEach(([direction, label]) => {
      const resizeHandle = document.createElement("span");
      resizeHandle.className = `text-resize-handle ${direction}`;
      resizeHandle.dataset.direction = direction;
      resizeHandle.contentEditable = "false";
      resizeHandle.setAttribute("aria-label", `${label} 방향으로 텍스트 박스 크기 조절`);
      resizeHandle.setAttribute("title", "박스 크기만 조절 · 글자 크기는 상단에서 변경");
      resizeHandle.addEventListener("pointerdown", event => {
        event.preventDefault();
        event.stopPropagation();
        if (isAndroidApp && !advancedMobileEditing) element.gridLocked = true;
        startTextResize(event, page, element, node, direction);
      });
      node.append(resizeHandle);
    });
  }

  function renderStrokeElement(page, element, options = {}) {
    const ns = "http://www.w3.org/2000/svg";
    let node;
    if (element.type === "line") {
      node = document.createElementNS(ns, "line");
      node.setAttribute("x1", element.points[0].x);
      node.setAttribute("y1", element.points[0].y);
      node.setAttribute("x2", element.points[1].x);
      node.setAttribute("y2", element.points[1].y);
      node.classList.add("line-element");
    } else {
      node = document.createElementNS(ns, "path");
      node.setAttribute("d", pathFromPoints(element.points));
      node.classList.add("stroke-path");
    }
    node.dataset.elementId = element.id;
    node.setAttribute("stroke", element.color);
    node.setAttribute("stroke-width", element.width);
    node.setAttribute("opacity", element.opacity ?? 1);
    node.setAttribute("fill", "none");
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("stroke-linejoin", "round");
    node.style.pointerEvents = options.print ? "none" : "stroke";
    if (selection?.elementId === element.id) node.classList.add("selected");
    if (!options.print) {
      node.addEventListener("pointerdown", event => {
        keyboardScope = "canvas";
        activePageId = page.id;
        if (isAndroidApp && !advancedMobileEditing) {
          event.stopPropagation();
          return;
        }
        if (tool === "eraser") {
          event.stopPropagation();
          removeElement(page, element.id);
        } else if (tool === "select") {
          event.stopPropagation();
          selection = { pageId: page.id, elementId: element.id };
          renderSpread();
        }
      });
    }
    return node;
  }

  function pathFromPoints(points) {
    if (!points?.length) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y} l .1 .1`;
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const current = points[i];
      const next = points[i + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      path += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    path += ` L ${last.x} ${last.y}`;
    return path;
  }

  function templateHTML(page) {
    // 이스케이프는 실제로 HTML에 넣는 쪽에서 한 번만 한다.
    // 여기서 미리 이스케이프하면 titleBlock이 다시 이스케이프해 &amp;가 그대로 보인다.
    const title = pageDisplayTitle(page, "");
    if (page.type === "blank" && page.planTemplate === "project") {
      return projectPlanTemplate(title);
    }
    if (page.type === "blank" && page.planTemplate === "tracker") {
      return metricTrackerTemplate(title);
    }
    if (page.type === "blank" && page.planTemplate === "life-map") {
      return lifeAreaMapTemplate(title);
    }
    if (page.type === "blank" && page.planTemplate === "goal-detail") {
      return goalDetailTemplate(title, page);
    }
    if (page.type === "blank" && (isYearCalendarTemplate(page.planTemplate))) {
      return yearCalendarTemplate(page);
    }
    switch (page.type) {
      case "cover":
        return `<div class="template-cover"><div class="cover-frame"><div><h1 data-template-key="cover-title">Bullet Book</h1><p data-template-key="cover-caption">MY EDITABLE JOURNAL</p></div></div></div>`;
      case "index":
        return indexTemplate(title);
      case "symbols":
        return symbolsTemplate(title);
      case "manual1":
        return manualTemplateOne(title);
      case "manual2":
        return manualTemplateTwo(title);
      case "goals":
        return goalsTemplate(title);
      case "future-h1":
      case "future-h2":
        return futureTemplate(title, page.months || (page.type.endsWith("h1") ? [1,2,3,4,5,6] : [7,8,9,10,11,12]));
      case "monthly":
        return monthlyTemplate(title, page);
      case "weekly-left":
      case "weekly-right":
        return weeklyTemplate(title, page);
      case "daily":
        return dailyTemplate(title, page);
      case "feedback":
        return feedbackTemplate(title);
      default:
        return `<div class="template-title" data-template-key="page-title">${escapeHtml(title)}</div><div class="template-subtitle" data-template-key="page-subtitle">자유롭게 기록하세요</div>`;
    }
  }

  // 템플릿 글자의 저장 키는 렌더된 노드 개수와 무관하게 고정한다.
  // 월간처럼 달마다 줄 수가 달라지는 템플릿에서 위치 인덱스를 쓰면
  // 페이지를 옮길 때 사용자가 고친 글자가 다른 칸으로 밀린다.
  function titleBlock(title, subtitle = "", prefix = "page") {
    return `<div class="template-title" data-template-key="${prefix}-title">${escapeHtml(title)}</div>${subtitle ? `<div class="template-subtitle" data-template-key="${prefix}-subtitle">${escapeHtml(subtitle)}</div>` : ""}`;
  }

  function fixedDateTitleBlock(titleHtml, subtitle, action, label) {
    return `<button type="button" class="template-title fixed-date-title" data-fixed-date="true" data-date-edit="${action}" aria-label="${escapeHtml(label)}">${titleHtml}</button>
      <div class="template-subtitle fixed-date-subtitle" data-fixed-date="true">${escapeHtml(subtitle)}</div>`;
  }

  function indexTemplate(title) {
    return titleBlock(title, "INDEX · 내용·날짜·태그·페이지를 한 번에 검색", "index") + `
      <section class="index-search-panel" data-index-search>
        <div class="index-search-controls">
          <input class="index-search-input" type="search" placeholder="내용, #태그, 페이지 검색" aria-label="불렛북 검색">
          <select class="index-bullet-filter" aria-label="불렛 종류">
            <option value="">모든 불렛</option>
            <option value="base:dot">• 할 일</option>
            <option value="base:circle">○ 일정·이벤트</option>
            <option value="base:memo">− 메모</option>
            <option value="base:idea">+ 아이디어</option>
            <option value="status:migrated">&gt; 이월</option>
            <option value="status:scheduled">&lt; 예정</option>
            <option value="status:completed">× 완료</option>
          </select>
          <select class="index-group-filter" aria-label="페이지 그룹"><option value="">모든 그룹</option></select>
        </div>
        <div class="index-column-head"><span data-template-key="index-content">내용</span><span data-template-key="index-type">종류</span><span data-template-key="index-date">날짜</span><span data-template-key="index-page-group">페이지 / 그룹</span></div>
        <div class="index-results" role="list"></div>
        <div class="index-search-summary"></div>
      </section>`;
  }

  function bulletMeta(text) {
    const symbol = String(text || "").trimStart().charAt(0);
    const info = bulletSymbolInfo(symbol);
    if (info) {
      const baseLabel = {
        dot: "할 일",
        circle: "일정·이벤트",
        memo: "메모",
        idea: "아이디어",
      }[info.base] || "불렛";
      const statusLabel = {
        open: "",
        migrated: "이월",
        scheduled: "예정",
        completed: "완료",
      }[info.status];
      return {
        symbol: info.symbol,
        bulletType: info.base,
        bulletLabel: statusLabel ? `${baseLabel} · ${statusLabel}` : baseLabel,
        status: info.status,
      };
    }
    const legacy = {
      "★": ["legacy", "이전 중요", "flagged"],
    }[symbol] || ["", "", ""];
    return { symbol, bulletType: legacy[0], bulletLabel: legacy[1], status: legacy[2] };
  }

  function buildSearchEntries(sourceBook = book) {
    const entries = [];
    const goalSystem = sourceBook.goalSystem && typeof sourceBook.goalSystem === "object"
      ? sourceBook.goalSystem : createEmptyGoalSystem();
    const areaMap = new Map((goalSystem.areas || []).map(area => [area.id, area]));
    const goalMap = new Map((goalSystem.goals || []).map(goal => [goal.id, goal]));
    const missionMap = new Map((goalSystem.missions || []).map(mission => [mission.id, mission]));
    sourceBook.pages.forEach((page, pageIndex) => {
      const groupName = groupPathForId(page.groupId, sourceBook.groups || [])
        .map(group => group.name).join(" / ");
      const base = {
        pageId: page.id,
        pageIndex,
        pageTitle: pageDisplayTitle(page, "페이지", sourceBook.groups || []),
        pageDate: page.pageDate || "",
        groupId: page.groupId || "",
        groupName,
        updatedAt: sourceBook.updatedAt || page.createdAt || "",
      };
      const add = (content, source, elementId = "", extraTags = []) => {
        const clean = String(content || "").trim();
        if (!clean) return;
        const meta = bulletMeta(clean);
        const tags = [...new Set([
          ...[...clean.matchAll(/#([^\s#]+)/g)].map(match => match[1]),
          ...extraTags.filter(Boolean).map(String),
        ])];
        entries.push({
          id: `${page.id}:${source}:${elementId || entries.length}`,
          ...base,
          ...meta,
          content: clean,
          tags,
          elementId,
          source,
        });
      };
      add(base.pageTitle, "page");
      if ((page.type === "weekly-left" || page.type === "weekly-right") && page.weekNumber) {
        add(`${normalizedWeekNumber(page.weekNumber)}주차`, "week-number");
      }
      page.elements.forEach(element => {
        if (element.type !== "text") return;
        const mission = missionMap.get(element.missionId);
        const goal = goalMap.get(element.goalId || mission?.goalId);
        const area = areaMap.get(element.areaId || goal?.areaId);
        add(element.text, "element", element.id, [area?.name, goal?.title, mission?.title]);
      });
      Object.entries(page.templateText || {}).forEach(([field, text]) =>
        add(text, `template-${field}`)
      );
    });
    const lifeMapPage = sourceBook.pages.find(page =>
      page.type === "blank" && page.planTemplate === "life-map"
    );
    const fallbackPage = lifeMapPage || sourceBook.pages[0];
    const structuredEntry = (id, content, label, targetPage, tags = [], extra = {}) => {
      const page = targetPage || fallbackPage;
      const pageIndex = Math.max(0, sourceBook.pages.findIndex(item => item.id === page?.id));
      entries.push({
        id,
        pageId: page?.id || "",
        pageIndex,
        pageTitle: pageDisplayTitle(page, "목표·미션", sourceBook.groups || []),
        pageDate: extra.pageDate || "",
        groupId: page?.groupId || "",
        groupName: groupPathForId(page?.groupId, sourceBook.groups || [])
          .map(group => group.name).join(" / "),
        updatedAt: sourceBook.updatedAt || "",
        symbol: extra.symbol || "",
        bulletType: extra.bulletType || "",
        bulletLabel: extra.bulletLabel || label,
        status: extra.status || "",
        content: String(content || "").trim(),
        tags: [...new Set(tags.filter(Boolean).map(String))],
        elementId: "",
        source: extra.source || "goal-system",
      });
    };
    (sourceBook.calendarEvents || []).forEach(event => {
      const date = dateFromIso(event.date);
      const targetPage = sourceBook.pages.find(page =>
        page.type === "daily" && page.pageDate === event.date
      ) || sourceBook.pages.find(page => {
        if (page.type !== "monthly") return false;
        const context = monthlyDateContext(page, sourceBook.groups || []);
        return context.hasCalendarDate && context.year === date.getFullYear() &&
          context.month === date.getMonth() + 1;
      }) || sourceBook.pages.find(page =>
        (isYearCalendarTemplate(page.planTemplate)) && Number(page.year) === date.getFullYear()
      );
      structuredEntry(
        `calendar:${event.id}`,
        calendarEventText(event),
        "일정·이벤트",
        targetPage,
        [],
        {
          source: "calendar-event",
          pageDate: event.date,
          symbol: "○",
          bulletType: "circle",
          bulletLabel: "일정·이벤트",
          status: "open",
        }
      );
    });
    (goalSystem.areas || []).forEach(area =>
      structuredEntry(`area:${area.id}`, `${area.name} ${area.purpose}`.trim(), "인생 영역", lifeMapPage, [area.name], { source: "life-area" })
    );
    (goalSystem.goals || []).forEach(goal => {
      const area = areaMap.get(goal.areaId);
      const targetPage = sourceBook.pages.find(page =>
        page.type === "blank" && page.planTemplate === "goal-detail" && page.goalId === goal.id
      ) || lifeMapPage;
      structuredEntry(
        `goal:${goal.id}`,
        `${goal.title} ${goal.result}`.trim(),
        "결과 목표",
        targetPage,
        [area?.name, goal.title, goal.metricName],
        { source: "outcome-goal", status: goal.status, pageDate: goal.dueDate }
      );
    });
    (goalSystem.missions || []).forEach(mission => {
      const goal = goalMap.get(mission.goalId);
      const area = areaMap.get(goal?.areaId);
      const targetPage = sourceBook.pages.find(page =>
        page.type === "blank" && page.planTemplate === "goal-detail" && page.goalId === goal?.id
      ) || lifeMapPage;
      structuredEntry(
        `mission:${mission.id}`,
        mission.title,
        `미션 · ${missionScheduleLabel(mission)}`,
        targetPage,
        [area?.name, goal?.title, mission.title],
        { source: "mission", status: mission.active ? "active" : "paused", pageDate: mission.scheduledDate }
      );
    });
    return entries;
  }

  function wireIndexSearch(template) {
    const panel = $("[data-index-search]", template);
    if (!panel) return;
    const input = $(".index-search-input", panel);
    const bulletFilter = $(".index-bullet-filter", panel);
    const groupFilter = $(".index-group-filter", panel);
    const results = $(".index-results", panel);
    const summary = $(".index-search-summary", panel);
    groupFilter.innerHTML = `<option value="">모든 그룹</option>` +
      book.groups.map(group => {
        const depth = Math.max(0, groupPathForId(group.id).length - 1);
        const label = `${"— ".repeat(depth)}${group.name}`;
        return `<option value="${escapeHtml(group.id)}">${escapeHtml(label)}</option>`;
      }).join("");

    const renderResults = () => {
      const query = input.value.trim().toLocaleLowerCase("ko-KR");
      const rows = buildSearchEntries().filter(entry => {
        const haystack = [
          entry.content, entry.pageTitle, entry.groupName, entry.pageDate,
          ...(entry.tags || []),
        ].join(" ").toLocaleLowerCase("ko-KR");
        const [filterField, filterValue] = bulletFilter.value.split(":");
        const bulletMatches = !bulletFilter.value ||
          (filterField === "base" && entry.bulletType === filterValue) ||
          (filterField === "status" && entry.status === filterValue);
        const groupMatches = !groupFilter.value ||
          groupPathForId(entry.groupId).some(group => group.id === groupFilter.value);
        return (!query || haystack.includes(query)) && bulletMatches && groupMatches;
      });
      results.innerHTML = "";
      rows.slice(0, 80).forEach(entry => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "index-result-row";
        row.innerHTML = `
          <span class="index-result-content">${escapeHtml(entry.content)}</span>
          <span>${escapeHtml(entry.bulletLabel || "페이지")}</span>
          <span>${escapeHtml(entry.pageDate)}</span>
          <span>${escapeHtml(entry.pageTitle)}${entry.groupName ? `<small>${escapeHtml(entry.groupName)}</small>` : ""}</span>`;
        row.addEventListener("click", event => {
          event.stopPropagation();
          currentIndex = entry.pageIndex;
          activePageId = entry.pageId;
          selection = entry.elementId
            ? { pageId: entry.pageId, elementId: entry.elementId }
            : null;
          if (entry.groupId) {
            groupPathForId(entry.groupId).forEach(group => collapsedGroups.delete(group.id));
          }
          keyboardScope = "canvas";
          renderAll();
        });
        results.append(row);
      });
      summary.textContent = `${rows.length}개 검색됨${rows.length > 80 ? " · 앞 80개 표시" : ""}`;
    };
    panel.addEventListener("pointerdown", event => event.stopPropagation());
    panel.addEventListener("keydown", event => event.stopPropagation());
    input.addEventListener("input", renderResults);
    bulletFilter.addEventListener("change", renderResults);
    groupFilter.addEventListener("change", renderResults);
    renderResults();
  }

  function symbolsTemplate(title) {
    const items = [
      ["•", "할 일"],
      ["○", "일정·이벤트"],
      ["−", "메모"],
      ["+", "아이디어"],
      [">", "다음으로 이월"],
      ["<", "날짜를 정해 예정"],
      ["×", "완료"],
    ];
    return titleBlock(title, "계획 •/○ · 기록 −/+ · 계획 상태 >, <, ×", "symbols") +
      items.map(([symbol, label], index) => {
        const column = index >= 4 ? 1 : 0;
        const row = index % 4;
        const x = column ? 368 : 78;
        const y = 170 + row * 125;
        return `<span class="template-label status-bullet" data-template-key="symbol-${index}-mark" style="left:${x}px;top:${y}px;font-size:28px">${escapeHtml(symbol)}</span>
          <span class="template-label" data-template-key="symbol-${index}-label" style="left:${x + 55}px;top:${y + 4}px;font-size:17px">${label}</span>
          <span class="template-line" style="left:${x + 55}px;width:200px;top:${y + 37}px;background:rgba(55,53,48,.22)"></span>`;
      }).join("");
  }

  function manualTemplateOne(title) {
    return titleBlock(title, "종이에 쓰던 방식을 그대로", "manual1") + `
      <span class="template-label" data-template-key="manual1-0" style="left:60px;top:160px;font-size:20px">1. Yearly spread 작성</span>
      <span class="template-note" data-template-key="manual1-1" style="left:84px;top:208px;font-size:15px">• 1월부터 12월까지 기록하는 공간</span>
      <span class="template-note" data-template-key="manual1-2" style="left:84px;top:246px;font-size:15px">• Yearly Goal과 함께 작성</span>
      <span class="template-label" data-template-key="manual1-3" style="left:60px;top:322px;font-size:20px">2. Monthly spread 작성</span>
      <span class="template-note" data-template-key="manual1-4" style="left:84px;top:370px;font-size:15px">• 각 달의 일정과 월간 목표</span>
      <span class="template-note" data-template-key="manual1-5" style="left:84px;top:408px;font-size:15px">• 일정이 애매한 목표는 Queue로 관리</span>
      <span class="template-label" data-template-key="manual1-6" style="left:60px;top:484px;font-size:20px">3. Weekly spread 작성</span>
      <span class="template-note" data-template-key="manual1-7" style="left:84px;top:532px;font-size:15px">• 각 주의 일정과 주간 목표</span>
      <span class="template-label" data-template-key="manual1-8" style="left:60px;top:608px;font-size:20px">4. Daily spread 작성</span>
      <span class="template-note" data-template-key="manual1-9" style="left:84px;top:656px;font-size:15px">• 그날 일정, 목표, 메모를 빠르게 기록</span>
      <span class="template-note" data-template-key="manual1-10" style="left:84px;top:694px;font-size:15px">• 계획은 SMART하게, 기록은 부담 없이</span>`;
  }

  function manualTemplateTwo(title) {
    return titleBlock(title, "Feedback · Back · Planning", "manual2") + `
      <span class="template-label" data-template-key="manual2-0" style="left:60px;top:158px;font-size:20px">5. Feedback</span>
      <span class="template-note" data-template-key="manual2-1" style="left:84px;top:206px;font-size:15px">• 하루 혹은 한 주기가 끝나면 피드백 작성</span>
      <span class="template-note" data-template-key="manual2-2" style="left:84px;top:244px;font-size:15px">• 메모를 통한 자기평가와 다음 행동 결정</span>
      <span class="template-label" data-template-key="manual2-3" style="left:60px;top:322px;font-size:20px">6. Back</span>
      <span class="template-note" data-template-key="manual2-4" style="left:84px;top:370px;font-size:15px">• Daily부터 거슬러 올라가 Yearly Goal 확인</span>
      <span class="template-note" data-template-key="manual2-5" style="left:84px;top:408px;font-size:15px">• 목표를 측정 가능하게 쪼개고 태그 활용</span>
      <span class="template-label" data-template-key="manual2-6" style="left:60px;top:486px;font-size:20px">7. 사용하는 계획수립 기법</span>
      <span class="template-note" data-template-key="manual2-7" style="left:84px;top:536px;font-size:15px">• WOOP — Wish, Obstacle, Outcome, Plan</span>
      <span class="template-note" data-template-key="manual2-8" style="left:84px;top:574px;font-size:15px">• SMART — Specific, Measurable, Attainable,</span>
      <span class="template-note" data-template-key="manual2-9" style="left:199px;top:608px;font-size:15px">Realistic, Time-bound</span>`;
  }

  function goalsTemplate(title) {
    const sections = [
      ["목표 1", 150], ["목표 2", 300], ["목표 3", 450], ["목표 4", 600],
    ];
    return titleBlock(title, "목표는 측정 가능하게 작성", "goals") +
      sections.map(([name, top], index) => `
        <div class="template-goal-section" style="top:${top}px">
          <strong data-template-key="goal-${index + 1}">${name}</strong><span></span><span></span><span></span>
        </div>`).join("") +
      `<span class="template-note" data-template-key="goals-note" style="left:64px;bottom:84px">WOOP · SMART · 분기마다 Feedback & Back</span>`;
  }

  function planPanelLines(count) {
    return range(count, index =>
      `<span class="template-line plan-panel-line" style="top:${64 + index * 31}px"></span>`
    ).join("");
  }

  function projectPlanTemplate(title) {
    return titleBlock(
      title,
      "PROJECT PLAN · 완료 기준에서 오늘의 미션까지",
      "project"
    ) + `
      <section class="plan-panel project-clear-panel">
        <span class="template-label plan-panel-title" data-template-key="project-clear-heading">클리어 조건</span>
        <span class="template-note plan-panel-caption" data-template-key="project-clear-caption">무엇이 완성되면 이 프로젝트를 끝냈다고 할 수 있는가</span>
        ${planPanelLines(2)}
      </section>
      <section class="plan-panel project-stage-panel">
        <span class="template-label plan-panel-title" data-template-key="project-stage-heading">현재 단계</span>
        <span class="template-note plan-panel-caption" data-template-key="project-stage-caption">지금 위치와 이번에 넘어야 할 한 단계</span>
        ${planPanelLines(1)}
      </section>
      <section class="plan-panel project-boss-panel">
        <span class="template-label plan-panel-title" data-template-key="project-boss-heading">보스 미션</span>
        <span class="template-note plan-panel-caption" data-template-key="project-boss-caption">완료 여부가 명확한 중간 결과 3–5개</span>
        ${planPanelLines(6)}
      </section>
      <section class="plan-panel project-next-panel">
        <span class="template-label plan-panel-title" data-template-key="project-next-heading">다음 미션</span>
        <span class="template-note plan-panel-caption" data-template-key="project-next-caption">지금 바로 실행할 수 있는 행동, 최대 5개</span>
        ${planPanelLines(6)}
      </section>
      <section class="plan-panel project-learning-panel">
        <span class="template-label plan-panel-title" data-template-key="project-learning-heading">막힌 점 · 배운 점</span>
        <span class="template-note plan-panel-caption" data-template-key="project-learning-caption">장애물, 결정, 다음에 재사용할 지식</span>
        ${planPanelLines(3)}
      </section>`;
  }

  function metricTrackerTemplate(title) {
    const metricRows = range(3, index => `
      <div class="tracker-table-row" style="top:${70 + index * 42}px">
        <span></span><span></span><span></span><span></span>
      </div>`).join("");
    const weekRows = range(4, index => `
      <span class="template-note tracker-week-label" data-template-key="tracker-week-${index + 1}" style="top:${67 + index * 31}px">${index + 1}주</span>
      <span class="template-line tracker-week-line" style="top:${82 + index * 31}px"></span>`).join("");
    return titleBlock(
      title,
      "METRIC & HABIT · 결과는 기간으로, 행동은 하루 단위로",
      "tracker"
    ) + `
      <section class="plan-panel tracker-result-panel">
        <span class="template-label plan-panel-title" data-template-key="tracker-result-heading">이번 기간 결과 목표</span>
        <span class="template-note plan-panel-caption" data-template-key="tracker-result-caption">기간 · 결과 지표 · 달성 기준을 한 문장으로</span>
        ${planPanelLines(2)}
      </section>
      <section class="plan-panel tracker-metric-panel">
        <span class="template-label plan-panel-title" data-template-key="tracker-metric-heading">측정 지표</span>
        <div class="tracker-table-head">
          <span data-template-key="tracker-metric-name">지표</span>
          <span data-template-key="tracker-metric-start">시작</span>
          <span data-template-key="tracker-metric-target">목표</span>
          <span data-template-key="tracker-metric-cycle">확인 주기</span>
        </div>
        ${metricRows}
      </section>
      <section class="plan-panel tracker-week-panel">
        <span class="template-label plan-panel-title" data-template-key="tracker-week-heading">주간 기준</span>
        <span class="template-note plan-panel-caption" data-template-key="tracker-week-caption">매주 지킬 행동량과 확인할 결과</span>
        ${weekRows}
      </section>
      <section class="plan-panel tracker-daily-panel">
        <span class="template-label plan-panel-title" data-template-key="tracker-daily-heading">하루 미션</span>
        <span class="template-note plan-panel-caption" data-template-key="tracker-daily-caption">내가 통제할 수 있는 행동 1–3개</span>
        ${planPanelLines(4)}
      </section>
      <section class="plan-panel tracker-rule-panel">
        <span class="template-label plan-panel-title" data-template-key="tracker-rule-heading">실행 원칙</span>
        <span class="template-note plan-panel-caption" data-template-key="tracker-rule-caption">반복할 기본 행동과 예외 상황의 기준</span>
        ${planPanelLines(4)}
      </section>`;
  }

  function lifeAreaMapTemplate(title) {
    const system = currentGoalSystem();
    const cards = system.areas.slice(0, 6).map(area => {
      const goals = system.goals.filter(goal => goal.areaId === area.id);
      const activeGoals = goals.filter(goal => goal.status === "active");
      const goalRows = activeGoals.slice(0, 3).map(goal => {
        const progress = goalProgressData(goal);
        return `<div class="life-map-goal-row">
          <span data-goal-entity="goal" data-goal-id="${escapeHtml(goal.id)}" data-goal-field="title">${escapeHtml(goal.title)}</span>
          <strong data-goal-editor-kind="goal" data-goal-editor-id="${escapeHtml(goal.id)}">${Math.round(progress.percent)}%</strong>
        </div>`;
      }).join("");
      return `<article class="life-map-card">
        <header><strong data-goal-entity="area" data-goal-id="${escapeHtml(area.id)}" data-goal-field="name">${escapeHtml(area.name)}</strong><span data-goal-editor-kind="area" data-goal-editor-id="${escapeHtml(area.id)}">${activeGoals.length}개 진행 중</span></header>
        <p data-goal-entity="area" data-goal-id="${escapeHtml(area.id)}" data-goal-field="purpose" data-goal-placeholder="true">${escapeHtml(area.purpose || "유지 기준을 목표·미션 관리에서 적어보세요.")}</p>
        <div class="life-map-goals">${goalRows || `<span class="life-map-empty-row" data-template-key="life-map-empty-goals-${escapeHtml(area.id)}">아직 결과 목표가 없습니다</span>`}</div>
      </article>`;
    }).join("");
    const overflow = system.areas.length > 6
      ? `<p class="life-map-overflow">목표·미션 관리에 ${system.areas.length - 6}개 영역이 더 있습니다.</p>`
      : "";
    return titleBlock(
      title,
      "LIFE AREAS · 유지할 삶의 영역을 결과 목표와 오늘의 미션으로 연결",
      "life-map"
    ) + `<section class="life-map-grid">${cards || `
      <div class="life-map-empty">
        <strong data-template-key="life-map-empty-heading">먼저 인생 영역을 만들어 보세요</strong>
        <span data-template-key="life-map-empty-caption">예: 건강 · 일과 전문성 · 관계 · 생활 기반 · 성장</span>
      </div>`}</section>${overflow}`;
  }

  function goalDetailTemplate(title, page) {
    const goal = outcomeGoalById(page.goalId);
    if (!goal) {
      return titleBlock(title, "GOAL MISSION · 연결된 목표를 찾을 수 없습니다", "goal-detail") + `
        <section class="goal-detail-missing">
          <strong data-template-key="goal-detail-missing-heading">이 페이지의 결과 목표가 삭제되었거나 아직 연결되지 않았습니다.</strong>
          <span data-template-key="goal-detail-missing-caption">목표·미션 관리에서 목표 페이지를 다시 열어 주세요.</span>
        </section>`;
    }
    const area = areaForGoal(goal);
    const missions = currentGoalSystem().missions.filter(mission => mission.goalId === goal.id);
    const progress = goalProgressData(goal);
    const range = weekRangeFor(new Date());
    const missionRows = missions.map(mission => {
      const complete = missionCompletionCount(mission.id, range.start, range.end);
      const target = missionWeeklyExpectation(mission, range);
      return `<li class="goal-detail-mission ${mission.active ? "" : "inactive"}">
        <span data-goal-entity="mission" data-goal-id="${escapeHtml(mission.id)}" data-goal-field="title">${escapeHtml(mission.title)}</span>
        <small data-goal-editor-kind="mission" data-goal-editor-id="${escapeHtml(mission.id)}">${escapeHtml(missionScheduleLabel(mission))}${target ? ` · 이번 주 ${complete}/${target}` : ""}</small>
      </li>`;
    }).join("");
    const metric = goal.metricName
      ? `${goal.metricName} · ${goal.currentValue ?? "-"}${goal.unit || ""} → ${goal.targetValue ?? "-"}${goal.unit || ""}`
      : progress.label;
    return titleBlock(
      title,
      `${area?.name || "인생 영역"} · GOAL MISSION`,
      "goal-detail"
    ) + `<section class="goal-detail-summary">
        <div class="goal-detail-status-row">
          <span data-goal-editor-kind="goal" data-goal-editor-id="${escapeHtml(goal.id)}">${escapeHtml(goal.status === "completed" ? "달성" : goal.status === "paused" ? "잠시 멈춤" : "진행 중")}</span>
          <strong data-goal-editor-kind="goal" data-goal-editor-id="${escapeHtml(goal.id)}">${Math.round(progress.percent)}%</strong>
        </div>
        <div class="goal-detail-progress"><i style="width:${progress.percent}%"></i></div>
        <p data-goal-entity="goal" data-goal-id="${escapeHtml(goal.id)}" data-goal-field="result" data-goal-placeholder="true">${escapeHtml(goal.result || "달성 기준을 목표·미션 관리에서 구체적으로 적어보세요.")}</p>
        <dl>
          <div><dt data-template-key="goal-detail-metric-label">측정</dt><dd data-goal-editor-kind="goal" data-goal-editor-id="${escapeHtml(goal.id)}">${escapeHtml(metric)}</dd></div>
          <div><dt data-template-key="goal-detail-due-label">기한</dt><dd data-goal-editor-kind="goal" data-goal-editor-id="${escapeHtml(goal.id)}">${escapeHtml(goal.dueDate || "기한 없음")}</dd></div>
        </dl>
      </section>
      <section class="goal-detail-missions">
        <header><strong data-template-key="goal-detail-mission-heading">반복·실행 미션</strong><span data-template-key="goal-detail-mission-caption">완료는 일간 계획의 × 상태로 집계됩니다</span></header>
        <ul>${missionRows || "<li class=\"goal-detail-mission-empty\" data-template-key=\"goal-detail-mission-empty\">아직 연결된 미션이 없습니다.</li>"}</ul>
      </section>`;
  }

  function futureTemplate(title, months) {
    const columns = months.map((month, index) => `
      <div class="template-month" style="left:${index * 16.6667}%;width:16.6667%">
        <div class="template-month-title" data-template-key="future-month-${index}">${month}월</div>
      </div>`).join("");
    const dayNumbers = Array.from({length: 31}, (_, i) =>
      `<span class="template-note" data-template-key="future-day-${i + 1}" style="left:35px;top:${184 + i * 32}px">${i + 1}</span>`).join("");
    return titleBlock(title, "FUTURE LOG · 날짜가 정해진 미래 일정을 기록", "future") + columns + dayNumbers;
  }

  function yearCalendarTemplate(page) {
    const year = clamp(Math.round(Number(page.year) || new Date().getFullYear()), 1900, 2200);
    const months = yearCalendarMonths(page);
    const calendars = months.map(month => {
      const first = new Date(year, month - 1, 1);
      const startOffset = (first.getDay() + 6) % 7;
      const days = new Date(year, month, 0).getDate();
      const blanks = Array.from({ length: startOffset }, () => "<span class=\"year-calendar-blank\"></span>").join("");
      const cells = Array.from({ length: days }, (_, index) => {
        const day = index + 1;
        const date = isoDate(new Date(year, month - 1, day));
        const events = calendarEventsForDate(date);
        const summary = events.map(event => event.title).join(" · ");
        return `<button type="button" class="year-calendar-day ${events.length ? "has-events" : ""}" data-calendar-date="${date}" title="${escapeHtml(summary)}">
          <span>${day}</span>${events.length ? `<small>○${events.length > 1 ? events.length : ""} ${escapeHtml(summary)}</small>` : ""}
        </button>`;
      }).join("");
      return `<section class="year-calendar-month">
        <header><strong>${month}월</strong><span>${year}.${String(month).padStart(2, "0")}</span></header>
        <div class="year-calendar-weekdays">${["월","화","수","목","금","토","일"].map(day => `<span>${day}</span>`).join("")}</div>
        <div class="year-calendar-days">${blanks}${cells}</div>
      </section>`;
    }).join("");
    const range = yearCalendarRangeLabel(months);
    // 쪽마다 담는 달 수가 달라도 칸이 찌그러지지 않도록 행 수를 함께 넘긴다.
    const rows = Math.max(1, Math.ceil(months.length / 2));
    return fixedDateTitleBlock(
      `<span class="fixed-date-value">${year}</span>년 연간 계획 · ${range}`,
      "YEARLY CALENDAR · ○ 일정을 누르면 모든 날짜 계획에 연동됩니다",
      "year-calendar",
      "연간 달력 연도 변경"
    ) + `<div class="year-calendar-grid${months.length === 1 ? " single" : ""}${months.length > 4 ? " dense" : ""}" style="--year-calendar-rows:${rows}">${calendars}</div>`;
  }

  function monthlyTemplate(title, page) {
    const { year, month, hasCalendarDate } = monthlyDateContext(page);
    const days = monthlyDayCount(page);
    const rows = Array.from({length: days}, (_, i) => {
      const y = 165 + i * 32;
      const dateText = hasCalendarDate
        ? `${i + 1}(${["일","월","화","수","목","금","토"][new Date(year, month - 1, i + 1).getDay()]})`
        : `${i + 1}`;
      const date = hasCalendarDate ? isoDate(new Date(year, month - 1, i + 1)) : "";
      const summary = date ? calendarEventSummary(date, 42) : "";
      // `현재 페이지 쓰기`로 만든 박스는 그 자체가 일정 원본으로 잡히므로,
      // 같은 줄에 요약까지 그리면 같은 글자가 두 번 겹쳐 보인다.
      const rowY = 164 + i * 32;
      const covered = page.elements.some(element =>
        element.type === "text" &&
        (element.layoutTarget === "monthly-schedule" || element.gridLocked) &&
        Math.abs((Number(element.y) || 0) - rowY) <= GRID_SIZE / 2
      );
      return `<button type="button" class="template-note fixed-monthly-day" data-fixed-date="true" ${date ? `data-calendar-date="${date}"` : "disabled"} style="left:58px;top:${y}px;width:55px">${dateText}</button>
        <span class="template-line" style="left:112px;right:272px;top:${y + 25}px;background:rgba(55,53,48,.15)"></span>
        ${date && !covered ? `<button type="button" class="monthly-calendar-summary" data-calendar-date="${date}" style="left:120px;top:${y}px;width:264px">${escapeHtml(summary)}</button>` : ""}`;
    }).join("");
    const monthlySubtitle = hasCalendarDate
      ? `${year}년 ${month}월 · MONTHLY SPREAD`
      : year ? `${year}년 · MONTHLY SPREAD` : "MONTHLY SPREAD";
    const monthTitle = month ? `${month}월 월간 계획` : `<span class="fixed-date-empty"> </span>월 월간 계획`;
    return fixedDateTitleBlock(monthTitle, monthlySubtitle, "monthly", "월간 계획 연도와 월 변경") + rows +
      `<span class="template-vline" style="right:242px;top:160px;bottom:74px"></span>
       <span class="template-label" data-template-key="monthly-goal-heading" style="right:74px;top:165px;font-size:17px;line-height:22px">이번 달 목표</span>
       <span class="template-note" data-template-key="monthly-goal-1" style="right:90px;top:229px;font-size:15px;line-height:22px">• 목표 1</span>
       <span class="template-note" data-template-key="monthly-goal-2" style="right:90px;top:261px;font-size:15px;line-height:22px">• 목표 2</span>
       <span class="template-note" data-template-key="monthly-goal-3" style="right:90px;top:293px;font-size:15px;line-height:22px">• 목표 3</span>
       <span class="template-label" data-template-key="monthly-queue" style="right:91px;top:389px;font-size:17px;line-height:22px">Queue</span>`;
  }

  function weeklyTemplate(title, page) {
    const start = page.weekStart ? dateFromIso(page.weekStart) : null;
    const offsets = page.type === "weekly-left" ? [0,1,2,3] : [4,5,6];
    const hasOverview = offsets.includes(0);
    const weekdayNames = ["월", "화", "수", "목", "금", "토", "일"];
    const width = 100 / offsets.length;
    const columns = offsets.map((offset, index) => {
      const date = start ? isoDate(offsetDate(start, offset)) : "";
      const label = start ? dayLabel(offsetDate(start, offset)) : weekdayNames[offset];
      return `<div class="template-day-column ${index === 0 ? "first" : ""} ${hasOverview ? "with-overview" : "without-overview"}" style="left:${index * width}%;width:${width}%">
        <button type="button" class="template-day-title fixed-weekly-day" data-fixed-date="true" ${date ? `data-calendar-date="${date}"` : "disabled"}>${label}</button>
      </div>`;
    }).join("");
    // ○ 일정을 날짜 제목 밑에 9px 한 줄로 우겨넣지 않고, 요일 칸 안에 손으로
    // 쓴 기록과 같은 크기·같은 모눈 줄을 하나씩 차지하도록 놓는다.
    // 칸(div) 안이 아니라 페이지 좌표에 직접 놓아야 모눈에 정확히 맞는다.
    const eventRows = start
      ? offsets
        .flatMap(offset => weeklyColumnEventRects(page, offset)
          .map(rect => calendarEventRowHtml(rect, isoDate(offsetDate(start, offset)))))
        .join("")
      : "";
    const overview = hasOverview ? `
      <div class="weekly-overview">
        <span class="template-label weekly-overview-title" data-template-key="weekly-overview-heading">이번 주 종합 계획</span>
        <span class="template-line weekly-overview-line line-1"></span>
        <span class="template-line weekly-overview-line line-2"></span>
        <span class="template-line weekly-overview-line line-3"></span>
      </div>` : "";
    // overview를 columns 뒤에 두어 기존 주간 날짜 텍스트의 편집 필드 순서를 보존한다.
    return fixedDateTitleBlock(
      escapeHtml(weeklyPageTitle(page)),
      start ? `WEEKLY SPREAD · ${dailyDateLabel(start)} 시작` : "WEEKLY SPREAD · 시작 날짜를 선택하세요",
      "weekly",
      "주간 계획 시작 날짜 변경"
    ) +
      columns + overview + eventRows;
  }

  function dailyTemplate(title, page) {
    const date = page.pageDate ? dateFromIso(page.pageDate) : null;
    const dateLabel = date ? dailyDateLabel(date) : " 월 일";
    const displayDateLabel = continuedPageLabel(page, dateLabel);
    const dateValue = date ? isoDate(date) : "";
    const ruledLines = Array.from({ length: 21 }, (_, index) => {
      const y = 236 + index * 42;
      return `<span class="template-line daily-split-line left" style="top:${y}px"></span>
        <span class="template-line daily-split-line right" style="top:${y}px"></span>`;
    }).join("");
    // ○ 일정을 제목 위 별도 띠에 몰아 보여주지 않고, 할 일/오늘의 기록 칸
    // 안에 다른 손글씨 기록과 같은 자리(같은 줄 하나)를 차지하도록 놓는다.
    const eventRows = dateValue
      ? ["daily-todo", "daily-log"]
        .flatMap(columnId => dailyColumnEventRects(page, columnId))
        .map(rect => calendarEventRowHtml(rect, dateValue))
        .join("")
      : "";
    return fixedDateTitleBlock(
      escapeHtml(displayDateLabel),
      date ? `DAILY PLAN · ${displayDateLabel}` : "DAILY PLAN · 날짜를 선택하세요",
      "daily",
      "일간 계획 날짜 변경"
    ) + `
      <section class="daily-split">
        <div class="daily-split-heading left">
          <span class="template-label" data-template-key="daily-todo-heading">할 일</span>
          <span class="daily-split-caption" data-template-key="daily-todo-caption">TO DO</span>
        </div>
        <div class="daily-split-heading right">
          <span class="template-label" data-template-key="daily-log-heading">오늘의 기록</span>
          <span class="daily-split-caption" data-template-key="daily-log-caption">TODAY LOG</span>
        </div>
        <span class="template-vline daily-split-divider"></span>
        ${ruledLines}
      </section>
      ${eventRows}`;
  }

  function feedbackTemplate(title) {
    return titleBlock(title, "한 주가 끝나면 짧게 돌아보고 다음 행동을 정합니다", "feedback") + `
      <span class="template-label" data-template-key="feedback-good" style="left:62px;top:160px;font-size:19px">잘한 것</span>
      <span class="template-line" style="left:62px;right:62px;top:205px"></span>
      <span class="template-line" style="left:62px;right:62px;top:250px"></span>
      <span class="template-label" data-template-key="feedback-hard" style="left:62px;top:318px;font-size:19px">어려웠던 것</span>
      <span class="template-line" style="left:62px;right:62px;top:363px"></span>
      <span class="template-line" style="left:62px;right:62px;top:408px"></span>
      <span class="template-label" data-template-key="feedback-learn" style="left:62px;top:476px;font-size:19px">배운 것</span>
      <span class="template-line" style="left:62px;right:62px;top:521px"></span>
      <span class="template-line" style="left:62px;right:62px;top:566px"></span>
      <span class="template-label" data-template-key="feedback-change" style="left:62px;top:634px;font-size:19px">다음에 바꿀 한 가지</span>
      <span class="template-line" style="left:62px;right:62px;top:679px"></span>
      <span class="template-label" data-template-key="feedback-back" style="left:62px;top:758px;font-size:19px">Back → 연결되는 목표/페이지</span>
      <span class="template-line" style="left:62px;right:62px;top:803px"></span>`;
  }

  function pagePoint(event, pageEl) {
    const rect = pageEl.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) * PAGE_W / rect.width, 0, PAGE_W),
      y: clamp((event.clientY - rect.top) * PAGE_H / rect.height, 0, PAGE_H),
    };
  }

  function onPagePointerDown(event, page, svg, elements) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    activePageId = page.id;
    if (event.target.closest(".text-element")) return;
    if (event.target.closest(".template-editable")) return;
    selection = null;
    if (tool === "text") {
      startTextBoxCreate(event, page, elements);
      return;
    }
    if (tool === "pen" || tool === "highlight" || tool === "line") {
      event.preventDefault();
      startDrawing(event, page, svg);
      return;
    }
    if (tool === "select") clearElementSelectionVisuals();
  }

  function startTextBoxCreate(event, page, elements) {
    const pageEl = event.currentTarget?.classList?.contains("journal-page")
      ? event.currentTarget : event.target.closest(".journal-page");
    if (!pageEl || !elements) return;

    event.preventDefault();
    const start = pagePoint(event, pageEl);
    const pointerId = event.pointerId;
    let element = null;
    let node = null;

    const updateBox = point => {
      const x = Math.min(start.x, point.x);
      const y = Math.min(start.y, point.y);
      const width = Math.max(18, Math.abs(point.x - start.x));
      const height = Math.max(8, Math.abs(point.y - start.y));

      if (!element) {
        element = makeText(x, y, "", {
          width,
          height,
          color: refs.color.value,
          fontSize: clamp(Number(refs.fontSize.value) || 18, 4, 120),
        });
        element.fixedSize = true;
        page.elements.push(element);
        selection = { pageId: page.id, elementId: element.id };
        node = renderTextElement(page, element);
        node.classList.add("creating");
        elements.append(node);
      }

      Object.assign(element, { x, y, width, height });
      Object.assign(node.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
    };

    const move = moveEvent => {
      if (pointerId != null && moveEvent.pointerId != null && moveEvent.pointerId !== pointerId) return;
      const point = pagePoint(moveEvent, pageEl);
      if (!element && Math.hypot(point.x - start.x, point.y - start.y) < 5) return;
      updateBox(point);
    };

    const finish = upEvent => {
      if (pointerId != null && upEvent.pointerId != null && upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (!element) return;

      commitHistory();
      renderSpread();
      requestAnimationFrame(() => {
        const created = $(`[data-element-id="${element.id}"]`);
        const content = created?.querySelector(".text-content");
        content?.focus();
        placeCaretAtEnd(content);
      });
    };

    const cancel = cancelEvent => {
      if (pointerId != null && cancelEvent.pointerId != null && cancelEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (element) page.elements = page.elements.filter(item => item.id !== element.id);
      selection = null;
      renderSpread();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  }

  function placeCaretAtEnd(element) {
    if (!element) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function placeCaretAtPoint(element, clientX, clientY) {
    if (!element) return;
    let range = document.caretRangeFromPoint?.(clientX, clientY) || null;
    if (!range && document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    }
    if (!range || !element.contains(range.startContainer)) {
      placeCaretAtEnd(element);
      return;
    }
    const selectionAtPoint = window.getSelection();
    selectionAtPoint.removeAllRanges();
    selectionAtPoint.addRange(range);
  }

  function startTextDrag(event, page, element, node) {
    selection = { pageId: page.id, elementId: element.id };
    const pageEl = node.closest(".journal-page");
    const start = pagePoint(event, pageEl);
    const origin = { x: element.x, y: element.y };
    const pointerId = event.pointerId;
    let moved = false;
    const move = moveEvent => {
      if (pointerId != null && moveEvent.pointerId !== pointerId) return;
      const point = pagePoint(moveEvent, pageEl);
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      const maxX = Math.max(0, PAGE_W - Math.max(18, Number(element.width) || 18));
      const maxY = Math.max(0, PAGE_H - Math.max(8, Number(element.height) || 8));
      element.x = element.gridLocked
        ? snapToGrid(origin.x + dx, 0, maxX)
        : clamp(origin.x + dx, 0, maxX);
      element.y = element.gridLocked
        ? snapToGrid(origin.y + dy, 0, maxY)
        : clamp(origin.y + dy, 0, maxY);
      node.style.left = `${element.x}px`;
      node.style.top = `${element.y}px`;
    };
    const finish = finishEvent => {
      if (pointerId != null && finishEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (moved) commitHistory();
      renderSpread();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function startTextResize(event, page, element, node, direction = "se") {
    selection = { pageId: page.id, elementId: element.id };
    const pageEl = node.closest(".journal-page");
    if (!pageEl) return;

    const start = pagePoint(event, pageEl);
    const origin = {
      width: Math.max(18, Number(element.width) || 260),
      height: Math.max(8, Number(element.height) || 34),
      x: Number(element.x) || 0,
      y: Number(element.y) || 0,
    };
    // 손잡이로 조절한 크기는 이후 글자 입력에서 autoGrow가 덮어쓰지 않도록 고정한다.
    element.fixedSize = true;
    const pointerId = event.pointerId;
    let resized = false;

    const move = moveEvent => {
      if (pointerId != null && moveEvent.pointerId !== pointerId) return;
      const point = pagePoint(moveEvent, pageEl);
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      let x = origin.x;
      let y = origin.y;
      let width = origin.width;
      let height = origin.height;

      if (direction.includes("e")) {
        width = clamp(origin.width + dx, 18, PAGE_W - origin.x);
      }
      if (direction.includes("s")) {
        height = clamp(origin.height + dy, 8, PAGE_H - origin.y);
      }
      if (direction.includes("w")) {
        x = clamp(origin.x + dx, 0, origin.x + origin.width - 18);
        width = origin.width + origin.x - x;
      }
      if (direction.includes("n")) {
        y = clamp(origin.y + dy, 0, origin.y + origin.height - 8);
        height = origin.height + origin.y - y;
      }

      if (element.gridLocked) {
        const right = origin.x + origin.width;
        const bottom = origin.y + origin.height;
        if (direction.includes("w")) {
          x = snapToGrid(x, 0, Math.max(0, right - GRID_SIZE));
          width = right - x;
        } else if (direction.includes("e")) {
          width = Math.min(snapSizeToGrid(width), PAGE_W - x);
        }
        if (direction.includes("n")) {
          y = snapToGrid(y, 0, Math.max(0, bottom - GRID_SIZE));
          height = bottom - y;
        } else if (direction.includes("s")) {
          height = Math.min(snapSizeToGrid(height), PAGE_H - y);
        }
      }

      if (Math.abs(x - origin.x) + Math.abs(y - origin.y) +
          Math.abs(width - origin.width) + Math.abs(height - origin.height) > 0.5) {
        resized = true;
      }
      element.x = Math.round(x * 10) / 10;
      element.y = Math.round(y * 10) / 10;
      element.width = Math.round(width * 10) / 10;
      element.height = Math.round(height * 10) / 10;
      node.style.left = `${element.x}px`;
      node.style.top = `${element.y}px`;
      node.style.width = `${element.width}px`;
      node.style.height = `${element.height}px`;
    };

    const finish = finishEvent => {
      if (pointerId != null && finishEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (resized) commitHistory();
      renderSpread();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function startDrawing(event, page, svg) {
    const pageEl = svg.closest(".journal-page");
    const point = pagePoint(event, pageEl);
    const isLine = tool === "line";
    const isHighlight = tool === "highlight";
    const element = {
      id: uid(),
      type: isLine ? "line" : "stroke",
      points: isLine ? [point, point] : [point],
      color: isHighlight ? refs.color.value : refs.color.value,
      width: isHighlight ? Math.max(10, Number(refs.strokeSize.value) * 2.3) : Number(refs.strokeSize.value),
      opacity: isHighlight ? 0.36 : 1,
    };
    page.elements.push(element);

    const live = renderStrokeElement(page, element);
    svg.append(live);
    drawing = { page, element, live, pageEl, pointerId: event.pointerId };
    pageEl.setPointerCapture?.(event.pointerId);

    const move = moveEvent => {
      if (!drawing) return;
      const next = pagePoint(moveEvent, pageEl);
      if (isLine) {
        element.points[1] = next;
        live.setAttribute("x2", next.x);
        live.setAttribute("y2", next.y);
      } else {
        const last = element.points[element.points.length - 1];
        const distance = Math.hypot(next.x - last.x, next.y - last.y);
        if (distance < 1.7) return;
        element.points.push(next);
        live.setAttribute("d", pathFromPoints(element.points));
      }
    };
    const up = upEvent => {
      pageEl.removeEventListener("pointermove", move);
      pageEl.removeEventListener("pointerup", up);
      pageEl.removeEventListener("pointercancel", cancel);
      pageEl.releasePointerCapture?.(upEvent.pointerId);
      drawing = null;
      commitHistory();
      renderAll();
    };
    const cancel = () => {
      page.elements = page.elements.filter(item => item.id !== element.id);
      drawing = null;
      renderSpread();
    };
    pageEl.addEventListener("pointermove", move);
    pageEl.addEventListener("pointerup", up);
    pageEl.addEventListener("pointercancel", cancel);
  }

  function removeElement(page, elementId) {
    page.elements = page.elements.filter(item => item.id !== elementId);
    selection = null;
    commitHistory();
    renderAll();
  }

  function removeSelection() {
    if (!selection) return;
    const page = book.pages.find(item => item.id === selection.pageId);
    if (!page) return;
    removeElement(page, selection.elementId);
  }

  function selectedElementContext() {
    if (!selection) return null;
    const page = book.pages.find(item => item.id === selection.pageId);
    const element = page?.elements.find(item => item.id === selection.elementId);
    return page && element ? { page, element } : null;
  }

  function offsetElementCopy(source, offset = 12) {
    const copy = clone(source);
    copy.id = uid();
    if (copy.type === "text") {
      const appliedOffset = copy.gridLocked ? GRID_SIZE : offset;
      const maxX = PAGE_W - Math.max(18, Number(copy.width) || 18);
      const maxY = PAGE_H - Math.max(8, Number(copy.height) || 8);
      const nextX = (Number(copy.x) || 0) + appliedOffset;
      const nextY = (Number(copy.y) || 0) + appliedOffset;
      copy.x = copy.gridLocked
        ? snapToGrid(nextX, 0, maxX)
        : clamp(nextX, 0, maxX);
      copy.y = copy.gridLocked
        ? snapToGrid(nextY, 0, maxY)
        : clamp(nextY, 0, maxY);
    } else if (Array.isArray(copy.points) && copy.points.length) {
      const minX = Math.min(...copy.points.map(point => point.x));
      const maxX = Math.max(...copy.points.map(point => point.x));
      const minY = Math.min(...copy.points.map(point => point.y));
      const maxY = Math.max(...copy.points.map(point => point.y));
      const dx = clamp(offset, -minX, PAGE_W - maxX);
      const dy = clamp(offset, -minY, PAGE_H - maxY);
      copy.points = copy.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
    }
    return copy;
  }

  function copySelection(cut = false) {
    const context = selectedElementContext();
    if (!context) return;
    elementClipboard = clone(context.element);
    if (cut) {
      removeElement(context.page, context.element.id);
      showToast("잘라냈습니다");
    } else {
      showToast("복사했습니다");
    }
  }

  function pasteSelection() {
    if (!elementClipboard) return;
    const page =
      book.pages.find(item => item.id === activePageId) ||
      book.pages.find(item => item.id === selection?.pageId) ||
      book.pages[currentIndex];
    const pasted = offsetElementCopy(elementClipboard);
    page.elements.push(pasted);
    activePageId = page.id;
    selection = { pageId: page.id, elementId: pasted.id };
    elementClipboard = clone(pasted);
    commitHistory();
    renderAll();
  }

  function duplicateSelection() {
    const context = selectedElementContext();
    if (!context) return;
    const duplicated = offsetElementCopy(context.element);
    context.page.elements.push(duplicated);
    activePageId = context.page.id;
    selection = { pageId: context.page.id, elementId: duplicated.id };
    commitHistory();
    renderAll();
  }

  function nudgeSelection(dx, dy) {
    const context = selectedElementContext();
    if (!context) return false;
    const { element } = context;
    if (element.type === "text") {
      const appliedDx = element.gridLocked && dx ? Math.sign(dx) * GRID_SIZE : dx;
      const appliedDy = element.gridLocked && dy ? Math.sign(dy) * GRID_SIZE : dy;
      const maxX = PAGE_W - Math.max(18, Number(element.width) || 18);
      const maxY = PAGE_H - Math.max(8, Number(element.height) || 8);
      element.x = element.gridLocked
        ? snapToGrid((Number(element.x) || 0) + appliedDx, 0, maxX)
        : clamp((Number(element.x) || 0) + appliedDx, 0, maxX);
      element.y = element.gridLocked
        ? snapToGrid((Number(element.y) || 0) + appliedDy, 0, maxY)
        : clamp((Number(element.y) || 0) + appliedDy, 0, maxY);
    } else if (Array.isArray(element.points) && element.points.length) {
      const minX = Math.min(...element.points.map(point => point.x));
      const maxX = Math.max(...element.points.map(point => point.x));
      const minY = Math.min(...element.points.map(point => point.y));
      const maxY = Math.max(...element.points.map(point => point.y));
      const safeDx = clamp(dx, -minX, PAGE_W - maxX);
      const safeDy = clamp(dy, -minY, PAGE_H - maxY);
      element.points.forEach(point => {
        point.x += safeDx;
        point.y += safeDy;
      });
    } else {
      return false;
    }
    commitHistory();
    renderSpread();
    return true;
  }

  function editSelectedText() {
    const context = selectedElementContext();
    if (!context || context.element.type !== "text") return false;
    const node = $(`[data-element-id="${context.element.id}"]`, refs.spread);
    const content = node?.querySelector(".text-content");
    if (!content) return false;
    content.contentEditable = "true";
    content.focus();
    placeCaretAtEnd(content);
    return true;
  }

  function syncFontSizeControl(element) {
    if (!element || element.type !== "text") return;
    refs.fontSize.value = String(Math.round((Number(element.fontSize) || 18) * 10) / 10);
  }

  function applyFontSizeControl() {
    const context = selectedElementContext();
    if (!context || context.element.type !== "text") return false;
    const size = clamp(Number(refs.fontSize.value) || 18, 4, 120);
    refs.fontSize.value = String(size);
    context.element.fontSize = size;
    const node = $(`[data-element-id="${context.element.id}"]`, refs.spread);
    if (node) node.style.fontSize = `${size}px`;
    markDirty();
    return true;
  }

  function changeSelectedFont(delta) {
    const context = selectedElementContext();
    if (!context || context.element.type !== "text") return false;
    context.element.fontSize = clamp(
      Math.round((Number(context.element.fontSize) || 18) + delta),
      4,
      120
    );
    syncFontSizeControl(context.element);
    commitHistory();
    renderSpread();
    return true;
  }

  function stepFontSizeControl(delta) {
    if (changeSelectedFont(delta)) return;
    const current = Number(refs.fontSize.value);
    refs.fontSize.value = String(clamp(
      Math.round((Number.isFinite(current) ? current : 18) + delta),
      4,
      120
    ));
  }

  function cycleVisibleSelection(direction = 1) {
    const candidates = visibleIndexes().flatMap(index =>
      (book.pages[index]?.elements || []).map(element => ({
        page: book.pages[index],
        element,
      }))
    );
    if (!candidates.length) return;
    const current = candidates.findIndex(candidate =>
      candidate.page.id === selection?.pageId && candidate.element.id === selection?.elementId
    );
    const nextIndex = current < 0
      ? (direction > 0 ? 0 : candidates.length - 1)
      : (current + direction + candidates.length) % candidates.length;
    const next = candidates[nextIndex];
    activePageId = next.page.id;
    selection = { pageId: next.page.id, elementId: next.element.id };
    renderSpread();
  }

  function enableVisibleTextEditing() {
    $$(".template-editable, .text-content", refs.spread)
      .forEach(node => { node.contentEditable = "true"; });
  }

  function setTool(nextTool, shouldRender = true) {
    if (isAndroidApp && !advancedMobileEditing && MOBILE_ADVANCED_TOOLS.has(nextTool)) {
      showToast("고급 편집 모드에서 사용할 수 있습니다");
      return false;
    }
    tool = nextTool;
    refs.spread.dataset.tool = tool;
    if (tool !== "select" && tool !== "text") selection = null;
    if (tool === "highlight" && refs.color.value.toLowerCase() === "#20201d") refs.color.value = "#d9ff58";
    if (tool === "pen" && refs.color.value.toLowerCase() === "#d9ff58") refs.color.value = "#20201d";
    $$(".tool").forEach(button => button.classList.toggle("active", button.dataset.tool === tool));
    if (shouldRender) renderSpread();
    return true;
  }

  function transformCurrentText(transform) {
    const active = document.activeElement;
    if (active?.classList?.contains("text-content") && active.isContentEditable) {
      const before = active.innerText || active.textContent || "";
      const after = transform(before);
      if (after === before) return true;
      active.textContent = after;
      active.dispatchEvent(new Event("input", { bubbles: true }));
      placeCaretAtEnd(active);
      return true;
    }
    const context = selectedElementContext();
    if (!context || context.element.type !== "text") return false;
    const before = context.element.text || "";
    const after = transform(before);
    if (after === before) return true;
    context.element.text = after;
    commitHistory();
    renderAll();
    return true;
  }

  function applyBulletBase(base) {
    const changed = transformCurrentText(text =>
      replaceLeadingBullet(text, { base, status: "open" })
    );
    if (!changed) insertSymbol(BULLET_SYMBOLS[base]?.open || BULLET_SYMBOLS.dot.open);
    else {
      const labels = {
        dot: "할 일 •",
        circle: "일정·이벤트 ○",
        memo: "메모 −",
        idea: "아이디어 +",
      };
      showToast(`${labels[base] || "불렛"}로 표시했습니다`);
    }
  }

  function applyBulletStatus(status) {
    const labels = { migrated: "다음으로 이월", scheduled: "날짜를 정해 예정", completed: "완료" };
    let statusAllowed = true;
    const changed = transformCurrentText(text => {
      const info = bulletSymbolInfo(String(text || "").trimStart().charAt(0));
      if (info && info.base !== "dot" && info.base !== "circle") {
        statusAllowed = false;
        return text;
      }
      return replaceLeadingBullet(text, { status });
    });
    if (!changed) {
      showToast("상태를 바꿀 계획을 먼저 선택하세요");
      return;
    }
    if (!statusAllowed) {
      showToast("상태는 • 할 일과 ○ 일정에만 적용됩니다");
      return;
    }
    showToast(`${labels[status] || "상태"}로 표시했습니다`);
  }

  function insertSymbol(symbol) {
    const active = document.activeElement;
    if (active?.classList?.contains("text-content") && active.isContentEditable) {
      document.execCommand("insertText", false, `${symbol} `);
      active.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const page =
      book.pages.find(item => item.id === selection?.pageId) ||
      book.pages.find(item => item.id === activePageId) ||
      book.pages[currentIndex];
    activePageId = page.id;
    const y = 150 + (page.elements.filter(item => item.type === "text").length % 20) * 34;
    const element = makeText(74, y, `${symbol} `, {
      color: refs.color.value,
      width: 520,
      fontSize: clamp(Number(refs.fontSize.value) || 18, 4, 120),
    });
    page.elements.push(element);
    selection = { pageId: page.id, elementId: element.id };
    if (tool !== "select" && tool !== "text") setTool("select", false);
    commitHistory();
    renderAll();
    requestAnimationFrame(() => {
      const node = $(`[data-element-id="${element.id}"]`);
      const content = node?.querySelector(".text-content");
      content?.focus();
      placeCaretAtEnd(content);
    });
  }

  function mobileWriteTargetsForPage(page) {
    const base = { color: "#20201d", fontSize: 16 };
    if (page.type === "blank" && (isYearCalendarTemplate(page.planTemplate))) {
      const months = yearCalendarMonths(page);
      return months.map(month => ({
        ...base,
        id: `year-calendar-month-${month}`,
        icon: String(month),
        label: `${month}월 일정`,
        description: "날짜를 고르고 ○ 이벤트 입력",
        defaultSymbol: "○",
        placeholder: `${month}월 일정을 입력하세요`,
        submitLabel: `${month}월 일정에 추가`,
        hint: `${month}월 달력`,
        detail: "year-day",
        month,
        x: 58,
        width: 556,
        yStart: 160,
        rowGap: 30,
        maxRows: 1,
        fontSize: 12,
      }));
    }
    if (page.type === "blank" && page.planTemplate === "project") {
      return [
        {
          ...base, id: "project-clear", icon: "◎", label: "클리어 조건",
          description: "완료라고 판단할 결과", defaultSymbol: "•",
          placeholder: "프로젝트가 끝났다고 판단할 구체적인 결과를 적으세요",
          submitLabel: "클리어 조건에 추가", hint: "상단 ‘클리어 조건’의 다음 빈 줄",
          x: 58, width: 556, yStart: 184, rowGap: 31, maxRows: 2, fontSize: 15,
        },
        {
          ...base, id: "project-stage", icon: "→", label: "현재 단계",
          description: "지금 위치와 다음 관문", defaultSymbol: "−",
          placeholder: "현재 단계와 이번에 넘어야 할 관문을 적으세요",
          submitLabel: "현재 단계에 추가", hint: "‘현재 단계’의 다음 빈 줄",
          x: 58, width: 556, yStart: 342, rowGap: 31, maxRows: 1, fontSize: 15,
        },
        {
          ...base, id: "project-boss", icon: "B", label: "보스 미션",
          description: "중간 결과 3–5개", defaultSymbol: "•",
          placeholder: "완료 여부가 명확한 중간 결과를 적으세요",
          submitLabel: "보스 미션에 추가", hint: "왼쪽 ‘보스 미션’의 다음 빈 줄",
          x: 58, width: 246, yStart: 468, rowGap: 42, maxRows: 6, fontSize: 14,
        },
        {
          ...base, id: "project-next", icon: "N", label: "다음 미션",
          description: "바로 실행할 행동", defaultSymbol: "•",
          placeholder: "지금 바로 실행할 수 있는 행동을 적으세요",
          submitLabel: "다음 미션에 추가", hint: "오른쪽 ‘다음 미션’의 다음 빈 줄",
          x: 370, width: 242, yStart: 468, rowGap: 42, maxRows: 6, fontSize: 14,
        },
        {
          ...base, id: "project-learning", icon: "✦", label: "막힌 점·배운 점",
          description: "장애물·결정·지식", defaultSymbol: "−",
          placeholder: "막힌 이유, 내린 결정, 다음에 재사용할 지식을 적으세요",
          submitLabel: "기록에 추가", hint: "하단 ‘막힌 점 · 배운 점’의 다음 빈 줄",
          x: 58, width: 556, yStart: 786, rowGap: 31, maxRows: 3, fontSize: 14,
        },
      ];
    }
    if (page.type === "blank" && page.planTemplate === "tracker") {
      return [
        {
          ...base, id: "tracker-result", icon: "◎", label: "결과 목표",
          description: "기간과 달성 기준", defaultSymbol: "•",
          placeholder: "기간, 결과 지표, 달성 기준을 한 문장으로 적으세요",
          submitLabel: "결과 목표에 추가", hint: "상단 ‘이번 기간 결과 목표’의 다음 빈 줄",
          x: 58, width: 556, yStart: 184, rowGap: 31, maxRows: 2, fontSize: 15,
        },
        {
          ...base, id: "tracker-metric", icon: "#", label: "측정 기록",
          description: "현재·목표·확인 주기", defaultSymbol: "−",
          placeholder: "측정할 지표와 현재값, 목표값을 적으세요",
          submitLabel: "측정 지표에 추가", hint: "‘측정 지표’ 표의 다음 빈 줄",
          x: 58, width: 556, yStart: 348, rowGap: 42, maxRows: 3, fontSize: 13,
        },
        {
          ...base, id: "tracker-week", icon: "W", label: "주간 기준",
          description: "매주 지킬 행동량", defaultSymbol: "•",
          placeholder: "이번 주에 지킬 행동량과 확인할 결과를 적으세요",
          submitLabel: "주간 기준에 추가", hint: "‘주간 기준’의 다음 빈 줄",
          x: 106, width: 506, yStart: 558, rowGap: 31, maxRows: 4, fontSize: 14,
        },
        {
          ...base, id: "tracker-daily", icon: "D", label: "하루 미션",
          description: "통제 가능한 행동", defaultSymbol: "•",
          placeholder: "매일 반복할 핵심 행동 1–3개를 적으세요",
          submitLabel: "하루 미션에 추가", hint: "왼쪽 ‘하루 미션’의 다음 빈 줄",
          x: 58, width: 246, yStart: 762, rowGap: 36, maxRows: 4, fontSize: 14,
        },
        {
          ...base, id: "tracker-rule", icon: "R", label: "실행 원칙",
          description: "기본 행동과 예외 기준", defaultSymbol: "−",
          placeholder: "반복할 기본 행동과 예외 상황의 기준을 적으세요",
          submitLabel: "실행 원칙에 추가", hint: "오른쪽 ‘실행 원칙’의 다음 빈 줄",
          x: 370, width: 242, yStart: 762, rowGap: 36, maxRows: 4, fontSize: 14,
        },
      ];
    }
    if (page.type === "daily") {
      return [
        {
          ...base, id: "daily-todo", icon: "✓", label: "할 일",
          description: "오늘 해야 할 일", defaultSymbol: "•",
          placeholder: "오늘 해야 할 일을 입력하세요",
          submitLabel: "할 일에 추가", hint: "왼쪽 ‘할 일’의 다음 빈 줄",
          x: 58, width: 246, yStart: 202, rowGap: 42, maxRows: 21,
        },
        {
          ...base, id: "daily-log", icon: "✦", label: "오늘의 기록",
          description: "한 일·얻은 정보·배운 점", defaultSymbol: "−",
          placeholder: "오늘 한 일, 얻은 정보나 배운 점을 적으세요",
          submitLabel: "오늘의 기록에 추가", hint: "오른쪽 ‘오늘의 기록’의 다음 빈 줄",
          x: 374, width: 238, yStart: 202, rowGap: 42, maxRows: 21,
        },
      ];
    }
    if (page.type === "weekly-left" || page.type === "weekly-right") {
      const start = page.weekStart ? dateFromIso(page.weekStart) : null;
      const offsets = page.type === "weekly-left" ? [0, 1, 2, 3] : [4, 5, 6];
      const fallbackNames = ["월", "화", "수", "목", "금", "토", "일"];
      const columnWidth = PAGE_W / offsets.length;
      const overviewTargets = page.type === "weekly-left"
        ? [{
            ...base, id: "weekly-overview", icon: "◎", label: "주간 종합 계획",
            description: "이번 주의 핵심 결과", defaultSymbol: "•",
            placeholder: "이번 주에 반드시 끝낼 결과를 적으세요",
            submitLabel: "종합 계획에 추가", hint: "상단 ‘주간 종합 계획’의 다음 빈 줄",
            x: 58, width: 556, yStart: 174, rowGap: 31, maxRows: 3, fontSize: 15,
          }]
        : [];
      return [
        ...overviewTargets,
        ...offsets.map((offset, index) => ({
          ...base,
          id: `weekly-day-${offset}`,
          icon: fallbackNames[offset],
          label: start ? dayLabel(offsetDate(start, offset)) : fallbackNames[offset],
          description: "해당 요일 계획과 기록",
          defaultSymbol: "•",
          placeholder: "이날의 할 일이나 일정을 입력하세요",
          submitLabel: `${fallbackNames[offset]}요일에 추가`,
          hint: "선택한 요일 칸의 다음 빈 줄",
          x: index * columnWidth + 14,
          width: columnWidth - 28,
          yStart: 342,
          rowGap: 38,
          maxRows: 21,
          fontSize: 14,
        })),
      ];
    }
    if (page.type === "monthly") {
      return [
        {
          ...base, id: "monthly-schedule", icon: "31", label: "날짜별 일정",
          description: "날짜를 고르고 일정 입력", defaultSymbol: "○",
          placeholder: "선택한 날짜의 일정이나 메모를 입력하세요",
          submitLabel: "선택한 날짜에 추가", hint: "선택한 날짜의 일정 줄",
          detail: "month-day", compact: true,
          // 날짜 줄(24px) 안에서 읽히도록 10px에서 키운다. 왼쪽은 일정 요약 버튼과
          // 겹치지 않게 안쪽으로 물리고, 오른쪽 세로선(right:242) 앞에서 끊는다.
          x: 120, width: 264, yStart: 164, rowGap: 32, maxRows: 1, fontSize: 15,
        },
        {
          ...base, id: "monthly-goal", icon: "◎", label: "이번 달 목표",
          description: "이번 달에 달성할 결과", defaultSymbol: "•",
          placeholder: "이번 달의 목표를 입력하세요",
          submitLabel: "이번 달 목표에 추가", hint: "오른쪽 ‘이번 달 목표’의 다음 빈 줄",
          x: 430, width: 176, yStart: 228, rowGap: 32, maxRows: 28, fontSize: 15,
        },
      ];
    }
    if (page.type === "future-h1" || page.type === "future-h2") {
      const months = page.months || (page.type.endsWith("h1") ? [1,2,3,4,5,6] : [7,8,9,10,11,12]);
      const columnWidth = PAGE_W / 6;
      return months.map((month, index) => ({
        ...base,
        id: `future-month-${index}`,
        icon: String(month),
        label: `${month}월`,
        description: "정해진 미래 일정",
        defaultSymbol: "○",
        placeholder: `${month}월에 기억할 일정이나 목표를 입력하세요`,
        submitLabel: `${month}월에 추가`,
        hint: `${month}월 칸의 다음 빈 줄`,
        x: index * columnWidth + 13,
        width: columnWidth - 24,
        yStart: 186,
        rowGap: 22,
        maxRows: 31,
        fontSize: 11,
        compact: true,
      }));
    }
    if (page.type === "goals") {
      return [1, 2, 3, 4].map((number, index) => ({
        ...base,
        id: `goal-${number}`,
        icon: String(number),
        label: `목표 ${number}`,
        description: "연간 목표와 실행 기준",
        defaultSymbol: "•",
        placeholder: `목표 ${number}에 연결할 구체적인 행동을 입력하세요`,
        submitLabel: `목표 ${number}에 추가`,
        hint: `목표 ${number}의 다음 빈 줄`,
        x: 196,
        width: 402,
        yStart: 176 + index * 150,
        rowGap: 29,
        maxRows: 3,
        fontSize: 15,
      }));
    }
    if (page.type === "feedback") {
      return [
        { ...base, id: "feedback-good", icon: "＋", label: "잘한 것", description: "유지할 행동", defaultSymbol: "−", placeholder: "이번에 잘한 점을 적으세요", submitLabel: "잘한 것에 추가", hint: "‘잘한 것’의 다음 빈 줄", x: 62, width: 548, yStart: 184, rowGap: 45, maxRows: 2 },
        { ...base, id: "feedback-hard", icon: "△", label: "어려웠던 것", description: "막혔던 지점", defaultSymbol: "−", placeholder: "어려웠던 점과 원인을 적으세요", submitLabel: "어려웠던 것에 추가", hint: "‘어려웠던 것’의 다음 빈 줄", x: 62, width: 548, yStart: 342, rowGap: 45, maxRows: 2 },
        { ...base, id: "feedback-learn", icon: "✦", label: "배운 것", description: "얻은 정보와 지식", defaultSymbol: "−", placeholder: "이번에 배운 점을 적으세요", submitLabel: "배운 것에 추가", hint: "‘배운 것’의 다음 빈 줄", x: 62, width: 548, yStart: 500, rowGap: 45, maxRows: 2 },
        { ...base, id: "feedback-change", icon: "→", label: "다음에 바꿀 것", description: "다음 행동 한 가지", defaultSymbol: "•", placeholder: "다음에 바꿀 행동 하나를 적으세요", submitLabel: "다음 행동에 추가", hint: "‘다음에 바꿀 한 가지’의 다음 빈 줄", x: 62, width: 548, yStart: 658, rowGap: 45, maxRows: 2 },
        { ...base, id: "feedback-back", icon: "↩", label: "연결 목표·페이지", description: "Back 링크", defaultSymbol: "−", placeholder: "연결할 목표나 페이지를 적으세요", submitLabel: "연결 항목에 추가", hint: "하단 Back 연결 줄", x: 62, width: 548, yStart: 790, rowGap: 40, maxRows: 1 },
      ];
    }
    return [
      {
        ...base, id: "page-auto", icon: "✎", label: "자유 기록",
        description: "현재 페이지의 다음 빈 줄", defaultSymbol: "−",
        placeholder: "현재 페이지에 기록할 내용을 입력하세요",
        submitLabel: "현재 페이지에 추가", hint: "현재 페이지의 다음 빈 줄",
        x: 68, width: 536, yStart: 150, rowGap: 42, maxRows: 18,
      },
    ];
  }

  function mobileWritePageMeta(page) {
    if (page?.type === "blank" && (isYearCalendarTemplate(page.planTemplate))) {
      return {
        eyebrow: "YEARLY EVENT", title: "연간 달력 일정 쓰기", icon: "12",
        description: "날짜를 선택하면 ○ 일정이 월간·주간·일간에도 함께 표시됩니다.",
        legend: "어느 달에 기록할까요?",
      };
    }
    if (page?.type === "blank" && page.planTemplate === "project") {
      return {
        eyebrow: "PROJECT WRITE", title: "프로젝트 계획 쓰기", icon: "P",
        description: "완료 조건부터 다음 행동까지 칸별로 입력합니다.",
        legend: "어느 계획 칸에 기록할까요?",
      };
    }
    if (page?.type === "blank" && page.planTemplate === "tracker") {
      return {
        eyebrow: "TRACKER WRITE", title: "수치·습관 계획 쓰기", icon: "#",
        description: "기간 결과와 주간·하루 행동을 나눠 입력합니다.",
        legend: "어느 기준에 기록할까요?",
      };
    }
    const meta = {
      daily: { eyebrow: "DAILY WRITE", title: "일간 계획 쓰기", icon: "D", description: "할 일과 오늘의 기록을 나눠서 입력합니다.", legend: "어느 쪽에 기록할까요?" },
      monthly: { eyebrow: "MONTHLY WRITE", title: "월간 계획 쓰기", icon: "31", description: "날짜별 일정과 이번 달 목표를 구분합니다.", legend: "무엇을 기록할까요?" },
      "weekly-left": { eyebrow: "WEEKLY WRITE", title: "주간 계획 쓰기", icon: "W", description: "주간 종합 계획 또는 요일을 선택합니다.", legend: "어느 칸에 기록할까요?" },
      "weekly-right": { eyebrow: "WEEKLY WRITE", title: "주간 계획 쓰기", icon: "W", description: "금요일부터 일요일까지 요일을 선택합니다.", legend: "어느 요일에 기록할까요?" },
      "future-h1": { eyebrow: "FUTURE WRITE", title: "미래 기록 쓰기", icon: "6M", description: "기록할 월을 먼저 선택합니다.", legend: "어느 달에 기록할까요?" },
      "future-h2": { eyebrow: "FUTURE WRITE", title: "미래 기록 쓰기", icon: "6M", description: "기록할 월을 먼저 선택합니다.", legend: "어느 달에 기록할까요?" },
      goals: { eyebrow: "GOAL WRITE", title: "연간 목표 쓰기", icon: "◎", description: "연결할 목표를 선택해 행동을 추가합니다.", legend: "어느 목표에 연결할까요?" },
      feedback: { eyebrow: "REVIEW WRITE", title: "회고 쓰기", icon: "↺", description: "잘한 것·어려움·배움·다음 행동으로 나눕니다.", legend: "어느 항목에 기록할까요?" },
    };
    return meta[page?.type] || {
      eyebrow: "PAGE WRITE",
      title: "현재 페이지에 쓰기",
      icon: "✎",
      description: "현재 페이지의 다음 빈 줄에 기록합니다.",
      legend: "기록 위치",
    };
  }

  function selectedMobileWritePage() {
    return book.pages.find(page => page.id === refs.mobilePageWritePageSelect.value) ||
      book.pages[currentIndex];
  }

  function refreshMobileWritePageSelect(preferredPageId) {
    const indexes = visibleIndexes();
    refs.mobilePageWritePageSelect.innerHTML = indexes.map(index => {
      const page = book.pages[index];
      const title = pageDisplayTitle(page, `페이지 ${index + 1}`);
      return `<option value="${escapeHtml(page.id)}">${index + 1}. ${escapeHtml(title)}</option>`;
    }).join("");
    const preferred = indexes
      .map(index => book.pages[index])
      .find(page => page.id === preferredPageId) || book.pages[indexes[0]];
    refs.mobilePageWritePageSelect.value = preferred?.id || "";
    return preferred;
  }

  function updateMobileWriteSymbolButtons() {
    $$(".mobile-write-symbols button").forEach(button =>
      button.classList.toggle("active", button.dataset.mobileWriteSymbol === mobileWriteSymbol)
    );
  }

  function updateMobileContextBulletButtons() {
    const symbol = refs.mobileTextContextInput.value.trimStart().charAt(0);
    const info = bulletSymbolInfo(symbol) || { base: "dot", status: "open" };
    const isPlan = info.base === "dot" || info.base === "circle";
    $$('[data-mobile-bullet-base]').forEach(button =>
      button.classList.toggle("active", button.dataset.mobileBulletBase === info.base)
    );
    $$('[data-mobile-bullet-status]').forEach(button => {
      button.disabled = !isPlan;
      button.classList.toggle(
        "active",
        isPlan && button.dataset.mobileBulletStatus === info.status
      );
    });
  }

  function setMobileContextBulletBase(base) {
    refs.mobileTextContextInput.value = replaceLeadingBullet(
      refs.mobileTextContextInput.value,
      { base, status: "open" }
    );
    updateMobileContextBulletButtons();
  }

  function setMobileContextBulletStatus(status) {
    const info = bulletSymbolInfo(
      refs.mobileTextContextInput.value.trimStart().charAt(0)
    );
    if (info && info.base !== "dot" && info.base !== "circle") {
      showToast("상태는 • 할 일과 ○ 일정에만 적용됩니다");
      return;
    }
    refs.mobileTextContextInput.value = replaceLeadingBullet(
      refs.mobileTextContextInput.value,
      { status }
    );
    updateMobileContextBulletButtons();
  }

  function configureMobileWriteDetail(page, target) {
    const needsDateDetail = target?.detail === "month-day" || target?.detail === "year-day";
    refs.mobilePageWriteDetailField.hidden = !needsDateDetail;
    if (!needsDateDetail) return target;

    if (target.detail === "year-day") {
      const year = clamp(Math.round(Number(page.year) || new Date().getFullYear()), 1900, 2200);
      const month = clamp(Math.round(Number(target.month) || 1), 1, 12);
      const days = new Date(year, month, 0).getDate();
      const selectedDay = clamp(Number(mobileWriteDetail) || 1, 1, days);
      mobileWriteDetail = String(selectedDay);
      refs.mobilePageWriteDetailLabel.textContent = "기록할 날짜";
      refs.mobilePageWriteDetailSelect.innerHTML = Array.from({ length: days }, (_, index) => {
        const day = index + 1;
        const weekday = ["일","월","화","수","목","금","토"][new Date(year, month - 1, day).getDay()];
        return `<option value="${day}">${month}월 ${day}일(${weekday})</option>`;
      }).join("");
      refs.mobilePageWriteDetailSelect.value = mobileWriteDetail;
      return {
        ...target,
        label: `${month}월 ${selectedDay}일 일정`,
        hint: `${month}월 ${selectedDay}일 달력 칸`,
        submitLabel: `${month}월 ${selectedDay}일에 추가`,
      };
    }

    const { year, month, hasCalendarDate: hasDate } = monthlyDateContext(page);
    const days = monthlyDayCount(page);
    const today = new Date();
    const preferredDay = hasDate &&
      today.getFullYear() === year &&
      today.getMonth() + 1 === month
      ? today.getDate()
      : 1;
    const selectedDay = clamp(Number(mobileWriteDetail) || preferredDay, 1, days);
    mobileWriteDetail = String(selectedDay);
    refs.mobilePageWriteDetailLabel.textContent = "기록할 날짜";
    refs.mobilePageWriteDetailSelect.innerHTML = Array.from({ length: days }, (_, index) => {
      const day = index + 1;
      const weekday = hasDate
        ? `(${["일","월","화","수","목","금","토"][new Date(year, month - 1, day).getDay()]})`
        : "";
      return `<option value="${day}">${day}${hasDate ? weekday : "일"}</option>`;
    }).join("");
    refs.mobilePageWriteDetailSelect.value = mobileWriteDetail;
    return {
      ...target,
      label: `${selectedDay}일 일정`,
      hint: `${selectedDay}일 일정 줄`,
      submitLabel: `${selectedDay}일에 추가`,
      yStart: 164 + (selectedDay - 1) * 32,
      maxRows: 1,
    };
  }

  function calendarDateForMobileWriteTarget(page, target) {
    if (!page || !target) return "";
    if (mobileWriteDateContext) return mobileWriteDateContext;
    if (target.detail === "year-day") {
      const year = Number(page.year);
      const month = Number(target.month);
      const day = Number(mobileWriteDetail);
      if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
      return normalizedDateOrBlank(isoDate(new Date(year, month - 1, day)));
    }
    if (page.type === "monthly" && target.id === "monthly-schedule") {
      const { year, month, hasCalendarDate } = monthlyDateContext(page);
      const day = Number(mobileWriteDetail);
      if (!hasCalendarDate || !Number.isInteger(day)) return "";
      return normalizedDateOrBlank(isoDate(new Date(year, month - 1, day)));
    }
    if (isWeeklyPage(page)) {
      const start = normalizedWeekStart(page.weekStart);
      const match = String(target.id || "").match(/^weekly-day-(\d)$/u);
      if (!start || !match) return "";
      return isoDate(offsetDate(dateFromIso(start), Number(match[1])));
    }
    if (page.type === "daily") return normalizedDateOrBlank(page.pageDate);
    return "";
  }

  function renderMobilePageWriteTargets() {
    const page = selectedMobileWritePage();
    if (!page) return;
    const meta = mobileWritePageMeta(page);
    const targets = mobileWriteTargetsForPage(page);
    if (!targets.some(target => target.id === mobileWriteTarget)) {
      mobileWriteTarget = targets[0]?.id || "";
      mobileWriteDetail = "";
      mobileWriteSymbol = targets[0]?.defaultSymbol || "•";
    }
    const target = targets.find(item => item.id === mobileWriteTarget);
    const selected = configureMobileWriteDetail(page, target);
    const isWeekly = page.type === "weekly-left" || page.type === "weekly-right";
    const displayTitle = pageDisplayTitle(page, "현재 페이지");
    refs.mobilePageWriteForm.dataset.pageType = page.planTemplate
      ? `plan-${page.planTemplate}`
      : page.type;
    refs.mobilePageWriteEyebrow.textContent = meta.eyebrow;
    refs.mobilePageWriteTitle.textContent = meta.title;
    refs.mobilePageWriteContextIcon.textContent = meta.icon;
    refs.mobilePageWriteContextTitle.textContent = displayTitle;
    refs.mobilePageWriteContextDescription.textContent = mobileWriteDateContext
      ? `${meta.description} · 위젯 선택 ${dailyDateLabel(dateFromIso(mobileWriteDateContext))}`
      : meta.description;
    refs.mobilePageWriteTargetLegend.textContent = meta.legend;
    refs.mobilePageWriteWeekField.hidden = !isWeekly;
    refs.mobilePageWriteWeekNumber.readOnly = true;
    refs.mobilePageWriteWeekNumber.value = isWeekly
      ? normalizedWeekNumber(page.weekNumber)
      : "";
    refs.mobilePageWriteWeekStartField.hidden = !isWeekly;
    refs.mobilePageWriteWeekStart.value = isWeekly
      ? normalizedWeekStart(page.weekStart) || ""
      : "";
    const supportsContinuation = page.type === "daily" || isWeeklyPage(page);
    refs.mobilePageWriteAddContinuationButton.hidden = !supportsContinuation;
    refs.mobilePageWriteAddContinuationButton.textContent = page.type === "daily"
      ? "＋ 같은 날짜 다음 장 추가"
      : "＋ 같은 주차 다음 장 추가";
    refs.mobilePageWriteTargets.innerHTML = "";
    targets.forEach(target => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.mobileWriteTarget = target.id;
      button.innerHTML = `<span>${escapeHtml(target.icon || "•")}</span>
        <strong>${escapeHtml(target.label)}</strong>
        <small>${escapeHtml(target.description || "")}</small>`;
      button.classList.toggle("active", target.id === mobileWriteTarget);
      button.addEventListener("click", () => {
        mobileWriteTarget = target.id;
        mobileWriteDetail = "";
        mobileWriteSymbol = target.defaultSymbol || "•";
        updateMobileWriteSymbolButtons();
        renderMobilePageWriteTargets();
        requestAnimationFrame(() => refs.mobilePageWriteInput.focus());
      });
      refs.mobilePageWriteTargets.append(button);
    });
    refs.mobilePageWriteContentLabel.textContent = selected?.label
      ? `${selected.label} 내용` : "내용";
    refs.mobilePageWriteInput.placeholder =
      selected?.placeholder || "현재 페이지에 기록할 내용을 입력하세요";
    refs.mobilePageWriteSubmit.textContent =
      selected?.submitLabel || "현재 페이지에 추가";
    const widgetDateHint = mobileWriteDateContext
      ? `위젯에서 선택한 ${dailyDateLabel(dateFromIso(mobileWriteDateContext))}입니다. ○ 일정은 이 날짜에 저장됩니다. `
      : "";
    refs.mobilePageWriteHint.textContent =
      `${widgetDateHint}${selected?.hint || "다음 빈 줄"}에 자동 배치됩니다. 추가한 기록과 템플릿의 제목·날짜·항목명은 두 번 터치하면 편집됩니다. 기록은 한 번 터치해 크기 조절, 드래그해 모눈 단위 이동, 길게 눌러 수정·삭제할 수 있습니다.`;
    updateMobileWriteSymbolButtons();
  }

  function setMobileWriteMode(mode) {
    mobileWriteMode = mode === "routine" ? "routine" : "once";
    $$('[data-write-mode]').forEach(button =>
      button.classList.toggle("active", button.dataset.writeMode === mobileWriteMode)
    );
    refs.mobileWriteOnceFields.hidden = mobileWriteMode === "routine";
    refs.mobileWriteRoutineFields.hidden = mobileWriteMode !== "routine";
    if (mobileWriteMode === "routine") {
      refs.mobilePageWriteContentLabel.textContent = "루틴 이름";
      refs.mobilePageWriteInput.placeholder = "예: 만 보 걷기";
      refs.mobilePageWriteSubmit.textContent = "루틴 만들기";
      refs.mobilePageWriteHint.textContent =
        "저장하면 오늘부터 한 달 안에 이미 있는 일간·주간 계획에 자동으로 채워지고, 월간 요약에도 표시됩니다." +
        (mobileWriteDateContext
          ? ` 위젯에서 고른 ${dailyDateLabel(dateFromIso(mobileWriteDateContext))}이 날짜 입력의 기본값입니다.`
          : "");
      updateMobileRoutineScheduleFields();
    } else {
      renderMobilePageWriteTargets();
    }
  }

  function openMobilePageWrite(options = {}) {
    mobileWriteDateContext = normalizedDateOrBlank(options?.date);
    const indexes = visibleIndexes();
    refs.mobilePageWritePageSelect.innerHTML = indexes.map(index => {
      const page = book.pages[index];
      const title = pageDisplayTitle(page, `페이지 ${index + 1}`);
      return `<option value="${escapeHtml(page.id)}">${index + 1}. ${escapeHtml(title)}</option>`;
    }).join("");
    const preferred = indexes
      .map(index => book.pages[index])
      .find(page => page.id === activePageId) || book.pages[currentIndex];
    refs.mobilePageWritePageSelect.value = preferred?.id || book.pages[indexes[0]]?.id || "";
    mobileWriteTarget = "";
    mobileWriteDetail = "";
    refs.mobilePageWriteInput.value = "";
    refs.mobileRoutineSchedule.value = "daily";
    const routineDate = mobileWriteDateContext || isoDate(new Date());
    refs.mobileRoutineDate.value = routineDate;
    refs.mobileRoutineIntervalStart.value = routineDate;
    refs.mobileRoutineYearlyDate.value = routineDate;
    refs.mobileRoutineMonthDay.value = String(dateFromIso(routineDate).getDate());
    $$('input[type="checkbox"]', refs.mobileRoutineWeekdayField).forEach(input => {
      input.checked = Number(input.value) === dateFromIso(routineDate).getDay();
    });
    setMobileWriteMode("once");
    if (!refs.mobilePageWriteDialog.open) refs.mobilePageWriteDialog.showModal();
    requestAnimationFrame(() => refs.mobilePageWriteInput.focus());
  }

  function mobileTextCharacterWidth(character, fontSize) {
    if (/\s/u.test(character)) return fontSize * .36;
    if (/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff01-\uff60\uffe0-\uffe6]/u.test(character)) {
      return fontSize;
    }
    if (/[ilI1|.,'`:;]/u.test(character)) return fontSize * .38;
    if (/[MW@#%&]/u.test(character)) return fontSize * .9;
    return fontSize * .65;
  }

  function mobileTextWrappedLineCount(text, target) {
    const fontSize = target.fontSize || 16;
    const usableWidth = Math.max(40, target.width - 20);
    return String(text).split("\n").reduce((total, paragraph) => {
      if (!paragraph) return total + 1;
      let lines = 1;
      let lineWidth = 0;
      Array.from(paragraph).forEach(character => {
        const characterWidth = mobileTextCharacterWidth(character, fontSize);
        if (lineWidth > 0 && lineWidth + characterWidth > usableWidth) {
          lines += 1;
          lineWidth = characterWidth;
        } else {
          lineWidth += characterWidth;
        }
      });
      return total + lines;
    }, 0);
  }

  function mobileTextHeight(text, target) {
    const fontSize = target.fontSize || 16;
    const lines = mobileTextWrappedLineCount(text, target);
    const minimum = target.compact ? Math.max(16, target.rowGap - 5) : 30;
    const measured = Math.ceil(lines * fontSize * 1.45 + 8);
    if (!target.compact) return Math.max(minimum, measured);
    const maximum = Math.max(minimum, target.rowGap - 2);
    return clamp(measured, minimum, maximum);
  }

  function nextMobileWriteSlot(page, target, text) {
    const x = snapToGrid(target.x, 0, PAGE_W - GRID_SIZE);
    const width = Math.min(snapSizeToGrid(target.width), PAGE_W - x);
    const measuredHeight = mobileTextHeight(text, {
      ...target,
      width,
    });
    // 텍스트 박스는 실제 필요 높이보다 작아지면 다음 기록이 글자 위에 겹친다.
    // 일반 칸은 가장 가까운 모눈이 아니라 다음 모눈까지 항상 올림한다.
    const height = target.compact
      ? snapSizeToGrid(measuredHeight)
      : Math.max(GRID_SIZE, Math.ceil(measuredHeight / GRID_SIZE) * GRID_SIZE);
    // 월간 날짜 줄은 31칸을 페이지에 꽉 채우려고 모눈(24)이 아닌 32px 간격을
    // 쓴다. 여기서 모눈에 스냅하면 날짜 줄과 최대 12px 어긋나므로 그대로 둔다.
    const isMonthlyRow = target.id === "monthly-schedule";
    const yStart = isMonthlyRow
      ? clamp(Math.round(Number(target.yStart) || 0), 0, PAGE_H - GRID_SIZE)
      : snapToGrid(target.yStart, 0, PAGE_H - GRID_SIZE);
    const rowGap = isMonthlyRow
      ? Math.max(GRID_SIZE, Math.round(Number(target.rowGap) || GRID_SIZE))
      : snapSizeToGrid(target.rowGap);
    const occupied = page.elements.filter(element => {
      if (element.type !== "text") return false;
      // 월간 일정은 같은 날짜의 기존 박스에 먼저 이어 쓴 뒤 이 함수에 온다.
      // 따라서 이전 날짜의 높이가 큰 일정이나 자유 텍스트가 행을 덮고 있어도
      // 새 날짜 기록 자체는 막지 않는다.
      if (target.id === "monthly-schedule") {
        return false;
      }
      return true;
    });
    const bottomLimit = target.compact ? PAGE_H - GRID_SIZE : PAGE_H - 58;
    // 일간의 할 일/오늘의 기록 칸과 주간의 요일 칸은 ○ 일정이 칸 안 줄을 먼저
    // 차지하므로, 새 손글씨 기록이 그 줄과 겹치지 않게 함께 예약분으로 취급한다.
    const weeklyOffset = String(target.id || "").match(/^weekly-day-(\d)$/u);
    const reservedEventRows = target.id === "daily-todo" || target.id === "daily-log"
      ? dailyColumnEventRects(page, target.id)
      : weeklyOffset
        ? weeklyColumnEventRects(page, Number(weeklyOffset[1]))
        : [];
    const overlaps = candidate =>
      occupied.some(element => rectsOverlap(candidate, {
        x: Number(element.x) || 0,
        y: Number(element.y) || 0,
        width: Number(element.width) || 0,
        height: Number(element.height) || 0,
      })) ||
      reservedEventRows.some(rect => rectsOverlap(candidate, rect));
    for (let row = 0; row < target.maxRows; row++) {
      const candidate = {
        x,
        y: yStart + row * rowGap,
        width,
        height,
      };
      if (candidate.y + candidate.height > bottomLimit) break;
      if (!overlaps(candidate)) return candidate;
    }
    return null;
  }

  function reflowMobileWriteTarget(page, target) {
    const moving = (page.elements || []).filter(element =>
      element.type === "text" && element.gridLocked && element.layoutTarget === target.id
    );
    if (!moving.length) return true;
    const movingIds = new Set(moving.map(element => element.id));
    const virtualPage = {
      ...page,
      elements: (page.elements || []).filter(element => !movingIds.has(element.id)),
    };
    const placements = [];
    for (const element of moving) {
      const slot = nextMobileWriteSlot(virtualPage, target, String(element.text || ""));
      if (!slot) return false;
      placements.push({ element, slot });
      virtualPage.elements.push({ ...element, ...slot });
    }
    placements.forEach(({ element, slot }) => Object.assign(element, slot));
    return true;
  }

  function mobileWriteContinuationChain(page) {
    const rootId = page?.continuationOf || page?.id;
    if (!rootId) return page ? [page] : [];
    return book.pages
      .filter(candidate => candidate.id === rootId || candidate.continuationOf === rootId)
      .sort((left, right) => book.pages.indexOf(left) - book.pages.indexOf(right));
  }

  function createMobileWriteContinuationPage(sourcePage) {
    if (!sourcePage || (sourcePage.type !== "daily" && !isWeeklyPage(sourcePage))) return null;
    const chain = mobileWriteContinuationChain(sourcePage);
    const rootId = sourcePage.continuationOf || sourcePage.id;
    const templatePage = chain.find(candidate => candidate.id === rootId) || sourcePage;
    const nextIndex = Math.max(0, ...chain.map(candidate =>
      Math.round(Number(candidate.continuationIndex) || 0)
    )) + 1;
    const metadata = clone(templatePage);
    [
      "id", "elements", "createdAt", "updatedAt", "title", "titleCustomized",
      "continuationOf", "continuationIndex", "weeklyPairId",
    ].forEach(key => delete metadata[key]);
    const templateText = clone(templatePage.templateText || {});
    delete templateText[pageTitleTemplateField(templatePage)];
    const continuation = makePage(templatePage.type, "", {
      ...metadata,
      templateText,
      continuationOf: rootId,
      continuationIndex: nextIndex,
      weeklyPairId: isWeeklyPage(templatePage) ? uid() : undefined,
    });
    if (isWeeklyPage(continuation)) continuation.title = weeklyPageTitle(continuation);
    const insertionPeers = isWeeklyPage(templatePage)
      ? weeklyDateLinkedPages(templatePage)
      : chain;
    const lastIndex = Math.max(...insertionPeers.map(candidate => book.pages.indexOf(candidate)));
    book.pages.splice(lastIndex + 1, 0, continuation);
    return continuation;
  }

  function addManualMobileWriteContinuationPage() {
    const page = selectedMobileWritePage();
    if (!page || (page.type !== "daily" && !isWeeklyPage(page))) {
      refs.mobilePageWriteHint.textContent = "일간·주간 계획에서만 같은 양식의 다음 장을 만들 수 있습니다.";
      return;
    }
    const continuation = createMobileWriteContinuationPage(page);
    if (!continuation) {
      refs.mobilePageWriteHint.textContent = "다음 장을 만들지 못했습니다. 페이지를 다시 선택해 주세요.";
      return;
    }
    currentIndex = book.pages.findIndex(candidate => candidate.id === continuation.id);
    activePageId = continuation.id;
    selection = null;
    commitHistory();
    renderAll();
    refreshMobileWritePageSelect(continuation.id);
    renderMobilePageWriteTargets();
    refs.mobilePageWriteHint.textContent = `${pageDisplayTitle(continuation)}을 만들었습니다. 기록할 칸과 내용을 선택해 이어서 쓰세요.`;
    requestAnimationFrame(() => refs.mobilePageWriteInput.focus());
    showToast(`${pageDisplayTitle(continuation)}을 추가했습니다`);
  }

  function mobileWriteDestination(sourcePage, sourceTarget, text) {
    if (!sourcePage || !sourceTarget) return null;
    const supportsContinuation = sourcePage.type === "daily" || isWeeklyPage(sourcePage);
    const candidates = supportsContinuation
      ? mobileWriteContinuationChain(sourcePage)
      : [sourcePage];
    for (const candidatePage of candidates) {
      const candidateTarget = mobileWriteTargetsForPage(candidatePage)
        .find(target => target.id === sourceTarget.id);
      if (!candidateTarget || !reflowMobileWriteTarget(candidatePage, candidateTarget)) continue;
      const slot = nextMobileWriteSlot(candidatePage, candidateTarget, text);
      if (slot) return { page: candidatePage, target: candidateTarget, slot, created: false };
    }
    if (!supportsContinuation) return null;
    const continuation = createMobileWriteContinuationPage(sourcePage);
    const target = continuation
      ? mobileWriteTargetsForPage(continuation).find(item => item.id === sourceTarget.id)
      : null;
    const slot = continuation && target ? nextMobileWriteSlot(continuation, target, text) : null;
    if (!continuation || !target || !slot) {
      if (continuation) {
        book.pages = book.pages.filter(candidate => candidate.id !== continuation.id);
      }
      return null;
    }
    return { page: continuation, target, slot, created: true };
  }

  function appendMonthlyScheduleOnSameDay(page, target, text) {
    if (target.id !== "monthly-schedule") return null;
    // nextMobileWriteSlot과 같은 좌표를 써야 같은 날짜 줄을 찾아낸다.
    const rowY = clamp(Math.round(Number(target.yStart) || 0), 0, PAGE_H - GRID_SIZE);
    const rowX = snapToGrid(target.x, 0, PAGE_W - GRID_SIZE);
    const existing = page.elements.find(element => {
      if (element.type !== "text") return false;
      const sameTarget = element.layoutTarget === target.id;
      const legacyMonthlyRow = element.gridLocked &&
        Math.abs((Number(element.x) || 0) - rowX) <= GRID_SIZE;
      return (sameTarget || legacyMonthlyRow) &&
        Math.abs((Number(element.y) || 0) - rowY) <= GRID_SIZE / 2;
    });
    if (!existing) return null;
    const previous = String(existing.text || "").trim();
    const merged = previous ? `${previous}  ·  ${text}` : text;
    // 월간 날짜 줄은 24px 한 칸이라 박스를 늘릴 수 없다. 한 줄을 넘기면
    // 글자가 다음 날짜 줄 위에 겹쳐 그려지므로 이어붙이지 않고 알린다.
    const fontSize = Math.min(Number(existing.fontSize) || target.fontSize, target.fontSize);
    const usableWidth = Math.max(40, (Number(existing.width) || target.width) - 12);
    const capacity = Math.max(4, Math.floor(usableWidth / (fontSize * .58)));
    if (merged.length > capacity) return "full";
    existing.text = merged;
    existing.fontSize = fontSize;
    existing.gridLocked = true;
    existing.layoutTarget = target.id;
    return existing;
  }

  function addMobilePageText() {
    const content = refs.mobilePageWriteInput.value.trim();
    if (!content) {
      refs.mobilePageWriteHint.textContent = mobileWriteMode === "routine"
        ? "루틴 이름을 입력해 주세요."
        : "내용을 입력해 주세요.";
      refs.mobilePageWriteInput.focus();
      return;
    }
    if (mobileWriteMode === "routine") {
      saveMobileRoutineFromWrite(content);
      return;
    }
    const page = selectedMobileWritePage();
    const rawTarget = mobileWriteTargetsForPage(page)
      .find(item => item.id === mobileWriteTarget);
    const target = rawTarget ? configureMobileWriteDetail(page, rawTarget) : null;
    if (!page || !target) return;
    if (page.type === "weekly-left" || page.type === "weekly-right") {
      const start = normalizedWeekStart(refs.mobilePageWriteWeekStart.value);
      if (start && start !== normalizedWeekStart(page.weekStart)) setWeeklyPageDate(page, start);
      else setWeeklyNumberForPair(page, refs.mobilePageWriteWeekNumber.value);
    }
    const text = `${mobileWriteSymbol} ${content}`;
    if (mobileWriteSymbol === "○") {
      const eventDate = calendarDateForMobileWriteTarget(page, target);
      if (!eventDate) {
        refs.mobilePageWriteHint.textContent =
          "이 페이지의 날짜가 아직 정해지지 않았습니다. 제목의 날짜를 먼저 눌러 설정해 주세요.";
        return;
      }
      // ○ 일정은 일간 페이지에서 항상 '할 일' 칸에 정리한다. 어느 칸을
      // 골랐는지와 무관하게 고정해, 오늘의 기록 칸에 흩어지지 않게 한다.
      const column = page.type === "daily" ? "daily-todo" : undefined;
      addCalendarEvent(eventDate, content, column);
      currentIndex = book.pages.findIndex(item => item.id === page.id);
      activePageId = page.id;
      selection = null;
      commitHistory();
      refs.mobilePageWriteDialog.close();
      renderAll();
      showToast(`${dailyDateLabel(dateFromIso(eventDate))} ○ 일정을 모든 날짜 계획에 반영했습니다`);
      return;
    }
    // 월간 일정은 같은 날짜에 이미 기록이 있으면 먼저 그 박스에 이어 쓴다.
    // 날짜 행을 다른 자유 텍스트가 덮고 있어도 새 기록 추가는 허용한다.
    const appended = target.id === "monthly-schedule"
      ? appendMonthlyScheduleOnSameDay(page, target, text)
      : null;
    if (appended === "full") {
      refs.mobilePageWriteHint.textContent =
        `${target.label}이 한 줄을 다 썼습니다. 내용을 줄이거나 기존 기록을 정리한 뒤 추가해 주세요.`;
      return;
    }
    if (appended) {
      currentIndex = book.pages.findIndex(item => item.id === page.id);
      activePageId = page.id;
      selection = null;
      commitHistory();
      refs.mobilePageWriteDialog.close();
      renderAll();
      showToast(`"${target.label}"에 일정을 이어서 추가했습니다`);
      return;
    }
    const destination = mobileWriteDestination(page, target, text);
    if (!destination) {
      refs.mobilePageWriteHint.textContent =
        target.id === "monthly-schedule"
          ? "해당 날짜 줄에 기록을 추가하지 못했습니다. 페이지를 다시 연 뒤 시도해 주세요."
          : "이 내용이 한 칸에 들어가지 않습니다. 내용을 나눠 입력해 주세요.";
      return;
    }
    const destinationPage = destination.page;
    const destinationTarget = destination.target;
    const slot = destination.slot;
    const element = makeText(slot.x, slot.y, text, {
      width: slot.width,
      height: slot.height,
      fontSize: destinationTarget.fontSize,
      color: destinationTarget.color,
      gridLocked: true,
      layoutTarget: destinationTarget.id,
    });
    destinationPage.elements.push(element);
    currentIndex = book.pages.findIndex(item => item.id === destinationPage.id);
    activePageId = destinationPage.id;
    selection = null;
    commitHistory();
    refs.mobilePageWriteDialog.close();
    renderAll();
    const continued = destinationPage.id !== page.id;
    showToast(destination.created
      ? `같은 날짜 양식의 다음 장을 만들고 "${destinationTarget.label}"에 기록했습니다`
      : continued
        ? `다음 계속 페이지의 "${destinationTarget.label}"에 기록했습니다`
        : `"${destinationTarget.label}"의 다음 빈 줄에 기록했습니다`);
  }

  function saveMobileRoutineFromWrite(title) {
    const schedule = refs.mobileRoutineSchedule.value;
    const weekdays = $$('input[type="checkbox"]:checked', refs.mobileRoutineWeekdayField)
      .map(input => Number(input.value));
    if (schedule === "custom" && !weekdays.length) {
      refs.mobilePageWriteHint.textContent = "실행할 요일을 하나 이상 선택해 주세요.";
      return;
    }
    if (schedule === "once" && !normalizedDateOrBlank(refs.mobileRoutineDate.value)) {
      refs.mobilePageWriteHint.textContent = "한 번 실행할 날짜를 선택해 주세요.";
      return;
    }
    if (schedule === "interval" && !normalizedDateOrBlank(refs.mobileRoutineIntervalStart.value)) {
      refs.mobilePageWriteHint.textContent = "자유 간격 반복의 시작일을 선택해 주세요.";
      return;
    }
    const yearlyDate = normalizedDateOrBlank(refs.mobileRoutineYearlyDate.value);
    const yearlyParts = yearlyDate ? yearlyDate.split("-").map(Number) : [0, 1, 1];
    const goal = defaultRoutineGoal();
    const bulletBase = bulletSymbolInfo(mobileWriteSymbol)?.base || "dot";
    const mission = {
      id: uid(), goalId: goal.id, title, schedule, bulletBase,
      weeklyTarget: clamp(Math.round(Number(refs.mobileRoutineWeeklyTarget.value) || 1), 1, 7),
      weekdays,
      scheduledDate: schedule === "once" ? normalizedDateOrBlank(refs.mobileRoutineDate.value) : "",
      startDate: mobileWriteDateContext || isoDate(new Date()),
      monthDay: clamp(Math.round(Number(refs.mobileRoutineMonthDay.value) || 1), 1, 31),
      yearMonth: yearlyParts[1],
      yearDay: yearlyParts[2],
      intervalUnit: refs.mobileRoutineIntervalUnit.value,
      intervalCount: clamp(Math.round(Number(refs.mobileRoutineIntervalCount.value) || 1), 1, 999),
      intervalStart: normalizedDateOrBlank(refs.mobileRoutineIntervalStart.value),
      active: true,
      createdAt: new Date().toISOString(),
    };
    const system = currentGoalSystem();
    const signature = missionDuplicateSignature(mission);
    const existing = system.missions.find(item => missionDuplicateSignature(item) === signature);
    if (existing) {
      existing.active = true;
      existing.startDate ||= mission.startDate;
    } else {
      system.missions.push(mission);
    }
    const removedDuplicates = dedupeDuplicatedMissions(book);
    const added = materializeDueMissions();
    commitHistory();
    refs.mobilePageWriteDialog.close();
    renderAll();
    showToast(existing || removedDuplicates
      ? "같은 루틴을 하나로 정리하고 다시 활성화했습니다"
      : added
        ? `루틴을 만들고 일간·주간 계획 ${added}곳에 반영했습니다`
        : "루틴을 만들었습니다");
  }

  function openMobileTextContext() {
    const context = selectedElementContext();
    if (!context || context.element.type !== "text") return;
    refs.mobileTextContextInput.value = context.element.text || "";
    refs.mobileTextContextFontSize.value = String(
      Math.round(Number(context.element.fontSize) || 18)
    );
    updateMobileContextBulletButtons();
    refs.mobileTextContextPasteButton.disabled = !elementClipboard;
    refs.mobileTextContextEditRoutineButton.hidden = !context.element.missionId ||
      !missionById(context.element.missionId);
    if (!refs.mobileTextContextDialog.open) refs.mobileTextContextDialog.showModal();
  }

  function editMobileContextRoutine() {
    const context = selectedElementContext();
    const missionId = context?.element?.missionId;
    if (!missionId || !missionById(missionId)) return;
    closeMobileTextContext(false);
    openGoalEditor("mission", missionId, "", "page");
  }

  function closeMobileTextContext(render = true) {
    if (refs.mobileTextContextDialog.open) refs.mobileTextContextDialog.close();
    selection = null;
    if (render) renderSpread();
  }

  function saveMobileTextContext() {
    const context = selectedElementContext();
    if (!context || context.element.type !== "text") return;
    const text = refs.mobileTextContextInput.value.trim();
    if (!text) {
      refs.mobileTextContextInput.focus();
      return;
    }
    context.element.text = text;
    context.element.fontSize = clamp(
      Number(refs.mobileTextContextFontSize.value) || 18,
      4,
      120
    );
    const estimatedHeight = mobileTextHeight(text, {
      width: Number(context.element.width) || 260,
      fontSize: context.element.fontSize,
      rowGap: 42,
    });
    context.element.height = context.element.gridLocked
      ? Math.min(
          snapSizeToGrid(Math.max(Number(context.element.height) || GRID_SIZE, estimatedHeight)),
          Math.max(GRID_SIZE, PAGE_H - (Number(context.element.y) || 0))
        )
      : Math.max(Number(context.element.height) || 30, estimatedHeight);
    const capturedAsEvent = captureCalendarEventElement(context.page, context.element);
    refs.mobileTextContextDialog.close();
    selection = null;
    commitHistory();
    renderAll();
    showToast(capturedAsEvent
      ? "○ 이벤트를 날짜 일정으로 연동했습니다"
      : "텍스트를 수정했습니다");
  }

  function adjustMobileContextFont(delta) {
    refs.mobileTextContextFontSize.value = String(clamp(
      (Number(refs.mobileTextContextFontSize.value) || 18) + delta,
      4,
      120
    ));
  }

  function duplicateMobileContextElement() {
    const context = selectedElementContext();
    if (!context) return;
    const duplicated = offsetElementCopy(context.element);
    context.page.elements.push(duplicated);
    refs.mobileTextContextDialog.close();
    selection = null;
    commitHistory();
    renderAll();
    showToast("텍스트 박스를 복제했습니다");
  }

  function copyMobileContextElement(cut = false) {
    const context = selectedElementContext();
    if (!context) return;
    elementClipboard = clone(context.element);
    refs.mobileTextContextDialog.close();
    if (cut) {
      removeElement(context.page, context.element.id);
      showToast("텍스트 박스를 잘라냈습니다");
      return;
    }
    selection = null;
    renderSpread();
    showToast("텍스트 박스를 복사했습니다");
  }

  function pasteMobileContextElement() {
    const context = selectedElementContext();
    if (!context || !elementClipboard) return;
    const pasted = offsetElementCopy(elementClipboard);
    context.page.elements.push(pasted);
    elementClipboard = clone(pasted);
    refs.mobileTextContextDialog.close();
    selection = null;
    commitHistory();
    renderAll();
    showToast("복사한 텍스트 박스를 붙여넣었습니다");
  }

  function reorderMobileContextElement(toFront) {
    const context = selectedElementContext();
    if (!context) return;
    const index = context.page.elements.findIndex(item => item.id === context.element.id);
    if (index < 0) return;
    const [element] = context.page.elements.splice(index, 1);
    if (toFront) context.page.elements.push(element);
    else context.page.elements.unshift(element);
    refs.mobileTextContextDialog.close();
    selection = null;
    commitHistory();
    renderAll();
    showToast(toFront ? "맨 앞으로 보냈습니다" : "맨 뒤로 보냈습니다");
  }

  function deleteMobileContextElement() {
    const context = selectedElementContext();
    if (!context) return;
    refs.mobileTextContextDialog.close();
    removeElement(context.page, context.element.id);
    showToast("텍스트 박스를 삭제했습니다");
  }

  function openMobileSearch() {
    refs.mobileSearchInput.value = "";
    renderMobileSearchResults();
    if (!refs.mobileSearchDialog.open) refs.mobileSearchDialog.showModal();
    requestAnimationFrame(() => refs.mobileSearchInput.focus());
  }

  function renderMobileSearchResults() {
    const query = refs.mobileSearchInput.value.trim().toLocaleLowerCase("ko-KR");
    const entries = buildSearchEntries().filter(entry => {
      if (!query) return entry.source === "page";
      return [entry.content, entry.pageTitle, entry.groupName, ...(entry.tags || [])]
        .join(" ").toLocaleLowerCase("ko-KR").includes(query);
    }).slice(0, 100);
    refs.mobileSearchResults.innerHTML = "";
    entries.forEach(entry => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "mobile-search-result";
      row.innerHTML = `<strong>${escapeHtml(entry.content)}</strong>
        <span>${escapeHtml(entry.pageTitle)}${entry.pageDate ? ` · ${escapeHtml(entry.pageDate)}` : ""}</span>`;
      row.addEventListener("click", () => {
        refs.mobileSearchDialog.close();
        currentIndex = entry.pageIndex;
        activePageId = entry.pageId;
        selection = entry.elementId && advancedMobileEditing
          ? { pageId: entry.pageId, elementId: entry.elementId }
          : null;
        renderAll();
      });
      refs.mobileSearchResults.append(row);
    });
    if (!entries.length) {
      refs.mobileSearchResults.innerHTML = `<div class="mobile-search-empty"><strong>검색 결과가 없습니다</strong></div>`;
    }
  }

  function goalStatusLabel(status) {
    return status === "completed" ? "달성" : status === "paused" ? "잠시 멈춤" : "진행 중";
  }

  function renderGoalHub() {
    if (!refs.goalHubList) return;
    const system = currentGoalSystem();
    const today = new Date();
    const todayValue = isoDate(today);
    const due = missionsDueOn(today);
    const doneToday = system.missions.filter(mission =>
      completedMissionElements(mission.id, todayValue, todayValue).length > 0
    ).length;
    const todayMissionIds = new Set([
      ...due.map(mission => mission.id),
      ...system.missions.filter(mission =>
        completedMissionElements(mission.id, todayValue, todayValue).length > 0
      ).map(mission => mission.id),
    ]);
    refs.goalHubSummary.innerHTML = `
      <div><strong>${system.areas.length}</strong><span>인생 영역</span></div>
      <div><strong>${system.goals.filter(goal => goal.status === "active").length}</strong><span>진행 목표</span></div>
      <div><strong>${doneToday}/${todayMissionIds.size}</strong><span>오늘 완료</span></div>`;
    if (!system.areas.length) {
      refs.goalHubList.innerHTML = `<div class="goal-hub-empty">
        <strong>삶에서 계속 유지할 영역부터 만드세요</strong>
        <p>영역마다 결과 목표를 정하고, 반복 미션을 일간 계획으로 받을 수 있습니다.</p>
        <span>예: 건강 · 일과 전문성 · 관계 · 생활 기반 · 성장</span>
      </div>`;
      return;
    }
    refs.goalHubList.innerHTML = system.areas.map(area => {
      const goals = system.goals.filter(goal => goal.areaId === area.id);
      return `<section class="goal-area-card">
        <header class="goal-area-header">
          <div><strong>${escapeHtml(area.name)}</strong><span>${escapeHtml(area.purpose || "유지 기준을 적어보세요")}</span></div>
          <div><button type="button" data-add-outcome="${escapeHtml(area.id)}">＋ 목표</button><button type="button" data-edit-area="${escapeHtml(area.id)}">편집</button></div>
        </header>
        <div class="goal-outcome-list">${goals.map(goal => {
          const progress = goalProgressData(goal);
          const missions = system.missions.filter(mission => mission.goalId === goal.id);
          const range = weekRangeFor(today);
          return `<article class="goal-outcome-card ${escapeHtml(goal.status)}">
            <div class="goal-outcome-main">
              <div class="goal-outcome-title"><span>${escapeHtml(goalStatusLabel(goal.status))}</span><strong>${escapeHtml(goal.title)}</strong></div>
              <p>${escapeHtml(goal.result || "달성 기준을 구체적으로 적어보세요.")}</p>
              <div class="goal-progress-row"><div><i style="width:${progress.percent}%"></i></div><strong>${Math.round(progress.percent)}%</strong></div>
              <small>${escapeHtml(progress.label)}${goal.dueDate ? ` · ${escapeHtml(goal.dueDate)}까지` : ""}</small>
            </div>
            <div class="goal-outcome-actions">
              <button type="button" data-open-goal-page="${escapeHtml(goal.id)}">페이지 열기</button>
              <button type="button" data-add-mission="${escapeHtml(goal.id)}">＋ 미션</button>
              <button type="button" data-edit-outcome="${escapeHtml(goal.id)}">편집</button>
            </div>
            <ul class="goal-mission-list">${missions.map(mission => {
              const complete = missionCompletionCount(mission.id, range.start, range.end);
              const target = missionWeeklyExpectation(mission, range);
              return `<li class="${mission.active ? "" : "inactive"}">
                <button type="button" data-edit-mission="${escapeHtml(mission.id)}">
                  <span><strong>${escapeHtml(BULLET_SYMBOLS[mission.bulletBase]?.open || BULLET_SYMBOLS.dot.open)} ${escapeHtml(mission.title)}</strong><small>${escapeHtml(missionScheduleLabel(mission))}</small></span>
                  <em>${target ? `${complete}/${target}` : mission.active ? "실행" : "멈춤"}</em>
                </button>
              </li>`;
            }).join("") || '<li class="goal-mission-empty">아직 미션이 없습니다. 목표를 하루에 실행할 행동으로 바꿔보세요.</li>'}</ul>
          </article>`;
        }).join("") || '<div class="goal-outcome-empty">결과 목표를 추가하면 이 영역이 오늘의 행동으로 이어집니다.</div>'}</div>
      </section>`;
    }).join("");
    $$('[data-edit-area]', refs.goalHubList).forEach(button =>
      button.addEventListener("click", () => openGoalEditor("area", button.dataset.editArea))
    );
    $$('[data-add-outcome]', refs.goalHubList).forEach(button =>
      button.addEventListener("click", () => openGoalEditor("goal", "", button.dataset.addOutcome))
    );
    $$('[data-edit-outcome]', refs.goalHubList).forEach(button =>
      button.addEventListener("click", () => openGoalEditor("goal", button.dataset.editOutcome))
    );
    $$('[data-add-mission]', refs.goalHubList).forEach(button =>
      button.addEventListener("click", () => openGoalEditor("mission", "", button.dataset.addMission))
    );
    $$('[data-edit-mission]', refs.goalHubList).forEach(button =>
      button.addEventListener("click", () => openGoalEditor("mission", button.dataset.editMission))
    );
    $$('[data-open-goal-page]', refs.goalHubList).forEach(button =>
      button.addEventListener("click", () => openGoalDetailPage(button.dataset.openGoalPage))
    );
  }

  function openGoalHub() {
    if (refs.mobileMoreDialog.open) refs.mobileMoreDialog.close();
    if (refs.mobilePageWriteDialog.open) refs.mobilePageWriteDialog.close();
    closeSidebar();
    renderGoalHub();
    if (!refs.goalHubDialog.open) refs.goalHubDialog.showModal();
  }

  function setGoalEditorSection(kind) {
    [
      ["area", refs.areaEditorFields],
      ["goal", refs.outcomeEditorFields],
      ["mission", refs.missionEditorFields],
    ].forEach(([sectionKind, section]) => {
      const active = sectionKind === kind;
      section.hidden = !active;
      $$('input, textarea, select, button', section).forEach(control => {
        control.disabled = !active;
      });
    });
  }

  function updateMissionScheduleFields() {
    const schedule = refs.missionEditorSchedule.value;
    refs.missionWeeklyTargetField.hidden = schedule !== "weekly";
    refs.missionEditorWeeklyTarget.disabled = schedule !== "weekly";
    refs.missionOnceDateField.hidden = schedule !== "once";
    refs.missionEditorDate.disabled = schedule !== "once";
    refs.missionWeekdayField.hidden = schedule !== "custom";
    $$('input[type="checkbox"]', refs.missionWeekdayField).forEach(input => {
      input.disabled = schedule !== "custom";
    });
    refs.missionMonthDayField.hidden = schedule !== "monthly-date";
    refs.missionEditorMonthDay.disabled = schedule !== "monthly-date";
    refs.missionYearlyField.hidden = schedule !== "yearly-date";
    refs.missionEditorYearlyDate.disabled = schedule !== "yearly-date";
    refs.missionIntervalField.hidden = schedule !== "interval";
    const intervalDisabled = schedule !== "interval";
    refs.missionEditorIntervalStart.disabled = intervalDisabled;
    refs.missionEditorIntervalCount.disabled = intervalDisabled;
    refs.missionEditorIntervalUnit.disabled = intervalDisabled;
  }

  // '현재 페이지 쓰기'에서 만드는 루틴은 인생 영역·결과 목표를 고를 필요가
  // 없다. 내부적으로만 쓰는 고정 영역·목표 하나에 모아 두고, 기존 미션
  // 엔진(반복 계산·주간 진척도·검색)을 그대로 재사용한다.
  const DEFAULT_ROUTINE_AREA_ID = "bulletbook-quick-routine-area";
  const DEFAULT_ROUTINE_GOAL_ID = "bulletbook-quick-routine-goal";
  function defaultRoutineGoal() {
    const system = currentGoalSystem();
    let area = system.areas.find(item => item.id === DEFAULT_ROUTINE_AREA_ID);
    if (!area) {
      area = {
        id: DEFAULT_ROUTINE_AREA_ID,
        name: "루틴",
        purpose: "현재 페이지 쓰기에서 만든 루틴을 모아둡니다.",
        createdAt: new Date().toISOString(),
      };
      system.areas.push(area);
    }
    let goal = system.goals.find(item => item.id === DEFAULT_ROUTINE_GOAL_ID);
    if (!goal) {
      goal = {
        id: DEFAULT_ROUTINE_GOAL_ID, areaId: area.id, title: "루틴",
        result: "", metricName: "", unit: "",
        startValue: null, currentValue: null, targetValue: null, dueDate: "",
        status: "active", createdAt: new Date().toISOString(),
      };
      system.goals.push(goal);
    }
    return goal;
  }

  function updateMobileRoutineScheduleFields() {
    const schedule = refs.mobileRoutineSchedule.value;
    refs.mobileRoutineWeeklyTargetField.hidden = schedule !== "weekly";
    refs.mobileRoutineWeeklyTarget.disabled = schedule !== "weekly";
    refs.mobileRoutineOnceDateField.hidden = schedule !== "once";
    refs.mobileRoutineDate.disabled = schedule !== "once";
    refs.mobileRoutineWeekdayField.hidden = schedule !== "custom";
    $$('input[type="checkbox"]', refs.mobileRoutineWeekdayField).forEach(input => {
      input.disabled = schedule !== "custom";
    });
    refs.mobileRoutineMonthDayField.hidden = schedule !== "monthly-date";
    refs.mobileRoutineMonthDay.disabled = schedule !== "monthly-date";
    refs.mobileRoutineYearlyField.hidden = schedule !== "yearly-date";
    refs.mobileRoutineYearlyDate.disabled = schedule !== "yearly-date";
    refs.mobileRoutineIntervalField.hidden = schedule !== "interval";
    const intervalDisabled = schedule !== "interval";
    refs.mobileRoutineIntervalStart.disabled = intervalDisabled;
    refs.mobileRoutineIntervalCount.disabled = intervalDisabled;
    refs.mobileRoutineIntervalUnit.disabled = intervalDisabled;
  }

  function goalEditorOptions() {
    const system = currentGoalSystem();
    refs.outcomeEditorArea.innerHTML = system.areas.map(area =>
      `<option value="${escapeHtml(area.id)}">${escapeHtml(area.name)}</option>`
    ).join("");
    refs.missionEditorGoal.innerHTML = system.goals.map(goal => {
      const area = lifeAreaById(goal.areaId);
      return `<option value="${escapeHtml(goal.id)}">${escapeHtml(area?.name || "영역")} · ${escapeHtml(goal.title)}</option>`;
    }).join("");
  }

  function openGoalEditor(kind, id = "", parentId = "", returnTarget = "hub") {
    const system = currentGoalSystem();
    const entity = kind === "area"
      ? system.areas.find(item => item.id === id)
      : kind === "goal"
        ? system.goals.find(item => item.id === id)
        : system.missions.find(item => item.id === id);
    editingGoalEntity = { kind, id: entity?.id || "", parentId };
    goalEditorReturnTarget = returnTarget === "page" ? "page" : "hub";
    refs.goalEditorForm.reset();
    goalEditorOptions();
    setGoalEditorSection(kind);
    const labels = {
      area: ["LIFE AREA", entity ? "인생 영역 편집" : "인생 영역 추가"],
      goal: ["OUTCOME GOAL", entity ? "결과 목표 편집" : "결과 목표 추가"],
      mission: ["DAILY MISSION", entity ? "미션 편집" : "미션 추가"],
    }[kind];
    refs.goalEditorEyebrow.textContent = labels[0];
    refs.goalEditorTitle.textContent = labels[1];
    refs.goalEditorDeleteButton.hidden = !entity;
    if (kind === "area") {
      refs.areaEditorName.value = entity?.name || "";
      refs.areaEditorPurpose.value = entity?.purpose || "";
    } else if (kind === "goal") {
      refs.outcomeEditorArea.value = entity?.areaId || parentId || system.areas[0]?.id || "";
      refs.outcomeEditorTitle.value = entity?.title || "";
      refs.outcomeEditorResult.value = entity?.result || "";
      refs.outcomeEditorMetric.value = entity?.metricName || "";
      refs.outcomeEditorUnit.value = entity?.unit || "";
      refs.outcomeEditorStart.value = entity?.startValue ?? "";
      refs.outcomeEditorCurrent.value = entity?.currentValue ?? "";
      refs.outcomeEditorTarget.value = entity?.targetValue ?? "";
      refs.outcomeEditorDue.value = entity?.dueDate || "";
      refs.outcomeEditorStatus.value = entity?.status || "active";
    } else {
      refs.missionEditorGoal.value = entity?.goalId || parentId || system.goals[0]?.id || "";
      refs.missionEditorTitle.value = entity?.title || "";
      refs.missionEditorBulletBase.value = entity?.bulletBase || "dot";
      refs.missionEditorSchedule.value = entity?.schedule || "daily";
      refs.missionEditorWeeklyTarget.value = entity?.weeklyTarget || 3;
      refs.missionEditorDate.value = entity?.scheduledDate || "";
      refs.missionEditorActive.checked = entity?.active !== false;
      const weekdays = new Set(entity?.weekdays || []);
      $$('input[type="checkbox"]', refs.missionWeekdayField).forEach(input => {
        input.checked = weekdays.has(Number(input.value));
      });
      refs.missionEditorMonthDay.value = entity?.monthDay || 1;
      // 연도는 저장하지 않으므로, 날짜 입력칸에는 윤년(2000년)을 임시로 넣어
      // 2월 29일도 고를 수 있게 한다. 저장할 때는 월·일만 읽는다.
      const yearMonth = entity?.yearMonth || 1;
      const yearDay = entity?.yearDay || 1;
      refs.missionEditorYearlyDate.value =
        `2000-${String(yearMonth).padStart(2, "0")}-${String(yearDay).padStart(2, "0")}`;
      refs.missionEditorIntervalStart.value = entity?.intervalStart || isoDate(new Date());
      refs.missionEditorIntervalCount.value = entity?.intervalCount || 1;
      refs.missionEditorIntervalUnit.value = entity?.intervalUnit || "day";
      updateMissionScheduleFields();
    }
    if (refs.goalHubDialog.open) refs.goalHubDialog.close();
    if (!refs.goalEditorDialog.open) refs.goalEditorDialog.showModal();
    requestAnimationFrame(() =>
      $("input:not([disabled]), textarea:not([disabled])", refs.goalEditorForm)?.focus()
    );
  }

  function closeGoalEditorToHub() {
    if (refs.goalEditorDialog.open) refs.goalEditorDialog.close();
    const returnToHub = goalEditorReturnTarget === "hub";
    editingGoalEntity = null;
    goalEditorReturnTarget = "hub";
    if (returnToHub) openGoalHub();
  }

  function saveGoalEditor() {
    const editing = editingGoalEntity;
    if (!editing) return;
    const system = currentGoalSystem();
    const now = new Date().toISOString();
    if (editing.kind === "area") {
      const name = refs.areaEditorName.value.trim();
      if (!name) return;
      const area = system.areas.find(item => item.id === editing.id);
      const next = { id: area?.id || uid(), name, purpose: refs.areaEditorPurpose.value.trim(), createdAt: area?.createdAt || now };
      if (area) Object.assign(area, next); else system.areas.push(next);
    } else if (editing.kind === "goal") {
      const areaId = refs.outcomeEditorArea.value;
      const title = refs.outcomeEditorTitle.value.trim();
      if (!areaId || !title) return;
      const goal = system.goals.find(item => item.id === editing.id);
      const oldTitle = goal?.title || "";
      const next = {
        id: goal?.id || uid(), areaId, title,
        result: refs.outcomeEditorResult.value.trim(),
        metricName: refs.outcomeEditorMetric.value.trim(),
        unit: refs.outcomeEditorUnit.value.trim(),
        startValue: finiteOrNull(refs.outcomeEditorStart.value),
        currentValue: finiteOrNull(refs.outcomeEditorCurrent.value),
        targetValue: finiteOrNull(refs.outcomeEditorTarget.value),
        dueDate: normalizedDateOrBlank(refs.outcomeEditorDue.value),
        status: refs.outcomeEditorStatus.value,
        createdAt: goal?.createdAt || now,
      };
      if (goal) Object.assign(goal, next); else system.goals.push(next);
      book.pages.filter(page => page.planTemplate === "goal-detail" && page.goalId === next.id)
        .forEach(page => {
          if (page.titleCustomized !== true || page.title === oldTitle) page.title = next.title;
        });
    } else {
      const goalId = refs.missionEditorGoal.value;
      const title = refs.missionEditorTitle.value.trim();
      const schedule = refs.missionEditorSchedule.value;
      const weekdays = $$('input[type="checkbox"]:checked', refs.missionWeekdayField)
        .map(input => Number(input.value));
      if (!goalId || !title) return;
      if (schedule === "custom" && !weekdays.length) {
        showToast("실행할 요일을 하나 이상 선택해 주세요");
        return;
      }
      if (schedule === "once" && !normalizedDateOrBlank(refs.missionEditorDate.value)) {
        showToast("한 번 실행할 날짜를 선택해 주세요");
        return;
      }
      if (schedule === "interval" && !normalizedDateOrBlank(refs.missionEditorIntervalStart.value)) {
        showToast("자유 간격 반복의 시작일을 선택해 주세요");
        return;
      }
      const yearlyDate = normalizedDateOrBlank(refs.missionEditorYearlyDate.value);
      const yearlyParts = yearlyDate ? yearlyDate.split("-").map(Number) : [0, 1, 1];
      const mission = system.missions.find(item => item.id === editing.id);
      const next = {
        id: mission?.id || uid(), goalId, title, schedule,
        bulletBase: Object.keys(BULLET_SYMBOLS).includes(refs.missionEditorBulletBase.value)
          ? refs.missionEditorBulletBase.value : "dot",
        weeklyTarget: clamp(Math.round(Number(refs.missionEditorWeeklyTarget.value) || 1), 1, 7),
        weekdays,
        scheduledDate: schedule === "once" ? normalizedDateOrBlank(refs.missionEditorDate.value) : "",
        startDate: normalizedDateOrBlank(mission?.startDate),
        monthDay: clamp(Math.round(Number(refs.missionEditorMonthDay.value) || 1), 1, 31),
        yearMonth: yearlyParts[1],
        yearDay: yearlyParts[2],
        intervalUnit: refs.missionEditorIntervalUnit.value,
        intervalCount: clamp(Math.round(Number(refs.missionEditorIntervalCount.value) || 1), 1, 999),
        intervalStart: normalizedDateOrBlank(refs.missionEditorIntervalStart.value),
        active: refs.missionEditorActive.checked,
        createdAt: mission?.createdAt || now,
      };
      if (mission) Object.assign(mission, next); else system.missions.push(next);
      materializeDueMissions();
    }
    commitHistory();
    renderAll();
    closeGoalEditorToHub();
    showToast("목표·미션을 저장했습니다");
  }

  function deleteGoalEditorEntity() {
    const editing = editingGoalEntity;
    if (!editing?.id) return;
    const system = currentGoalSystem();
    if (editing.kind === "area") {
      const area = lifeAreaById(editing.id);
      if (system.goals.some(goal => goal.areaId === editing.id)) {
        showToast("연결된 결과 목표를 먼저 옮기거나 삭제해 주세요");
        return;
      }
      if (!confirm(`“${area?.name || "인생 영역"}”을 삭제할까요?`)) return;
      system.areas = system.areas.filter(item => item.id !== editing.id);
    } else if (editing.kind === "goal") {
      const goal = outcomeGoalById(editing.id);
      if (system.missions.some(mission => mission.goalId === editing.id)) {
        showToast("연결된 미션을 먼저 삭제해 주세요");
        return;
      }
      if (!confirm(`“${goal?.title || "결과 목표"}”를 삭제할까요? 목표 페이지는 복구 안내 상태로 남습니다.`)) return;
      system.goals = system.goals.filter(item => item.id !== editing.id);
    } else {
      const mission = missionById(editing.id);
      if (!confirm(`“${mission?.title || "미션"}”을 삭제할까요? 이미 일간 페이지에 받은 기록은 유지됩니다.`)) return;
      system.missions = system.missions.filter(item => item.id !== editing.id);
    }
    commitHistory();
    renderAll();
    closeGoalEditorToHub();
    showToast("항목을 삭제했습니다");
  }

  function navigateToBookPage(page) {
    const index = book.pages.findIndex(item => item.id === page?.id);
    if (index < 0) return;
    currentIndex = index;
    activePageId = page.id;
    selection = null;
    if (refs.goalHubDialog.open) refs.goalHubDialog.close();
    renderAll();
  }

  function openLifeMapPage() {
    let page = book.pages.find(item => item.type === "blank" && item.planTemplate === "life-map");
    if (!page) {
      page = makePage("blank", PLAN_TEMPLATE_PAGES["life-map"].title, { planTemplate: "life-map" });
      book.pages.splice(currentIndex + 1, 0, page);
      commitHistory();
    }
    navigateToBookPage(page);
  }

  function openGoalDetailPage(goalId) {
    const goal = outcomeGoalById(goalId);
    if (!goal) return;
    let page = book.pages.find(item =>
      item.type === "blank" && item.planTemplate === "goal-detail" && item.goalId === goalId
    );
    if (!page) {
      page = makePage("blank", goal.title, { planTemplate: "goal-detail", goalId });
      book.pages.splice(currentIndex + 1, 0, page);
      commitHistory();
    }
    navigateToBookPage(page);
  }

  function receiveTodayMissions() {
    const today = new Date();
    const daily = ensureDailyPage(today);
    const result = receiveMissionsForDate(today, daily.page);
    const weekResult = receiveMissionsForWeek(isoDate(mondayOf(today)));
    const extraAdded = materializeDueMissions();
    if (daily.created || result.added || weekResult.added || extraAdded) commitHistory();
    currentIndex = daily.index;
    activePageId = daily.page.id;
    selection = null;
    if (refs.goalHubDialog.open) refs.goalHubDialog.close();
    renderAll();
    const totalAdded = result.added + weekResult.added + extraAdded;
    const totalSkipped = result.skipped + weekResult.skipped;
    if (totalAdded) {
      showToast(`미션 ${totalAdded}개를 일간·주간 계획에 추가했습니다${totalSkipped ? ` · 빈칸 부족 ${totalSkipped}개` : ""}`);
    } else if (result.due || weekResult.due) {
      showToast("받을 미션은 이미 일간·주간 계획에 있습니다");
    } else {
      showToast(daily.created ? "오늘의 일간 페이지를 만들었습니다" : "오늘 실행할 미션이 없습니다");
    }
  }

  function goToToday() {
    const today = new Date();
    const daily = ensureDailyPage(today);
    const result = receiveMissionsForDate(today, daily.page);
    const weekResult = receiveMissionsForWeek(isoDate(mondayOf(today)));
    const extraAdded = materializeDueMissions();
    if (daily.created || result.added || weekResult.added || extraAdded) commitHistory();
    currentIndex = daily.index;
    activePageId = daily.page.id;
    selection = null;
    renderAll();
    const totalAdded = result.added + weekResult.added + extraAdded;
    if (totalAdded) showToast(`오늘의 일간·주간 계획에 미션 ${totalAdded}개를 준비했습니다`);
    else if (daily.created) showToast("오늘의 일간 페이지를 만들었습니다");
  }

  // GitHub Releases의 최신 릴리스에서 새 APK를 찾아 설치까지 이어 준다.
  // 파일 이름의 버전(예: BulletBook_v0.38.0.apk)을 지금 버전과 비교한다.
  let updateCheckBusy = false;

  function setUpdateStatus(message) {
    if (refs.mobileUpdateStatus) refs.mobileUpdateStatus.textContent = message;
  }

  async function checkForAppUpdate() {
    const api = window.BulletBookCloudSync?.appUpdate;
    if (!api?.supported()) {
      setUpdateStatus("이 버전에서는 앱 안에서 업데이트를 받을 수 없습니다. APK를 직접 설치해 주세요.");
      return;
    }
    if (updateCheckBusy) return;
    updateCheckBusy = true;
    refs.mobileUpdateButton.disabled = true;
    setUpdateStatus("GitHub에서 새 버전을 확인하는 중…");
    try {
      const info = await api.check();
      if (info.reason === "NO_RELEASE") {
        setUpdateStatus("아직 GitHub에 릴리스가 없습니다.");
        return;
      }
      if (info.reason === "NO_APK") {
        setUpdateStatus("릴리스에 APK 파일이 없습니다.");
        return;
      }
      if (!info.available) {
        setUpdateStatus(`이미 최신입니다 (현재 ${info.currentVersion}).`);
        return;
      }
      const megabytes = (Number(info.size) / (1024 * 1024)).toFixed(1);
      setUpdateStatus(`새 버전을 찾았습니다: ${info.name} (${megabytes}MB). 내려받아 설치를 시작합니다…`);
      await api.install(info.itemId);
      setUpdateStatus("설치 화면이 열렸습니다. 안내에 따라 진행해 주세요.");
    } catch (error) {
      setUpdateStatus(error?.message || "업데이트에 실패했습니다.");
    } finally {
      updateCheckBusy = false;
      refs.mobileUpdateButton.disabled = false;
    }
  }

  // Windows: GitHub Releases의 windows zip을 받아 형제 폴더에 풀어 둔다.
  // 실행 중인 폴더를 덮어쓰지 않으므로 안전하고, 새 폴더 위치를 알려 준다.
  let desktopUpdateBusy = false;

  function setDesktopUpdateStatus(message) {
    if (refs.desktopUpdateStatus) refs.desktopUpdateStatus.textContent = message || "";
  }

  async function checkForDesktopUpdate() {
    if (isAndroidApp || desktopUpdateBusy) return;
    desktopUpdateBusy = true;
    refs.desktopUpdateButton.disabled = true;
    setDesktopUpdateStatus("GitHub에서 새 버전을 확인하는 중…");
    try {
      const info = await (await fetch("/api/update/check")).json();
      if (info.reason === "NO_RELEASE") {
        setDesktopUpdateStatus("아직 GitHub에 릴리스가 없습니다.");
        return;
      }
      if (info.reason === "NO_ZIP") {
        setDesktopUpdateStatus("릴리스에 windows zip 파일이 없습니다.");
        return;
      }
      if (!info.available) {
        setDesktopUpdateStatus(`이미 최신입니다 (현재 ${info.currentVersion}).`);
        return;
      }
      const megabytes = (Number(info.size) / (1024 * 1024)).toFixed(1);
      setDesktopUpdateStatus(`새 버전 ${info.name} (${megabytes}MB) 내려받는 중…`);
      const applied = await (await fetch("/api/update/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })).json();
      if (applied.message) throw new Error(applied.message);
      setDesktopUpdateStatus(
        `새 버전을 풀었습니다: ${applied.installedTo} — 지금 창을 닫고 그 폴더의 Start_BulletBook.bat을 실행해 주세요.`
      );
      showToast(`새 버전 ${applied.version}을(를) 옆 폴더에 준비했습니다`);
    } catch (error) {
      setDesktopUpdateStatus(error?.message || "업데이트에 실패했습니다.");
    } finally {
      desktopUpdateBusy = false;
      refs.desktopUpdateButton.disabled = false;
    }
  }

  function toggleMobileAdvancedEditing() {
    advancedMobileEditing = !advancedMobileEditing;
    document.documentElement.classList.toggle("mobile-advanced", advancedMobileEditing);
    refs.mobileAdvancedToggle.textContent = advancedMobileEditing
      ? "Windows식 고급 편집 끄기" : "Windows식 고급 편집 켜기";
    if (!advancedMobileEditing) {
      selection = null;
      setTool("select", false);
    }
    if (refs.mobileMoreDialog.open) refs.mobileMoreDialog.close();
    renderAll();
    showToast(advancedMobileEditing
      ? "고급 편집을 켰습니다" : "간단 확인·메모 모드로 돌아왔습니다");
  }

  function createGroup(name, kind = "custom", parentId = null, extra = {}) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return null;
    const normalizedParentId = parentId || null;
    const existing = book.groups.find(group =>
      group.name === cleanName && (group.parentId || null) === normalizedParentId
    );
    if (existing) {
      Object.entries(extra).forEach(([key, value]) => {
        if (existing[key] === undefined || existing[key] === null) existing[key] = value;
      });
      return existing;
    }
    const group = {
      id: uid(), name: cleanName, kind, parentId: normalizedParentId,
      createdAt: new Date().toISOString(),
      ...extra,
    };
    book.groups.push(group);
    return group;
  }

  function yearGroupForYear(value) {
    const year = clamp(Math.round(Number(value) || new Date().getFullYear()), 1900, 2200);
    let group = book.groups.find(candidate =>
      candidate.kind === "year" && Number(candidate.year) === year
    ) || book.groups.find(candidate =>
      !candidate.parentId && candidate.name.trim() === `${year}년`
    );
    if (!group) group = createGroup(`${year}년`, "year", null, {
      id: `calendar-year-${year}`,
      year,
    });
    group.kind = "year";
    group.year = year;
    group.parentId = null;
    return group;
  }

  function monthGroupForYearMonth(yearValue, monthValue) {
    const year = clamp(Math.round(Number(yearValue) || new Date().getFullYear()), 1900, 2200);
    const month = clamp(Math.round(Number(monthValue) || 1), 1, 12);
    const yearGroup = yearGroupForYear(year);
    let group = book.groups.find(candidate =>
      candidate.kind === "month" && Number(candidate.year) === year &&
      Number(candidate.month) === month
    );
    if (!group) {
      group = book.groups.find(candidate => {
        const context = groupPathForId(candidate.id);
        const pathYear = context.map(item => Number(item.year) || yearFromLabel(item.name))
          .find(Boolean);
        const pathMonth = Number(candidate.month) || monthFromLabel(candidate.name);
        return candidate.kind === "month" && pathYear === year && pathMonth === month;
      });
    }
    if (!group) {
      // 0.23 이하에서 만든 "2026년 8월" 최상위 그룹도 기록을 그대로 둔 채
      // 새 연도 계층 아래로 편입한다.
      group = book.groups.find(candidate =>
        !candidate.parentId && candidate.name.trim() === `${year}년 ${month}월`
      );
    }
    if (!group) {
      group = createGroup(`${month}월`, "month", yearGroup.id, {
        id: `calendar-month-${year}-${String(month).padStart(2, "0")}`,
        year,
        month,
      });
    }
    group.kind = "month";
    group.year = year;
    group.month = month;
    group.parentId = yearGroup.id;
    if (group.name.trim() === `${year}년 ${month}월`) group.name = `${month}월`;
    return group;
  }

  function monthGroupForDate(value) {
    const date = typeof value === "string" ? dateFromIso(value) : new Date(value);
    return monthGroupForYearMonth(date.getFullYear(), date.getMonth() + 1);
  }

  function weekNumberForMonday(value) {
    const monday = mondayOf(value);
    return Math.floor((monday.getDate() - 1) / 7) + 1;
  }

  function weekGroupForDate(value) {
    const monday = mondayOf(value);
    const weekStart = isoDate(monday);
    // 주차는 월요일이 속한 달의 것으로 분류한다.
    const monthGroup = monthGroupForDate(monday);
    const number = weekNumberForMonday(monday);
    let group = book.groups.find(candidate =>
      candidate.kind === "week" && candidate.weekStart === weekStart
    );
    if (!group) {
      group = createGroup(`${number}주차`, "week", monthGroup.id, {
        id: `calendar-week-${weekStart}`,
        year: monday.getFullYear(),
        month: monday.getMonth() + 1,
        weekStart,
        weekNumber: number,
      });
    }
    group.kind = "week";
    group.name = `${number}주차`;
    group.parentId = monthGroup.id;
    group.year = monday.getFullYear();
    group.month = monday.getMonth() + 1;
    group.weekStart = weekStart;
    group.weekNumber = number;
    return group;
  }

  function insertIndexForGroup(groupId, fallbackIndex) {
    if (!groupId) return clamp(fallbackIndex, 1, book.pages.length);
    const targetIds = groupDescendantIdSet(groupId);
    let lastGroupIndex = -1;
    book.pages.forEach((page, index) => {
      if (targetIds.has(page.groupId)) lastGroupIndex = index;
    });
    return lastGroupIndex >= 0
      ? lastGroupIndex + 1
      : clamp(fallbackIndex, 1, book.pages.length);
  }

  function insertIndexAtGroupStart(groupId, fallbackIndex) {
    if (!groupId) return clamp(fallbackIndex, 1, book.pages.length);
    const targetIds = groupDescendantIdSet(groupId);
    const firstIndex = book.pages.findIndex(page => targetIds.has(page.groupId));
    if (firstIndex >= 0) return firstIndex;
    const group = book.groups.find(candidate => candidate.id === groupId);
    return group?.parentId
      ? insertIndexForGroup(group.parentId, fallbackIndex)
      : clamp(fallbackIndex, 1, book.pages.length);
  }

  function ensureYearCalendarPages(yearValue) {
    const year = clamp(Math.round(Number(yearValue) || new Date().getFullYear()), 1900, 2200);
    const existing = book.pages.filter(page =>
      isYearCalendarTemplate(page.planTemplate) &&
      Number(page.year) === year
    );
    if (existing.length >= YEAR_CALENDAR_PAGES.length) {
      return { pages: existing, created: false };
    }
    const group = yearGroupForYear(year);
    const pairId = existing[0]?.calendarPairId || `calendar-year-pair-${year}`;
    const pages = [...existing];
    YEAR_CALENDAR_PAGES.forEach(({ key, months, range }) => {
      if (pages.some(page => page.planTemplate === key)) return;
      pages.push(makePage("blank", `${year}년 연간 계획 · ${range}`, {
        id: `calendar-year-page-${year}-${key.slice("year-calendar-".length)}`,
        planTemplate: key,
        year,
        months: [...months],
        calendarPairId: pairId,
        groupId: group.id,
      }));
    });
    pages.forEach(page => {
      page.calendarPairId = pairId;
      page.groupId = group.id;
    });
    const newPages = pages.filter(page => !book.pages.some(candidate => candidate.id === page.id));
    if (newPages.length) {
      const insertAt = insertIndexAtGroupStart(group.id, Math.min(currentIndex + 1, book.pages.length));
      book.pages.splice(insertAt, 0, ...newPages.sort((left, right) =>
        left.planTemplate.localeCompare(right.planTemplate)
      ));
    }
    book.pages = normalizeGroupPageOrder(book.pages, book.groups);
    return { pages, created: newPages.length > 0 };
  }

  function ensureCalendarFeatureSetup() {
    if (Number(book.calendarFeatureVersion) >= 1) return false;
    ensureYearCalendarPages(new Date().getFullYear());
    book.pages.forEach(page => {
      if (page.type === "daily" && normalizedDateOrBlank(page.pageDate)) {
        page.groupId = weekGroupForDate(dateFromIso(page.pageDate)).id;
        return;
      }
      if (isWeeklyPage(page) && normalizedWeekStart(page.weekStart)) {
        const monday = mondayOf(dateFromIso(page.weekStart));
        page.weekStart = isoDate(monday);
        page.weekNumber = String(weekNumberForMonday(monday));
        if (page.titleCustomized !== true) page.title = weeklyPageTitle(page);
        page.groupId = weekGroupForDate(monday).id;
        return;
      }
      if (page.type === "monthly") {
        const context = monthlyDateContext(page);
        if (context.hasCalendarDate) {
          page.year = context.year;
          page.month = context.month;
          page.groupId = monthGroupForYearMonth(context.year, context.month).id;
        }
      }
    });
    alignWeeklyPairGroups(book.pages, book.groups);
    book.pages = normalizeGroupPageOrder(book.pages, book.groups);
    book.calendarFeatureVersion = 1;
    return true;
  }

  function ensureMonthlyPage(yearValue, monthValue) {
    const year = Number(yearValue);
    const month = Number(monthValue);
    ensureYearCalendarPages(year);
    let page = book.pages.find(candidate => candidate.type === "monthly" && (() => {
      const context = monthlyDateContext(candidate);
      return context.hasCalendarDate && context.year === year && context.month === month;
    })());
    if (page) return { page, created: false };
    const group = monthGroupForYearMonth(year, month);
    page = makePage("monthly", "", {
      id: `calendar-month-page-${year}-${String(month).padStart(2, "0")}`,
      year,
      month,
      groupId: group.id,
    });
    const insertAt = insertIndexAtGroupStart(group.id, currentIndex + 1);
    book.pages.splice(insertAt, 0, page);
    book.pages = normalizeGroupPageOrder(book.pages, book.groups);
    return { page, created: true };
  }

  function ensureWeeklyPagePair(value) {
    const monday = mondayOf(value);
    const weekStart = isoDate(monday);
    ensureMonthlyPage(monday.getFullYear(), monday.getMonth() + 1);
    const existing = book.pages.find(page =>
      isWeeklyPage(page) && !page.continuationOf && normalizedWeekStart(page.weekStart) === weekStart
    );
    if (existing) return { pages: weeklyPairPages(existing), created: false };
    const group = weekGroupForDate(monday);
    const pages = makeWeeklyPagePair();
    const number = weekNumberForMonday(monday);
    pages.forEach(page => {
      page.id = `calendar-week-page-${weekStart}-${page.type === "weekly-left" ? "left" : "right"}`;
      page.weekStart = weekStart;
      page.weekNumber = String(number);
      page.title = weeklyPageTitle(page, number);
      page.groupId = group.id;
    });
    const insertAt = insertIndexAtGroupStart(group.id, currentIndex + 1);
    book.pages.splice(insertAt, 0, ...pages);
    book.pages = normalizeGroupPageOrder(book.pages, book.groups);
    return { pages, created: true };
  }

  function promptIsoDate(message, initial = isoDate(new Date())) {
    const value = prompt(message, initial);
    if (value === null) return null;
    const date = normalizedDateOrBlank(value.trim());
    if (!date) showToast("예: 2026-08-03 형식으로 입력해 주세요");
    return date || null;
  }

  function promptYearMonth(initialDate = new Date()) {
    const initial = `${initialDate.getFullYear()}-${String(initialDate.getMonth() + 1).padStart(2, "0")}`;
    const value = prompt("추가할 월을 YYYY-MM으로 입력하세요", initial);
    if (value === null) return null;
    const match = value.trim().match(/^(\d{4})-(\d{1,2})$/u);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
      showToast("예: 2026-08 형식으로 입력해 주세요");
      return null;
    }
    return { year: Number(match[1]), month: Number(match[2]) };
  }

  function addPageGroup() {
    const name = prompt("새 페이지 그룹 이름", "새 그룹");
    if (!name?.trim()) return;
    const page = book.pages[currentIndex];
    if (!page || page.type === "cover") {
      showToast("표지는 그룹에 넣을 수 없습니다");
      return;
    }
    const group = createGroup(name);
    activePageId = page.id;
    if (book.pages.some(item => item.id !== page.id && item.groupId === group.id)) {
      movePageIntoGroup(page.id, group.id);
      return;
    }
    const groupedIds = new Set(orderedMovablePageIds([page.id]));
    book.pages.forEach(candidate => {
      if (groupedIds.has(candidate.id)) candidate.groupId = group.id;
    });
    book.pages = normalizeGroupPageOrder(book.pages, book.groups);
    currentIndex = Math.max(0, book.pages.findIndex(candidate => candidate.id === activePageId));
    collapsedGroups.delete(group.id);
    commitHistory();
    renderAll();
    showToast(`"${group.name}" 그룹을 만들었습니다`);
  }

  function openPageGroupEditor(groupId) {
    const group = book.groups.find(item => item.id === groupId);
    if (!group) return;
    editingGroupId = group.id;
    refs.groupEditName.setCustomValidity("");
    refs.groupEditName.value = group.name;
    const excludedIds = groupDescendantIdSet(group.id);
    refs.groupEditParent.innerHTML = `<option value="">상위 그룹 없음</option>` +
      book.groups
        .filter(candidate => !excludedIds.has(candidate.id))
        .map(candidate => {
          const depth = Math.max(0, groupPathForId(candidate.id).length - 1);
          const label = `${"— ".repeat(depth)}${candidate.name}`;
          return `<option value="${escapeHtml(candidate.id)}">${escapeHtml(label)}</option>`;
        }).join("");
    refs.groupEditParent.value = group.parentId || "";
    if (!refs.groupEditDialog.open) refs.groupEditDialog.showModal();
    requestAnimationFrame(() => {
      refs.groupEditName.focus();
      refs.groupEditName.select();
    });
  }

  function closePageGroupEditor() {
    editingGroupId = null;
    refs.groupEditName.setCustomValidity("");
    if (refs.groupEditDialog.open) refs.groupEditDialog.close();
  }

  function renamePageGroup() {
    const group = book.groups.find(item => item.id === editingGroupId);
    if (!group) {
      closePageGroupEditor();
      return;
    }
    const nextName = refs.groupEditName.value.trim();
    if (!nextName) {
      refs.groupEditName.setCustomValidity("그룹 이름을 입력해 주세요.");
      refs.groupEditName.reportValidity();
      return;
    }
    const nextParentId = refs.groupEditParent.value || null;
    const duplicate = book.groups.some(item =>
      item.id !== group.id &&
      (item.parentId || null) === nextParentId &&
      item.name.toLocaleLowerCase() === nextName.toLocaleLowerCase()
    );
    if (duplicate) {
      refs.groupEditName.setCustomValidity("같은 이름의 그룹이 이미 있습니다.");
      refs.groupEditName.reportValidity();
      return;
    }
    refs.groupEditName.setCustomValidity("");
    const previousName = group.name;
    const previousParentId = group.parentId || null;
    if (!canSetGroupParent(group.id, nextParentId)) {
      showToast("자기 자신이나 하위 그룹 안으로는 이동할 수 없습니다");
      return;
    }
    group.name = nextName;
    if (nextParentId && nextParentId !== previousParentId) {
      closePageGroupEditor();
      if (reorderGroupFromList(group.id, { nestIntoGroupId: nextParentId })) return;
    }
    group.parentId = nextParentId;
    book.pages = normalizeGroupPageOrder(book.pages, book.groups);
    syncGroupOrderToPageOrder();
    closePageGroupEditor();
    commitHistory();
    renderAll();
    if (previousParentId !== nextParentId) {
      showToast(nextParentId ? "상위 그룹을 변경했습니다" : "최상위 그룹으로 이동했습니다");
    } else {
      showToast(previousName === nextName
        ? "그룹 설정을 유지했습니다"
        : `"${previousName}" 그룹 이름을 "${nextName}"(으)로 바꿨습니다`);
    }
  }

  function deletePageGroup() {
    const group = book.groups.find(item => item.id === editingGroupId);
    if (!group) {
      closePageGroupEditor();
      return;
    }
    const pageCount = book.pages.filter(page => page.groupId === group.id).length;
    const childCount = book.groups.filter(item => item.parentId === group.id).length;
    const detail = `직접 포함된 페이지 ${pageCount}쪽과 하위 그룹 ${childCount}개는 삭제되지 않고 한 단계 위로 이동합니다.`;
    if (!confirm(`"${group.name}" 그룹을 삭제할까요?\n\n${detail}`)) return;
    book.pages.forEach(page => {
      if (page.groupId === group.id) page.groupId = group.parentId || null;
    });
    book.groups.forEach(item => {
      if (item.parentId === group.id) item.parentId = group.parentId || null;
    });
    book.groups = book.groups.filter(item => item.id !== group.id);
    book.pages = normalizeGroupPageOrder(book.pages, book.groups);
    syncGroupOrderToPageOrder();
    collapsedGroups.delete(group.id);
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsedGroups]));
    const deletedName = group.name;
    closePageGroupEditor();
    commitHistory();
    renderAll();
    showToast(`"${deletedName}" 그룹만 삭제했습니다. 페이지와 하위 그룹은 유지됩니다.`);
  }

  function addTemplate(type) {
    if (type === "life-map") {
      openLifeMapPage();
      return;
    }
    let newPages;
    const currentPage = book.pages[currentIndex];
    let targetGroupId = currentPage?.type === "cover"
      ? null
      : currentPage?.groupId || null;
    if (isYearCalendarTemplate(type)) {
      const yearText = prompt("연간 달력의 연도를 입력하세요", String(new Date().getFullYear()));
      if (yearText === null) return;
      const year = Number(yearText.trim());
      if (!Number.isInteger(year) || year < 1900 || year > 2200) {
        showToast("1900~2200 사이의 연도를 입력해 주세요");
        return;
      }
      const result = ensureYearCalendarPages(year);
      const firstKey = YEAR_CALENDAR_PAGES[0].key;
      const page = result.pages.find(candidate => candidate.planTemplate === firstKey) || result.pages[0];
      currentIndex = book.pages.findIndex(candidate => candidate.id === page.id);
      activePageId = page.id;
      if (result.created) commitHistory();
      renderAll();
      showToast(result.created
        ? `${year}년 연간 달력 ${YEAR_CALENDAR_PAGES.length}쪽을 추가했습니다`
        : `${year}년 연간 달력으로 이동했습니다`);
      return;
    } else if (type === "monthly") {
      const selected = promptYearMonth();
      if (!selected) return;
      const result = ensureMonthlyPage(selected.year, selected.month);
      currentIndex = book.pages.findIndex(candidate => candidate.id === result.page.id);
      activePageId = result.page.id;
      if (result.created) commitHistory();
      renderAll();
      showToast(result.created ? `${selected.year}년 ${selected.month}월 계획을 추가했습니다` : "이미 만든 월간 계획으로 이동했습니다");
      return;
    } else if (type === "weekly-left") {
      const dateValue = promptIsoDate("추가할 주에 포함된 날짜를 입력하세요. 월요일로 자동 맞춥니다.");
      if (!dateValue) return;
      const result = ensureWeeklyPagePair(dateFromIso(dateValue));
      const page = result.pages.find(candidate => candidate.type === "weekly-left") || result.pages[0];
      currentIndex = book.pages.findIndex(candidate => candidate.id === page.id);
      activePageId = page.id;
      const missionsAdded = materializeDueMissions() > 0;
      if (result.created || missionsAdded) commitHistory();
      renderAll();
      showToast(result.created ? "주간 계획 두 쪽을 날짜 그룹에 추가했습니다" : "이미 만든 주간 계획으로 이동했습니다");
      return;
    } else if (type === "daily" || type === "daily-week") {
      const dateValue = promptIsoDate(type === "daily-week"
        ? "만들 주에 포함된 날짜를 입력하세요. 월~일 7쪽을 만듭니다."
        : "일간 계획 날짜를 입력하세요");
      if (!dateValue) return;
      const baseDate = dateFromIso(dateValue);
      const dates = type === "daily-week"
        ? Array.from({ length: 7 }, (_, index) => offsetDate(mondayOf(baseDate), index))
        : [baseDate];
      const results = dates.map(date => ensureDailyPage(date));
      const first = results[0].page;
      currentIndex = book.pages.findIndex(candidate => candidate.id === first.id);
      activePageId = first.id;
      const missionsAdded = materializeDueMissions() > 0;
      if (results.some(result => result.created) || missionsAdded) commitHistory();
      renderAll();
      showToast(type === "daily-week"
        ? `일간 계획 ${results.filter(result => result.created).length}쪽을 추가했습니다`
        : results[0].created ? "일간 계획을 추가했습니다" : "이미 만든 일간 계획으로 이동했습니다");
      return;
    } else if (PLAN_TEMPLATE_PAGES[type]) {
      newPages = [makePage("blank", PLAN_TEMPLATE_PAGES[type].title, {
        planTemplate: type,
      })];
    } else if (type === "future-h1") {
      newPages = [
        makePage("future-h1", "미래 기록 · 1–6월", { year: null, months: [1,2,3,4,5,6] }),
        makePage("future-h2", "미래 기록 · 7–12월", { year: null, months: [7,8,9,10,11,12] }),
      ];
    } else {
      newPages = [makePage(type, templateNames[type])];
    }
    // 그룹 안에서 추가한 양식은 같은 그룹에 넣는다. 특히 주간 양면 중
    // 한쪽만 7월 그룹에 있고 다른 한쪽이 목록 아래로 빠지는 일을 막는다.
    if (targetGroupId) {
      newPages.forEach(page => {
        if (page.type !== "cover") page.groupId = targetGroupId;
      });
    }
    const insertAt = insertIndexForGroup(targetGroupId, currentIndex + 1);
    book.pages.splice(insertAt, 0, ...newPages);
    currentIndex = insertAt;
    activePageId = book.pages[currentIndex].id;
    commitHistory();
    renderAll();
    showToast(`${newPages.length}개 페이지를 추가했습니다`);
  }

  function checkedPagesInBookOrder() {
    return book.pages.filter(page =>
      page.type !== "cover" && selectedPageIds.has(page.id)
    );
  }

  function updateSelectedPageActions() {
    const count = checkedPagesInBookOrder().length;
    if (!refs.duplicatePageButton || !refs.deletePageButton) return;
    refs.duplicatePageButton.disabled = count === 0;
    refs.deletePageButton.disabled = count === 0;
    refs.duplicatePageButton.textContent = count
      ? `선택한 페이지 ${count}쪽 복제`
      : "선택한 페이지 복제";
    refs.deletePageButton.textContent = count
      ? `선택한 페이지 ${count}쪽 삭제`
      : "선택한 페이지 삭제";
  }

  function duplicateCheckedPages() {
    const sources = checkedPagesInBookOrder();
    if (!sources.length) {
      showToast("복제할 페이지를 먼저 체크해 주세요");
      return;
    }

    const sourceIds = new Set(sources.map(page => page.id));
    const weeklyPairIds = new Map();
    const copiesBySourceId = new Map();
    sources.forEach(source => {
      const copy = clone(source);
      copy.id = uid();
      if (copy.type === "weekly-left" || copy.type === "weekly-right") {
        const sourcePairId = source.weeklyPairId || source.id;
        if (!weeklyPairIds.has(sourcePairId)) weeklyPairIds.set(sourcePairId, uid());
        copy.weeklyPairId = weeklyPairIds.get(sourcePairId);
      }
      setPageTitle(copy, `${pageDisplayTitle(copy)} 사본`);
      copy.elements.forEach(element => element.id = uid());
      copiesBySourceId.set(source.id, copy);
    });

    // 같은 그룹에서 연속으로 체크한 페이지는 사본도 한 묶음으로 이어 붙인다.
    // 서로 다른 그룹의 사본은 각 그룹의 원본 바로 뒤에 남도록 한다.
    const nextPages = [];
    let pendingCopies = [];
    book.pages.forEach((page, index) => {
      nextPages.push(page);
      if (!sourceIds.has(page.id)) return;
      pendingCopies.push(copiesBySourceId.get(page.id));
      const nextPage = book.pages[index + 1];
      const continuesSelection = nextPage &&
        sourceIds.has(nextPage.id) &&
        (nextPage.groupId || null) === (page.groupId || null);
      if (!continuesSelection) {
        nextPages.push(...pendingCopies);
        pendingCopies = [];
      }
    });
    if (pendingCopies.length) nextPages.push(...pendingCopies);
    book.pages = nextPages;

    const copies = sources.map(source => copiesBySourceId.get(source.id));
    selectedPageIds.clear();
    copies.forEach(copy => selectedPageIds.add(copy.id));
    currentIndex = book.pages.findIndex(page => page.id === copies[0].id);
    activePageId = copies[0].id;
    selection = null;
    commitHistory();
    renderAll();
    showToast(`선택한 페이지 ${copies.length}쪽을 복제했습니다`);
  }

  function deleteCheckedPages() {
    const pages = checkedPagesInBookOrder();
    if (!pages.length) {
      showToast("삭제할 페이지를 먼저 체크해 주세요");
      return;
    }
    if (pages.length >= book.pages.length) {
      showToast("책의 모든 페이지를 삭제할 수는 없습니다");
      return;
    }
    const detail = pages.length === 1
      ? `"${pageDisplayTitle(pages[0])}" 페이지`
      : `선택한 페이지 ${pages.length}쪽`;
    if (!confirm(`${detail}을 삭제할까요?`)) return;

    const deleteIds = new Set(pages.map(page => page.id));
    const currentPageId = book.pages[currentIndex]?.id;
    const firstDeletedIndex = book.pages.findIndex(page => deleteIds.has(page.id));
    book.pages = book.pages.filter(page => !deleteIds.has(page.id));
    pruneEmptyCalendarGroups();
    selectedPageIds.clear();

    const retainedCurrentIndex = book.pages.findIndex(page => page.id === currentPageId);
    currentIndex = retainedCurrentIndex >= 0
      ? retainedCurrentIndex
      : clamp(firstDeletedIndex, 0, book.pages.length - 1);
    activePageId = book.pages[currentIndex].id;
    selection = null;
    commitHistory();
    renderAll();
    showToast(`${pages.length}쪽을 삭제했습니다`);
  }

  function navigate(direction) {
    if (isSpreadView()) {
      const left = Math.floor(currentIndex / 2) * 2;
      currentIndex = clamp(left + direction * 2, 0, book.pages.length - 1);
    } else {
      currentIndex = clamp(currentIndex + direction, 0, book.pages.length - 1);
    }
    activePageId = book.pages[currentIndex].id;
    selection = null;
    renderAll();
  }

  function updateStatus() {
    const indexes = visibleIndexes();
    refs.pageStatus.textContent = indexes.length === 2
      ? `${indexes[0] + 1}–${indexes[1] + 1} / ${book.pages.length}`
      : `${indexes[0] + 1} / ${book.pages.length}`;
    refs.prev.disabled = Math.min(...indexes) <= 0;
    refs.next.disabled = Math.max(...indexes) >= book.pages.length - 1;
  }

  function markDirty() {
    book.syncPristine = false;
    book.updatedAt = new Date().toISOString();
    saveRevision += 1;
    refs.saveDot.classList.add("dirty");
    refs.saveState.textContent = "저장 중…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBook, 450);
  }

  function isLocalDirty() {
    return refs.saveDot.classList.contains("dirty") || saveTimer !== null;
  }

  async function persistSnapshot(snapshot) {
    try {
      await dbPut(snapshot);
      return true;
    } catch (error) {
      console.error(error);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        return true;
      } catch {
        return false;
      }
    }
  }

  function enqueueLocalSnapshot(snapshot) {
    const operation = localSaveQueue.then(
      () => persistSnapshot(snapshot),
      () => persistSnapshot(snapshot)
    );
    localSaveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function saveBook(options = {}) {
    const scheduleCloud = options.scheduleCloud !== false;
    clearTimeout(saveTimer);
    saveTimer = null;
    book.title = refs.bookTitle.value.trim() || "나의 불렛북";
    book.updatedAt = new Date().toISOString();
    const revision = saveRevision;
    const snapshot = clone(book);
    const saved = await enqueueLocalSnapshot(snapshot);
    if (!saved) {
      refs.saveDot.classList.add("dirty");
      refs.saveState.textContent = "저장 실패";
      showToast("저장 공간이 부족합니다. 파일 저장으로 백업해 주세요.");
      return false;
    }
    if (revision === saveRevision && saveTimer === null) {
      refs.saveDot.classList.remove("dirty");
      refs.saveState.textContent = "저장됨";
    } else {
      refs.saveDot.classList.add("dirty");
      refs.saveState.textContent = "저장 중…";
    }
    if (scheduleCloud) cloudSync?.scheduleUpload();
    syncCalendarWidget();
    return true;
  }

  async function flushLocalChanges() {
    if (!isLocalDirty()) return true;
    return saveBook({ scheduleCloud: false });
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
      const request = indexedDB.open(DB_NAME, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        if (!db.objectStoreNames.contains(SEARCH_STORE)) {
          const store = db.createObjectStore(SEARCH_STORE, { keyPath: "id" });
          store.createIndex("pageId", "pageId");
          store.createIndex("groupId", "groupId");
          store.createIndex("bulletType", "bulletType");
          store.createIndex("status", "status");
          store.createIndex("pageDate", "pageDate");
          store.createIndex("tags", "tags", { multiEntry: true });
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains(SYNC_STORE)) db.createObjectStore(SYNC_STORE);
        if (!db.objectStoreNames.contains(RECOVERY_STORE)) {
          const store = db.createObjectStore(RECOVERY_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbPut(value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([DB_STORE, SEARCH_STORE], "readwrite");
      transaction.objectStore(DB_STORE).put(value, DB_KEY);
      const searchStore = transaction.objectStore(SEARCH_STORE);
      searchStore.clear();
      buildSearchEntries(value).forEach(entry => searchStore.put(entry));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function dbGet() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(DB_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbGetSyncBase() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(SYNC_STORE, "readonly")
        .objectStore(SYNC_STORE).get(SYNC_BASE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbPutSyncBase(value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_STORE, "readwrite");
      transaction.objectStore(SYNC_STORE).put(value, SYNC_BASE_KEY);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function dbClearSyncBase() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_STORE, "readwrite");
      transaction.objectStore(SYNC_STORE).delete(SYNC_BASE_KEY);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function dbListRecoverySnapshots() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(RECOVERY_STORE, "readonly")
        .objectStore(RECOVERY_STORE).getAll();
      request.onsuccess = () => resolve((request.result || [])
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))));
      request.onerror = () => reject(request.error);
    });
  }

  async function dbGetRecoverySnapshot(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(RECOVERY_STORE, "readonly")
        .objectStore(RECOVERY_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbAddRecoverySnapshot(snapshot) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(RECOVERY_STORE, "readwrite");
      const store = transaction.objectStore(RECOVERY_STORE);
      store.put(snapshot);
      let kept = 0;
      const cursorRequest = store.index("createdAt").openCursor(null, "prev");
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        kept += 1;
        if (kept > MAX_RECOVERY_SNAPSHOTS) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function snapshotFingerprint(value) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${text.length}-${(hash >>> 0).toString(36)}`;
  }

  async function loadSyncBase() {
    try {
      const stored = normalizeValidatedBook(await dbGetSyncBase());
      if (stored) return stored;
    } catch { /* localStorage 폴백 확인 */ }
    try {
      return normalizeValidatedBook(JSON.parse(localStorage.getItem(SYNC_BASE_FALLBACK_KEY)));
    } catch {
      return null;
    }
  }

  async function persistSyncBase(value) {
    const normalized = normalizeValidatedBook(value);
    if (!normalized) return false;
    let stored = false;
    try {
      await dbPutSyncBase(clone(normalized));
      stored = true;
    } catch { /* localStorage 폴백 사용 */ }
    try {
      localStorage.setItem(SYNC_BASE_FALLBACK_KEY, JSON.stringify(normalized));
      stored = true;
    } catch { /* IndexedDB 성공 여부를 유지 */ }
    return stored;
  }

  async function clearSyncBase() {
    let cleared = false;
    try {
      await dbClearSyncBase();
      cleared = true;
    } catch { /* localStorage도 정리 시도 */ }
    try {
      localStorage.removeItem(SYNC_BASE_FALLBACK_KEY);
      cleared = true;
    } catch { /* IndexedDB 성공 여부를 유지 */ }
    return cleared;
  }

  async function saveRecoverySnapshot(value, info = {}) {
    const normalized = normalizeValidatedBook(value);
    if (!normalized) return false;
    const fingerprint = snapshotFingerprint(normalized);
    try {
      const existing = await dbListRecoverySnapshots();
      if (existing.some(snapshot => snapshot.fingerprint === fingerprint)) return true;
    } catch { /* 저장 단계에서 다시 시도 */ }
    const snapshot = {
      id: uid(),
      createdAt: new Date().toISOString(),
      source: info.source === "cloud" ? "cloud" : "device",
      reason: String(info.reason || "manual"),
      fingerprint,
      book: clone(normalized),
    };
    let stored = false;
    try {
      await dbAddRecoverySnapshot(snapshot);
      stored = true;
    } catch { /* localStorage 폴백 사용 */ }
    try {
      localStorage.setItem(RECOVERY_FALLBACK_KEY, JSON.stringify(snapshot));
      stored = true;
    } catch { /* IndexedDB 성공 여부를 유지 */ }
    return stored;
  }

  async function listRecoverySnapshots() {
    let snapshots = [];
    try { snapshots = await dbListRecoverySnapshots(); } catch { /* 폴백만 표시 */ }
    try {
      const fallback = JSON.parse(localStorage.getItem(RECOVERY_FALLBACK_KEY));
      if (fallback?.id && !snapshots.some(snapshot => snapshot.id === fallback.id)) {
        snapshots.push(fallback);
      }
    } catch { /* ignore */ }
    return snapshots
      .filter(snapshot => normalizeValidatedBook(snapshot?.book))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, MAX_RECOVERY_SNAPSHOTS);
  }

  async function getRecoverySnapshot(id) {
    try {
      const snapshot = await dbGetRecoverySnapshot(id);
      if (snapshot) return snapshot;
    } catch { /* 폴백 확인 */ }
    try {
      const fallback = JSON.parse(localStorage.getItem(RECOVERY_FALLBACK_KEY));
      return fallback?.id === id ? fallback : null;
    } catch {
      return null;
    }
  }

  async function loadSavedBook() {
    let idbBook = null;
    let localBook = null;
    try { idbBook = normalizeValidatedBook(await dbGet()); } catch { /* ignore */ }
    try {
      localBook = normalizeValidatedBook(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch { /* ignore */ }
    if (idbBook && localBook) {
      return bookUpdatedTime(localBook) > bookUpdatedTime(idbBook) ? localBook : idbBook;
    }
    return idbBook || localBook || null;
  }

  function bookUpdatedTime(value) {
    const timestamp = Date.parse(value?.updatedAt || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function isCompatibleBook(value) {
    if (!value || value.format !== "bulletbook") return false;
    if (!Number.isInteger(value.version) || value.version < 1 ||
        value.version > CURRENT_BOOK_VERSION) return false;
    if (!Array.isArray(value.pages) || value.pages.length === 0) return false;
    return value.pages.every(page =>
      page && typeof page === "object" && PAGE_TYPES.has(page.type) &&
      (page.elements === undefined || (
        Array.isArray(page.elements) && page.elements.every(element =>
          element && typeof element === "object" && ELEMENT_TYPES.has(element.type)
        )
      ))
    );
  }

  function isValidBook(value) {
    return isCompatibleBook(value) && value.pages.every(page => Array.isArray(page.elements));
  }

  function normalizeValidatedBook(value) {
    if (!isCompatibleBook(value)) return null;
    const normalized = normalizeBook(clone(value));
    return isValidBook(normalized) ? normalized : null;
  }

  function isPristineBook(value) {
    if (Array.isArray(value?.calendarEvents) && value.calendarEvents.length) return false;
    const goalSystem = value?.goalSystem;
    if (goalSystem && [goalSystem.areas, goalSystem.goals, goalSystem.missions]
      .some(items => Array.isArray(items) && items.length > 0)) return false;
    if (value?.syncPristine === true) return true;
    if (!value || value.title !== "나의 불렛북" ||
        value.pages?.length !== DEFAULT_BOOK_SIGNATURE.length) return false;
    return value.pages.every((page, index) =>
      page.type === DEFAULT_BOOK_SIGNATURE[index][0] &&
      page.title === DEFAULT_BOOK_SIGNATURE[index][1] &&
      (!Array.isArray(page.elements) || page.elements.length === 0) &&
      (!page.templateText || Object.values(page.templateText).every(text => !String(text).trim()))
    );
  }

  function exportBook() {
    saveBook();
    const json = JSON.stringify(book, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const link = document.createElement("a");
    const safeTitle = (book.title || "나의_불렛북").replace(/[\\/:*?"<>|]+/g, "_");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeTitle}_${isoDate(new Date())}.buj`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast("불렛북 파일을 저장했습니다");
  }

  async function importBook(file) {
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) {
        showToast("파일이 너무 큽니다. 50MB 이하의 .buj 파일을 사용하세요.");
        return;
      }
      const parsed = JSON.parse(await file.text());
      const normalized = normalizeValidatedBook(parsed);
      if (!normalized) throw new Error("Invalid book");
      if (!await saveRecoverySnapshot(book, { source: "device", reason: "before-import" })) {
        showToast("현재 책의 복구본을 저장하지 못해 불러오기를 중단했습니다");
        return;
      }
      book = normalized;
      currentIndex = 0;
      activePageId = book.pages[0]?.id ?? null;
      selection = null;
      refs.bookTitle.value = book.title || "나의 불렛북";
      initializeHistory();
      renderAll();
      lastWidgetSnapshotJson = "";
      await saveBook();
      showToast("불렛북을 불러왔습니다");
    } catch {
      showToast("올바른 .buj 파일이 아닙니다");
    } finally {
      refs.importInput.value = "";
    }
  }

  const recoveryReasonLabel = reason => ({
    "before-download": "클라우드 적용 전",
    "before-upload": "클라우드 덮어쓰기 전",
    "before-merge": "양쪽 기록 병합 전",
    "before-restore": "다른 복구본 적용 전",
    "before-import": "파일 불러오기 전",
  })[reason] || "동기화 전";

  function recoveryTimeLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "시간 정보 없음";
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }

  function downloadBookValue(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function renderRecoverySnapshots() {
    const snapshots = await listRecoverySnapshots();
    if (!snapshots.length) {
      refs.recoveryList.innerHTML = '<p class="recovery-empty">아직 저장된 동기화 복구본이 없습니다.</p>';
      return;
    }
    refs.recoveryList.innerHTML = snapshots.map(snapshot => {
      const source = snapshot.source === "cloud" ? "OneDrive 사본" : "기기 사본";
      const pageCount = snapshot.book?.pages?.length || 0;
      return `
        <article class="recovery-item">
          <div class="recovery-item-copy">
            <strong>${escapeHtml(snapshot.book?.title || "나의 불렛북")}</strong>
            <span>${escapeHtml(recoveryTimeLabel(snapshot.createdAt))} · ${escapeHtml(source)} · ${escapeHtml(recoveryReasonLabel(snapshot.reason))} · ${pageCount}쪽</span>
          </div>
          <div class="recovery-item-actions">
            <button type="button" data-recovery-export="${escapeHtml(snapshot.id)}">파일 저장</button>
            <button type="button" data-recovery-restore="${escapeHtml(snapshot.id)}">복원</button>
          </div>
        </article>`;
    }).join("");
  }

  async function openRecoveryDialog() {
    if (refs.mobileMoreDialog.open) refs.mobileMoreDialog.close();
    await renderRecoverySnapshots();
    refs.recoveryDialog.showModal();
  }

  async function exportRecoverySnapshot(id) {
    const snapshot = await getRecoverySnapshot(id);
    const recovered = normalizeValidatedBook(snapshot?.book);
    if (!recovered) {
      showToast("복구본을 읽지 못했습니다");
      return;
    }
    const stamp = String(snapshot.createdAt || "")
      .replaceAll(/[^0-9]/g, "")
      .slice(0, 14) || "recovery";
    downloadBookValue(recovered, `BulletBook_recovery_${stamp}.buj`);
    showToast("복구본 파일을 저장했습니다");
  }

  async function restoreRecoverySnapshot(id) {
    const snapshot = await getRecoverySnapshot(id);
    const recovered = normalizeValidatedBook(snapshot?.book);
    if (!recovered) {
      showToast("복구본을 읽지 못했습니다");
      return;
    }
    if (!window.confirm("현재 책을 별도 복구본으로 보존하고 선택한 시점으로 복원할까요?")) return;
    if (!await saveRecoverySnapshot(book, { source: "device", reason: "before-restore" })) {
      showToast("현재 책의 복구본을 저장하지 못해 복원을 중단했습니다");
      return;
    }
    book = recovered;
    book.updatedAt = new Date().toISOString();
    book.syncPristine = false;
    currentIndex = 0;
    activePageId = book.pages[0]?.id || null;
    selection = null;
    refs.bookTitle.value = book.title || "나의 불렛북";
    initializeHistory();
    renderAll();
    lastWidgetSnapshotJson = "";
    await saveBook();
    refs.recoveryDialog.close();
    showToast("선택한 복구본으로 되돌렸습니다");
  }

  function printToPdf() {
    refs.printBook.innerHTML = "";
    book.pages.forEach((page, index) => {
      const printPage = document.createElement("div");
      printPage.className = "print-page";
      const wrap = createPageDOM(page, index, "single", { print: true });
      printPage.append(wrap);
      refs.printBook.append(printPage);
    });
    setTimeout(() => window.print(), 80);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    refs.toast.textContent = message;
    refs.toast.classList.add("show");
    toastTimer = setTimeout(() => refs.toast.classList.remove("show"), 2200);
  }

  function pageListHeightBounds() {
    const sidebarRect = refs.sidebar.getBoundingClientRect();
    const listRect = refs.pageList.getBoundingClientRect();
    const resizerHeight = Math.max(
      isAndroidApp ? 19 : 15,
      refs.sidebarListResizer.getBoundingClientRect().height || 0
    );
    const min = isAndroidApp ? 190 : 140;
    const minTools = isAndroidApp ? 96 : 120;
    const available = sidebarRect.height > 0
      ? sidebarRect.bottom - listRect.top - resizerHeight - minTools
      : 2000;
    return {
      min,
      max: Math.max(min, Math.floor(available)),
      available: Math.floor(available),
    };
  }

  function setPageListHeight(height, persist = true) {
    const bounds = pageListHeightBounds();
    const nextHeight = Math.round(clamp(Number(height) || bounds.min, bounds.min, bounds.max));
    refs.sidebar.style.setProperty("--page-list-basis", `${nextHeight}px`);
    // 여유가 최소 높이보다 좁은 화면(Fold 커버 가로 등)에서는 잠그면 도구 영역이
    // 밀려나므로, 지정 높이가 실제로 들어갈 때만 축소를 막는다.
    refs.pageList.classList.toggle("height-locked", nextHeight <= bounds.available);
    refs.sidebarListResizer.setAttribute("aria-valuemin", String(bounds.min));
    refs.sidebarListResizer.setAttribute("aria-valuemax", String(bounds.max));
    refs.sidebarListResizer.setAttribute("aria-valuenow", String(nextHeight));
    if (persist) {
      try { localStorage.setItem(PAGE_LIST_HEIGHT_KEY, String(nextHeight)); } catch { /* ignore */ }
    }
    return nextHeight;
  }

  function fitPageListHeightToSidebar() {
    const inlineHeight = parseFloat(
      refs.sidebar.style.getPropertyValue("--page-list-basis")
    );
    if (Number.isFinite(inlineHeight) && inlineHeight > 0) {
      setPageListHeight(inlineHeight, false);
    }
  }

  function resetPageListHeight() {
    refs.sidebar.style.removeProperty("--page-list-basis");
    refs.pageList.classList.remove("height-locked");
    refs.sidebarListResizer.removeAttribute("aria-valuenow");
    try { localStorage.removeItem(PAGE_LIST_HEIGHT_KEY); } catch { /* ignore */ }
    showToast("페이지 목록 높이를 기본값으로 되돌렸습니다");
  }

  function bindPageListResizer() {
    let storedHeight = 0;
    try { storedHeight = Number(localStorage.getItem(PAGE_LIST_HEIGHT_KEY)); } catch { /* ignore */ }
    if (Number.isFinite(storedHeight) && storedHeight > 0) {
      refs.sidebar.style.setProperty("--page-list-basis", `${storedHeight}px`);
      requestAnimationFrame(fitPageListHeightToSidebar);
    }

    let drag = null;
    const finishDrag = event => {
      if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
      try { refs.sidebarListResizer.releasePointerCapture?.(drag.pointerId); } catch { /* ignore */ }
      refs.sidebarListResizer.classList.remove("dragging");
      document.body.classList.remove("resizing-page-list");
      const height = parseFloat(refs.sidebar.style.getPropertyValue("--page-list-basis"));
      if (Number.isFinite(height)) {
        try { localStorage.setItem(PAGE_LIST_HEIGHT_KEY, String(Math.round(height))); } catch { /* ignore */ }
      }
      drag = null;
    };

    refs.sidebarListResizer.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      const listRect = refs.pageList.getBoundingClientRect();
      drag = { pointerId: event.pointerId, listTop: listRect.top };
      refs.sidebarListResizer.setPointerCapture?.(event.pointerId);
      refs.sidebarListResizer.classList.add("dragging");
      document.body.classList.add("resizing-page-list");
    });
    refs.sidebarListResizer.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      setPageListHeight(event.clientY - drag.listTop, false);
    });
    refs.sidebarListResizer.addEventListener("pointerup", finishDrag);
    refs.sidebarListResizer.addEventListener("pointercancel", finishDrag);
    refs.sidebarListResizer.addEventListener("dblclick", event => {
      event.preventDefault();
      resetPageListHeight();
    });
    refs.sidebarListResizer.addEventListener("keydown", event => {
      if (event.key === "Home") {
        event.preventDefault();
        resetPageListHeight();
        return;
      }
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const currentHeight = refs.pageList.getBoundingClientRect().height ||
        parseFloat(refs.sidebar.style.getPropertyValue("--page-list-basis")) || 240;
      setPageListHeight(currentHeight + (event.key === "ArrowDown" ? 24 : -24));
    });

    const sidebarResizeObserver = new ResizeObserver(fitPageListHeightToSidebar);
    sidebarResizeObserver.observe(refs.sidebar);
  }

  function openSidebar() {
    refs.sidebar.classList.add("open");
    refs.sidebarScrim.classList.add("open");
    requestAnimationFrame(fitPageListHeightToSidebar);
  }

  function closeSidebar() {
    refs.sidebar.classList.remove("open");
    refs.sidebarScrim.classList.remove("open");
  }

  function toggleSidebar() {
    if (refs.sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  }

  function handleAndroidBack() {
    if (refs.calendarEventDialog.open) {
      closeCalendarEventEditor();
      return true;
    }
    if (refs.goalEditorDialog.open) {
      closeGoalEditorToHub();
      return true;
    }
    if (refs.goalHubDialog.open) {
      refs.goalHubDialog.close();
      return true;
    }
    if (refs.mobileTextContextDialog.open) {
      closeMobileTextContext();
      return true;
    }
    if (refs.mobilePageWriteDialog.open) {
      refs.mobilePageWriteDialog.close();
      return true;
    }
    if (refs.mobileSearchDialog.open) {
      refs.mobileSearchDialog.close();
      return true;
    }
    if (refs.recoveryDialog.open) {
      refs.recoveryDialog.close();
      return true;
    }
    if (refs.mobileMoreDialog.open) {
      refs.mobileMoreDialog.close();
      return true;
    }
    if (refs.groupEditDialog.open) {
      closePageGroupEditor();
      return true;
    }
    if (refs.cloudDialog.open) {
      finishCloudAuthentication();
      Promise.resolve(cloudSync?.cancelConnect?.()).catch(() => {});
      return true;
    }
    if (refs.welcome.open) {
      refs.welcome.close();
      return true;
    }
    if (refs.sidebar.classList.contains("open")) {
      closeSidebar();
      return true;
    }
    if (selection) {
      selection = null;
      renderSpread();
      return true;
    }
    if (tool !== "select") {
      setTool("select");
      return true;
    }
    return false;
  }

  function updateCloudState(state, detail) {
    refs.cloudButton.dataset.state = state;
    refs.cloudStatus.textContent = detail;
    const labels = {
      disconnected: "동기화",
      connecting: "연결 중",
      ready: "동기화",
      syncing: "동기화 중",
      synced: "자동 동기화",
      offline: "오프라인",
      error: "동기화 오류",
    };
    refs.cloudLabel.textContent = labels[state] || "동기화";
    refs.cloudButton.title = detail;
    refs.cloudDisconnectButton.hidden = state === "disconnected";
  }

  async function applyCloudBook(nextBook) {
    const normalized = normalizeValidatedBook(nextBook);
    if (!normalized) throw new Error("올바른 불렛북 문서가 아닙니다.");
    const previousPageId = activePageId || book.pages[currentIndex]?.id || null;
    const previousIndex = currentIndex;
    clearTimeout(saveTimer);
    saveTimer = null;
    refs.saveDot.classList.remove("dirty");
    refs.saveState.textContent = "저장됨";
    book = normalized;
    const matchingIndex = previousPageId
      ? book.pages.findIndex(page => page.id === previousPageId)
      : -1;
    currentIndex = matchingIndex >= 0
      ? matchingIndex
      : clamp(previousIndex, 0, book.pages.length - 1);
    selection = null;
    refs.bookTitle.value = book.title || "나의 불렛북";
    activePageId = book.pages[currentIndex]?.id || null;
    initializeHistory();
    renderAll();
    const saved = await enqueueLocalSnapshot(clone(book));
    if (!saved) {
      refs.saveDot.classList.add("dirty");
      refs.saveState.textContent = "저장 실패";
      throw new Error("OneDrive 문서를 기기에 저장하지 못했습니다.");
    }
    // 원격 책으로 교체된 직후 위젯을 강제 갱신한다.
    lastWidgetSnapshotJson = "";
    syncCalendarWidget();
  }

  function stopCloudLoginWatch() {
    clearInterval(cloudLoginWatchTimer);
    cloudLoginWatchTimer = null;
  }

  function startCloudLoginWatch() {
    stopCloudLoginWatch();
    cloudLoginWatchTimer = window.setInterval(() => {
      if (!cloudSync?.loginPending) return;
      cloudSync.checkLoginNow();
    }, 1500);
  }

  async function recoverCloudAccountAfterBrowser() {
    if (!cloudSync) return false;
    if (cloudSync.loginPending) {
      refs.cloudLoginButton.disabled = false;
      refs.cloudLoginButton.textContent = "승인 완료 확인";
      cloudSync.checkLoginNow();
      return false;
    }
    if (cloudSync.connected) {
      finishCloudAuthentication();
      return true;
    }
    if (cloudRecoveryPromise) return cloudRecoveryPromise;
    cloudRecoveryPromise = cloudSync.restore()
      .then(connected => {
        if (!connected) return false;
        finishCloudAuthentication();
        showToast("Microsoft 계정 연결을 완료하고 동기화를 시작했습니다.");
        return true;
      })
      .finally(() => {
        cloudRecoveryPromise = null;
      });
    return cloudRecoveryPromise;
  }

  function openCloudChooser() {
    closeSidebar();
    stopCloudLoginWatch();
    refs.cloudDevicePanel.hidden = true;
    refs.cloudDeviceCode.textContent = "----";
    refs.cloudLoginButton.disabled = false;
    refs.cloudLoginButton.textContent = "Microsoft 계정으로 로그인";
    refs.cloudDialog.showModal();
  }

  function showCloudAuthChallenge(challenge, platform) {
    const verificationUri =
      challenge?.verificationUri || "https://microsoft.com/devicelogin";
    refs.cloudDeviceCode.textContent = challenge?.userCode || "----";
    refs.cloudDeviceLink.href = challenge?.verificationUriComplete || verificationUri;
    refs.cloudDevicePanel.hidden = false;
    refs.cloudLoginButton.textContent = "승인 완료 확인";
    refs.cloudLoginButton.disabled = false;
    startCloudLoginWatch();

    if (platform === "windows") {
      try {
        if (cloudAuthWindow && !cloudAuthWindow.closed) {
          cloudAuthWindow.location.href =
            challenge?.verificationUriComplete || verificationUri;
        } else {
          cloudAuthWindow = window.open(
            challenge?.verificationUriComplete || verificationUri,
            "bulletbookMicrosoftLogin",
            "popup,width=780,height=760"
          );
        }
      } catch {
        // 팝업이 차단된 경우 사용자가 로그인 링크를 직접 누를 수 있다.
      }
    }
  }

  function finishCloudAuthentication() {
    stopCloudLoginWatch();
    try {
      if (cloudAuthWindow && !cloudAuthWindow.closed) cloudAuthWindow.close();
    } catch { /* ignore */ }
    cloudAuthWindow = null;
    if (refs.cloudDialog.open) refs.cloudDialog.close();
  }

  async function connectCloudAccount() {
    if (!cloudSync) return;
    if (cloudSync.loginPending) {
      cloudSync.checkLoginNow();
      showToast("Microsoft 승인 상태를 바로 확인합니다.");
      return;
    }
    refs.cloudLoginButton.disabled = true;
    refs.cloudLoginButton.textContent = "로그인 준비 중…";
    if (cloudSync.platform === "windows") {
      try {
        cloudAuthWindow = window.open(
          "about:blank",
          "bulletbookMicrosoftLogin",
          "popup,width=780,height=760"
        );
      } catch { /* ignore */ }
    }
    const connected = await cloudSync.connect();
    if (!connected) {
      if (await recoverCloudAccountAfterBrowser()) return;
      stopCloudLoginWatch();
      refs.cloudLoginButton.disabled = false;
      refs.cloudLoginButton.textContent = "Microsoft 계정으로 다시 로그인";
    }
  }

  async function cancelCloudAccountLogin() {
    await cloudSync?.cancelConnect();
    finishCloudAuthentication();
  }

  async function syncCloudNow() {
    if (!cloudSync) return;
    if (!cloudSync.connected) {
      openCloudChooser();
      return;
    }
    if (isLocalDirty()) await flushLocalChanges();
    await cloudSync.syncNow();
  }

  // 앱이 백그라운드로 가거나 닫힐 때 호출한다. 25초 유휴 대기를 기다리지 않고
  // 방금 편집한 내용을 즉시 OneDrive에 반영한다. saveBook()이 로컬 저장과
  // 함께 cloudSync.scheduleUpload()도 다시 거니, 그 직후 flushPendingUpload로
  // 그 예약을 앞당겨 실행하면 별도의 로컬 전용 저장 경로가 필요 없다.
  async function flushCloudBeforeLeaving() {
    if (!cloudSync?.connected) return;
    if (isLocalDirty()) await saveBook();
    await cloudSync.flushPendingUpload();
  }

  function bindEvents() {
    bindPageListResizer();
    $$(".tool").forEach(button => button.addEventListener("click", () => setTool(button.dataset.tool)));
    $$('[data-bullet-base], [data-bullet-status]').forEach(button => {
      // 마우스로 불렛을 누를 때 현재 글자 커서가 버튼으로 이동하지 않게 한다.
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", () => {
        if (button.dataset.bulletBase) applyBulletBase(button.dataset.bulletBase);
        else applyBulletStatus(button.dataset.bulletStatus);
      });
    });
    $$(".view-switch button, .mobile-view-switch button").forEach(button =>
      button.addEventListener("click", () => setViewMode(button.dataset.view)));
    $$(".template-grid button").forEach(button =>
      button.addEventListener("click", () => addTemplate(button.dataset.template)));
    refs.fontSize.addEventListener("input", applyFontSizeControl);
    refs.fontSize.addEventListener("change", () => {
      if (applyFontSizeControl()) {
        commitHistory();
        renderSpread();
      }
    });
    refs.fontSizeDown.addEventListener("click", () => stepFontSizeControl(-1));
    refs.fontSizeUp.addEventListener("click", () => stepFontSizeControl(1));

    refs.prev.addEventListener("click", () => navigate(-1));
    refs.next.addEventListener("click", () => navigate(1));
    $("#undoButton").addEventListener("click", () => restoreHistory(historyIndex - 1));
    $("#redoButton").addEventListener("click", () => restoreHistory(historyIndex + 1));
    $("#exportButton").addEventListener("click", exportBook);
    $("#importButton").addEventListener("click", () => refs.importInput.click());
    $("#printButton").addEventListener("click", printToPdf);
    refs.importInput.addEventListener("change", () => importBook(refs.importInput.files[0]));
    refs.duplicatePageButton.addEventListener("click", duplicateCheckedPages);
    refs.deletePageButton.addEventListener("click", deleteCheckedPages);
    refs.addGroupButton.addEventListener("click", addPageGroup);
    refs.groupEditCloseButton.addEventListener("click", closePageGroupEditor);
    refs.groupEditForm.addEventListener("submit", event => {
      event.preventDefault();
      renamePageGroup();
    });
    refs.groupEditName.addEventListener("input", () =>
      refs.groupEditName.setCustomValidity("")
    );
    refs.groupEditDeleteButton.addEventListener("click", deletePageGroup);
    refs.groupEditDialog.addEventListener("close", () => {
      editingGroupId = null;
      refs.groupEditName.setCustomValidity("");
    });
    refs.pageGroupSelect.addEventListener("change", () => {
      const page = book.pages[currentIndex];
      if (!page) return;
      const nextGroupId = refs.pageGroupSelect.value || null;
      keyboardScope = "sidebar";
      if (nextGroupId) {
        if (!movePageIntoGroup(page.id, nextGroupId)) {
          refs.pageGroupSelect.value = page.groupId || "";
          showToast("표지는 그룹에 넣을 수 없습니다");
        }
        return;
      }
      const ungroupedIds = new Set(orderedMovablePageIds([page.id]));
      book.pages.forEach(candidate => {
        if (ungroupedIds.has(candidate.id)) candidate.groupId = null;
      });
      book.pages = normalizeGroupPageOrder(book.pages, book.groups);
      currentIndex = Math.max(0, book.pages.findIndex(candidate => candidate.id === activePageId));
      commitHistory();
      renderAll();
    });
    refs.mobileTodayButton.addEventListener("click", goToToday);
    refs.mobilePageWriteButton.addEventListener("click", openMobilePageWrite);
    refs.mobilePageWriteCloseButton.addEventListener("click", () => refs.mobilePageWriteDialog.close());
    refs.mobilePageWritePageSelect.addEventListener("change", () => {
      mobileWriteTarget = "";
      mobileWriteDetail = "";
      renderMobilePageWriteTargets();
    });
    refs.mobilePageWriteAddContinuationButton.addEventListener(
      "click",
      addManualMobileWriteContinuationPage
    );
    refs.mobilePageWriteWeekNumber.addEventListener("change", () => {
      const page = selectedMobileWritePage();
      if (!page || (page.type !== "weekly-left" && page.type !== "weekly-right")) return;
      const weekNumber = normalizedWeekStart(page.weekStart)
        ? String(weekNumberForMonday(dateFromIso(page.weekStart)))
        : setWeeklyNumberForPair(page, refs.mobilePageWriteWeekNumber.value);
      setWeeklyNumberForPair(page, weekNumber);
      refs.mobilePageWriteWeekNumber.value = weekNumber;
      commitHistory();
      renderAll();
      renderMobilePageWriteTargets();
      showToast(weekNumber ? `${weekNumber}주차로 기록했습니다` : "주차 표시를 비웠습니다");
    });
    refs.mobilePageWriteWeekStart.addEventListener("change", () => {
      const page = selectedMobileWritePage();
      if (!page || (page.type !== "weekly-left" && page.type !== "weekly-right")) return;
      const changed = setWeeklyPageDate(page, refs.mobilePageWriteWeekStart.value);
      refs.mobilePageWriteWeekStart.value = normalizedWeekStart(page.weekStart) || "";
      if (!changed) return;
      commitHistory();
      renderAll();
      renderMobilePageWriteTargets();
      showToast("주간 날짜·주차·그룹을 갱신했습니다");
    });
    refs.mobilePageWriteDetailSelect.addEventListener("change", () => {
      mobileWriteDetail = refs.mobilePageWriteDetailSelect.value;
      renderMobilePageWriteTargets();
      requestAnimationFrame(() => refs.mobilePageWriteInput.focus());
    });
    refs.mobilePageWriteForm.addEventListener("submit", event => {
      event.preventDefault();
      addMobilePageText();
    });
    $$(".mobile-write-symbols button").forEach(button => {
      button.addEventListener("click", () => {
        mobileWriteSymbol = button.dataset.mobileWriteSymbol;
        updateMobileWriteSymbolButtons();
        refs.mobilePageWriteInput.focus();
      });
    });
    $$('[data-write-mode]').forEach(button =>
      button.addEventListener("click", () => setMobileWriteMode(button.dataset.writeMode))
    );
    refs.mobileRoutineSchedule.addEventListener("change", updateMobileRoutineScheduleFields);
    refs.mobileWriteOpenRoutineListButton.addEventListener("click", openGoalHub);
    refs.mobileTextContextCloseButton.addEventListener("click", () => closeMobileTextContext());
    refs.mobileTextContextSaveButton.addEventListener("click", saveMobileTextContext);
    refs.mobileTextContextInput.addEventListener("input", updateMobileContextBulletButtons);
    refs.mobileTextFontDown.addEventListener("click", () => adjustMobileContextFont(-1));
    refs.mobileTextFontUp.addEventListener("click", () => adjustMobileContextFont(1));
    $$('[data-mobile-bullet-base]').forEach(button =>
      button.addEventListener("click", () => setMobileContextBulletBase(button.dataset.mobileBulletBase))
    );
    $$('[data-mobile-bullet-status]').forEach(button =>
      button.addEventListener("click", () => setMobileContextBulletStatus(button.dataset.mobileBulletStatus))
    );
    refs.mobileTextContextDuplicateButton.addEventListener("click", duplicateMobileContextElement);
    refs.mobileTextContextCopyButton.addEventListener("click", () => copyMobileContextElement(false));
    refs.mobileTextContextPasteButton.addEventListener("click", pasteMobileContextElement);
    refs.mobileTextContextCutButton.addEventListener("click", () => copyMobileContextElement(true));
    refs.mobileTextContextFrontButton.addEventListener("click", () => reorderMobileContextElement(true));
    refs.mobileTextContextBackButton.addEventListener("click", () => reorderMobileContextElement(false));
    refs.mobileTextContextDeleteButton.addEventListener("click", deleteMobileContextElement);
    refs.mobileTextContextEditRoutineButton.addEventListener("click", editMobileContextRoutine);
    refs.mobilePagesButton.addEventListener("click", toggleSidebar);
    refs.mobileSearchButton.addEventListener("click", openMobileSearch);
    refs.mobileSearchInput.addEventListener("input", renderMobileSearchResults);
    refs.mobileSearchCloseButton.addEventListener("click", () => refs.mobileSearchDialog.close());
    refs.mobileMoreButton.addEventListener("click", () => refs.mobileMoreDialog.showModal());
    refs.mobileMoreNavButton.addEventListener("click", () => refs.mobileMoreDialog.showModal());
    refs.mobileMoreCloseButton.addEventListener("click", () => refs.mobileMoreDialog.close());
    refs.mobileAdvancedToggle.addEventListener("click", toggleMobileAdvancedEditing);
    refs.mobileSyncButton.addEventListener("click", () => {
      refs.mobileMoreDialog.close();
      syncCloudNow();
    });
    refs.mobileExportButton.addEventListener("click", () => {
      refs.mobileMoreDialog.close();
      exportBook();
    });
    refs.mobileRecoveryButton.addEventListener("click", openRecoveryDialog);
    refs.mobileUpdateButton.addEventListener("click", checkForAppUpdate);
    refs.desktopUpdateButton.addEventListener("click", checkForDesktopUpdate);
    refs.recoveryButton.addEventListener("click", openRecoveryDialog);
    refs.goalHubCloseButton.addEventListener("click", () => refs.goalHubDialog.close());
    refs.receiveTodayMissionsButton.addEventListener("click", receiveTodayMissions);
    refs.addLifeAreaButton.addEventListener("click", () => openGoalEditor("area"));
    refs.openLifeMapButton.addEventListener("click", openLifeMapPage);
    refs.goalEditorCloseButton.addEventListener("click", closeGoalEditorToHub);
    refs.goalEditorForm.addEventListener("submit", event => {
      event.preventDefault();
      saveGoalEditor();
    });
    refs.goalEditorDeleteButton.addEventListener("click", deleteGoalEditorEntity);
    refs.missionEditorSchedule.addEventListener("change", updateMissionScheduleFields);
    refs.recoveryCloseButton.addEventListener("click", () => refs.recoveryDialog.close());
    refs.calendarEventCloseButton.addEventListener("click", closeCalendarEventEditor);
    refs.calendarEventAddButton.addEventListener("click", () =>
      appendCalendarEventEditorRow().focus()
    );
    refs.calendarEventForm.addEventListener("submit", event => {
      event.preventDefault();
      saveCalendarEventEditor();
    });
    refs.calendarEventDialog.addEventListener("close", () => {
      editingCalendarDate = "";
    });
    refs.recoveryList.addEventListener("click", event => {
      const exportButton = event.target.closest("[data-recovery-export]");
      if (exportButton) {
        exportRecoverySnapshot(exportButton.dataset.recoveryExport);
        return;
      }
      const restoreButton = event.target.closest("[data-recovery-restore]");
      if (restoreButton) restoreRecoverySnapshot(restoreButton.dataset.recoveryRestore);
    });
    $("#sidebarToggle").addEventListener("click", toggleSidebar);
    $("#closeSidebar").addEventListener("click", closeSidebar);
    refs.sidebarScrim.addEventListener("click", closeSidebar);
    refs.cloudButton.addEventListener("click", syncCloudNow);
    refs.cloudFileButton.addEventListener("click", openCloudChooser);
    refs.cloudLoginButton.addEventListener("click", connectCloudAccount);
    refs.cloudCancelButton.addEventListener("click", cancelCloudAccountLogin);
    refs.cloudDisconnectButton.addEventListener("click", async () => {
      await cloudSync?.disconnect();
      showToast("Microsoft 계정에서 로그아웃했습니다.");
    });
    refs.bookTitle.addEventListener("input", markDirty);
    refs.bookTitle.addEventListener("change", () => {
      book.title = refs.bookTitle.value.trim() || "나의 불렛북";
      commitHistory();
    });

    $("#startButton").addEventListener("click", () => {
      refs.welcome.close();
      localStorage.setItem(WELCOME_KEY, "yes");
    });

    window.addEventListener("keydown", event => {
      const editingText =
        document.activeElement?.isContentEditable ||
        document.activeElement?.matches?.("input, textarea, select");
      const commandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.altKey && !commandKey && BULLET_SHORTCUTS[Number(event.key) - 1]) {
        event.preventDefault();
        const [kind, value] = BULLET_SHORTCUTS[Number(event.key) - 1];
        if (kind === "base") applyBulletBase(value);
        else applyBulletStatus(value);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        exportBook();
      } else if (commandKey && key === "z" && !editingText) {
        event.preventDefault();
        restoreHistory(historyIndex - 1);
      } else if (commandKey && key === "y" && !editingText) {
        event.preventDefault();
        restoreHistory(historyIndex + 1);
      } else if (commandKey && key === "c" && selection && !editingText) {
        event.preventDefault();
        copySelection();
      } else if (commandKey && key === "x" && selection && !editingText) {
        event.preventDefault();
        copySelection(true);
      } else if (commandKey && key === "v" && elementClipboard && !editingText) {
        event.preventDefault();
        pasteSelection();
      } else if (commandKey && key === "d" && selection && !editingText) {
        event.preventDefault();
        duplicateSelection();
      } else if (commandKey && event.shiftKey && (event.key === ">" || event.key === "." || event.code === "Period") && selection && !editingText) {
        event.preventDefault();
        changeSelectedFont(1);
      } else if (commandKey && event.shiftKey && (event.key === "<" || event.key === "," || event.code === "Comma") && selection && !editingText) {
        event.preventDefault();
        changeSelectedFont(-1);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selection && !editingText) {
        event.preventDefault();
        removeSelection();
      } else if (event.key === "Delete" && keyboardScope === "sidebar" && !editingText) {
        event.preventDefault();
        deleteCheckedPages();
      } else if (event.key.startsWith("Arrow") && selection && !editingText) {
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 1;
        const directions = {
          ArrowLeft: [-distance, 0],
          ArrowRight: [distance, 0],
          ArrowUp: [0, -distance],
          ArrowDown: [0, distance],
        };
        const [dx, dy] = directions[event.key];
        nudgeSelection(dx, dy);
      } else if (event.key === "ArrowLeft" && !editingText) {
        navigate(-1);
      } else if (event.key === "ArrowRight" && !editingText) {
        navigate(1);
      } else if (event.key === "Tab" && !editingText) {
        event.preventDefault();
        cycleVisibleSelection(event.shiftKey ? -1 : 1);
      } else if (event.key === "F2" && keyboardScope === "sidebar" && !editingText) {
        event.preventDefault();
        editPageTitle(book.pages[currentIndex]);
      } else if ((event.key === "F2" || event.key === "Enter") && selection && !editingText) {
        event.preventDefault();
        editSelectedText();
      } else if (
        key === "t" &&
        !editingText &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !refs.cloudDialog.open &&
        !refs.welcome.open
      ) {
        event.preventDefault();
        setTool("text");
        showToast("글자 모드 · 빈 곳을 드래그해 박스를 만드세요");
      } else if (event.key === "Escape") {
        if (selection) {
          selection = null;
          renderSpread();
        } else if (tool !== "select") {
          setTool("select");
        }
        closeSidebar();
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      const nextSpreadState = isSpreadView();
      if (viewMode === "auto" && lastSpreadState !== null && nextSpreadState !== lastSpreadState) {
        lastSpreadState = nextSpreadState;
        renderAll();
      } else {
        updatePageScale();
      }
    });
    resizeObserver.observe(refs.viewport);
    // 손가락으로 캔버스를 드래그해도 페이지가 넘어가지 않는다. 넘기기는
    // 좌우 화살표(#prevPage/#nextPage)로만 한다. 두 손가락 확대·축소는
    // 그대로 둔다.
    let pinchState = null;
    const touchDistance = touches => Math.hypot(
      touches[1].clientX - touches[0].clientX,
      touches[1].clientY - touches[0].clientY
    );
    const touchCenter = touches => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    });
    refs.viewport.addEventListener("touchstart", event => {
      if (isAndroidApp && event.touches.length === 2) {
        event.preventDefault();
        touchZoomActive = true;
        const touches = [event.touches[0], event.touches[1]];
        pinchState = {
          distance: Math.max(1, touchDistance(touches)),
          center: touchCenter(touches),
          zoom: pageZoom,
          panX: pagePanX,
          panY: pagePanY,
        };
      }
    }, { passive: false });
    refs.viewport.addEventListener("touchmove", event => {
      if (!pinchState || event.touches.length < 2) return;
      event.preventDefault();
      const touches = [event.touches[0], event.touches[1]];
      const nextCenter = touchCenter(touches);
      const zoomRatio = touchDistance(touches) / pinchState.distance;
      const nextZoom = clamp(pinchState.zoom * zoomRatio, .65, 3.2);
      const appliedRatio = nextZoom / pinchState.zoom;
      const viewportRect = refs.viewport.getBoundingClientRect();
      const viewportCenterX = viewportRect.left + viewportRect.width / 2;
      const viewportCenterY = viewportRect.top + viewportRect.height / 2;
      pageZoom = nextZoom;
      pagePanX = nextCenter.x - viewportCenterX -
        (pinchState.center.x - viewportCenterX - pinchState.panX) * appliedRatio;
      pagePanY = nextCenter.y - viewportCenterY -
        (pinchState.center.y - viewportCenterY - pinchState.panY) * appliedRatio;
      updatePageScale();
    }, { passive: false });
    refs.viewport.addEventListener("touchend", event => {
      if (!pinchState) return;
      if (event.touches.length < 2) {
        pinchState = null;
        touchZoomActive = false;
        if (pageZoom > .97 && pageZoom < 1.03) {
          pageZoom = 1;
          pagePanX = 0;
          pagePanY = 0;
        }
        updatePageScale();
      }
      event.preventDefault();
    }, { passive: false });
    refs.viewport.addEventListener("touchcancel", () => {
      pinchState = null;
      touchZoomActive = false;
    }, { passive: true });
    window.addEventListener("beforeunload", () => {
      if (isLocalDirty()) {
        book.title = refs.bookTitle.value.trim() || "나의 불렛북";
        book.updatedAt = new Date().toISOString();
      }
      const snapshot = clone(book);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* ignore */ }
      // unload 중 IndexedDB 완료는 보장되지 않지만, 가능한 환경에서는 한 번 더 보존한다.
      dbPut(snapshot).catch(() => {});
      // beforeunload는 비동기 완료를 기다려 주지 않으므로 결과를 확인하지 않고
      // 최선을 다해 시도만 한다. 같은 기기(로컬 서버)로 가는 요청이라 대개는
      // 창이 닫히기 전에 끝난다. 브라우저마다 종료 시 이벤트 순서가 달라
      // visibilitychange(hidden)에도 동일하게 걸어 둔다.
      flushCloudBeforeLeaving();
    });
    window.addEventListener("online", () => cloudSync?.refresh());
    window.addEventListener("offline", () => updateCloudState("offline", "오프라인 · 기기에 저장 중"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        // 앱을 백그라운드로 보내거나 닫는 시점의 표준적인 신호다. Android가
        // 홈으로 나가거나 다른 앱으로 전환할 때, Windows 창을 최소화하거나
        // 닫을 때 모두 여기로 들어온다.
        flushCloudBeforeLeaving();
        return;
      }
      if (cloudSync?.loginPending || refs.cloudDialog.open) {
        recoverCloudAccountAfterBrowser();
      } else {
        cloudSync?.refresh();
      }
    });
    window.__bulletBookCloudResume = () => {
      if (cloudSync?.loginPending || refs.cloudDialog.open) {
        recoverCloudAccountAfterBrowser();
      } else {
        cloudSync?.refresh();
      }
    };
    window.__bulletBookCloudLoginStateChanged = () =>
      recoverCloudAccountAfterBrowser();
    window.__bulletBookDisplayModeChanged = () => {
      if (viewMode !== "auto") return;
      lastSpreadState = null;
      requestAnimationFrame(renderAll);
    };
    window.__bulletBookHandleBack = handleAndroidBack;
    // 위젯 날짜/월 클릭 deep-link. cold start 시 WebView 준비 후 native가 호출한다.
    window.__bulletBookOpenWidgetDate = value => {
      const date = dateFromIso(value);
      if (!date) return false;
      const daily = ensureDailyPage(date);
      // goToToday()와 동일하게 위젯이 가리킨 날짜(오늘이 아님) 기준으로
      // 일간/주간 페이지에 미션을 채운다.
      const result = receiveMissionsForDate(date, daily.page);
      const weekResult = receiveMissionsForWeek(isoDate(mondayOf(date)));
      if (daily.created || result.added > 0 || weekResult.added > 0) commitHistory();
      // ensureDailyPage()가 주간 페이지를 함께 삽입해 색인이 밀릴 수 있으므로
      // daily.index 대신 id로 현재 위치를 다시 찾아야 표지에 머무르지 않는다.
      const index = book.pages.findIndex(page => page.id === daily.page.id);
      if (index >= 0) currentIndex = index;
      activePageId = daily.page.id;
      selection = null;
      renderAll();
      // 위젯 탭은 곧바로 글 작성으로 이어지도록 쓰기 시트를 연다.
      // 바로 위 페이지 이동이 activePageId를 일간 페이지로 맞춰
      // 시트의 기록할 페이지 드롭다운이 해당 날짜로 기본 선택된다.
      openMobilePageWrite({ date: isoDate(date) });
      return true;
    };
    window.__bulletBookOpenWidgetMonth = value => {
      const match = /^(\d{4})-(\d{1,2})$/.exec(String(value || ""));
      if (!match) return false;
      const year = Number(match[1]);
      const month = Number(match[2]);
      const page = book.pages.find(candidate => candidate.type === "monthly" && (() => {
        const context = monthlyDateContext(candidate);
        return context.hasCalendarDate && context.year === year && context.month === month;
      })());
      if (page) {
        navigateToBookPage(page);
      } else {
        // 월간 페이지가 없으면 새로 만들어 이동한다.
        // openMobilePageWrite()로 대체하면 표지에 머무르는 버그가 재발하므로 사용하지 않는다.
        const result = ensureMonthlyPage(year, month);
        if (result.created) commitHistory();
        navigateToBookPage(result.page);
      }
      return true;
    };
    window.addEventListener("afterprint", () => { refs.printBook.innerHTML = ""; });
  }

  async function init() {
    bindEvents();
    try {
      const saved = await loadSavedBook();
      book = normalizeBook(saved || book);
    } catch (error) {
      console.error("저장 문서 복구 실패", error);
      book = normalizeBook(createDefaultBook());
    }
    const calendarSetupAdded = ensureCalendarFeatureSetup();
    const missionsMaterialized = materializeDueMissions() > 0;
    refs.bookTitle.value = book.title || "나의 불렛북";
    initializeHistory();
    updateViewModeControls();
    renderAll();
    if (calendarSetupAdded || missionsMaterialized) markDirty();
    try {
      cloudSync = window.BulletBookCloudSync?.create({
        getBook: () => clone(book),
        applyBook: applyCloudBook,
        normalizeBook: normalizeValidatedBook,
        isValidBook: isCompatibleBook,
        isPristineBook,
        isLocalDirty,
        flushLocalChanges,
        getSyncBase: loadSyncBase,
        setSyncBase: persistSyncBase,
        clearSyncBase,
        saveRecoverySnapshot,
        notify: showToast,
        onState: updateCloudState,
        onAuthChallenge: showCloudAuthChallenge,
        onAuthComplete: finishCloudAuthentication,
      });
      await cloudSync?.restore();
    } catch (error) {
      console.error("동기화 복구 실패", error);
      updateCloudState("error", "동기화 복구 실패 · 기기 문서를 표시합니다");
    }
    if (!localStorage.getItem(WELCOME_KEY)) refs.welcome.showModal();
    // 앱 초기화 완료 후 위젯에 현재 일정을 반영하고,
    // cold start로 보관된 위젯 deep-link가 있으면 native에서 전달하게 한다.
    syncCalendarWidget();
    const native = window.BulletBookNative;
    if (native?.readyForWidgetNavigation) {
      const reqId = `widget-ready-${Date.now()}`;
      try { native.readyForWidgetNavigation(reqId); } catch { /* ignore */ }
    }
  }

  init();
})();
