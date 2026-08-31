(function () {
  'use strict';

  // Device-local operational log only. It never stores a raw user agent,
  // account, device identifier, or other user-entered value.
  const RECORDS_KEY = 'hikariArTrialRecordsV1';
  const ACTIVE_KEY = 'hikariArActiveTrialV1';
  const MAX_RECORDS = 200;
  const ACTIVE_MAX_AGE_MS = 30 * 60 * 1000;
  const TERMINAL_STATUSES = new Set(['success', 'failed', 'abandoned', 'paper_fallback']);
  const EFFECTIVE_TYPES = new Set(['slow-2g', '2g', '3g', '4g']);
  let staticEnvironment = null;

  function now() {
    return Date.now();
  }

  function safeText(value, fallback = '') {
    return String(value == null ? fallback : value)
      .replace(/https?:\/\/\S+/gi, '[URL]')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
      .slice(0, 160);
  }

  function safeToken(value, fallback) {
    const token = String(value || '')
      .trim()
      .replace(/[^A-Za-z0-9_.:-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
    return token || fallback;
  }

  function majorVersion(match) {
    const value = Number(match?.[1]);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function deviceFamily(ua = navigator.userAgent || '') {
    if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone|iPod/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android';
    return 'その他';
  }

  function osMajor(ua, family) {
    if (family === 'iPad' || family === 'iPhone') {
      const mobileOs = ua.match(/(?:CPU (?:iPhone )?OS|CPU OS|\bOS)\s+(\d+)[._]/i);
      const desktopIpadSafari = family === 'iPad' ? ua.match(/Version\/(\d+)/i) : null;
      return majorVersion(mobileOs || desktopIpadSafari);
    }
    if (family === 'Android') return majorVersion(ua.match(/Android\s+(\d+)/i));
    if (/Windows NT/i.test(ua)) return majorVersion(ua.match(/Windows NT\s+(\d+)/i));
    if (/Mac OS X/i.test(ua)) return majorVersion(ua.match(/Mac OS X\s+(\d+)[._]/i));
    return null;
  }

  function browserDetails(ua) {
    if (/FBAN|FBAV|Instagram|Line\//i.test(ua)) return { family: 'In-App', major: null };
    if (/;\s*wv\)|\bwv\b/i.test(ua)) {
      return { family: 'Android WebView', major: majorVersion(ua.match(/Chrome\/(\d+)/i)) };
    }
    const rules = [
      { pattern: /(?:EdgiOS|EdgA|Edg)\/(\d+)/i, family: 'Edge' },
      { pattern: /CriOS\/(\d+)/i, family: 'Chrome' },
      { pattern: /FxiOS\/(\d+)/i, family: 'Firefox' },
      { pattern: /SamsungBrowser\/(\d+)/i, family: 'Samsung Internet' },
      { pattern: /(?:OPiOS|OPR)\/(\d+)/i, family: 'Opera' },
      { pattern: /Chrome\/(\d+)/i, family: 'Chrome' },
      { pattern: /Firefox\/(\d+)/i, family: 'Firefox' },
      { pattern: /Version\/(\d+).*Safari\//i, family: 'Safari' }
    ];
    for (const rule of rules) {
      const match = ua.match(rule.pattern);
      if (match) return { family: rule.family, major: majorVersion(match) };
    }
    return { family: 'その他', major: null };
  }

  function webGlLevel() {
    try {
      const canvas = document.createElement('canvas');
      if (!canvas || typeof canvas.getContext !== 'function') return 'unknown';
      const options = { alpha: false, antialias: false, depth: false, stencil: false };
      const gl2 = canvas.getContext('webgl2', options);
      if (gl2) {
        gl2.getExtension?.('WEBGL_lose_context')?.loseContext?.();
        return 'webgl2';
      }
      const gl1 = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
      if (gl1) {
        gl1.getExtension?.('WEBGL_lose_context')?.loseContext?.();
        return 'webgl1';
      }
      return 'none';
    } catch (_) {
      return 'unknown';
    }
  }

  function environmentSnapshot() {
    if (!staticEnvironment) {
      const ua = navigator.userAgent || '';
      const device = deviceFamily(ua);
      const browser = browserDetails(ua);
      staticEnvironment = Object.freeze({
        schema: 1,
        osMajor: osMajor(ua, device),
        browserFamily: browser.family,
        browserMajor: browser.major,
        secureContext: window.isSecureContext === true,
        webgl: webGlLevel(),
        wasm: typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function',
        cameraApi: Boolean(navigator.mediaDevices?.getUserMedia)
      });
    }
    const effectiveType = String(navigator.connection?.effectiveType || '').toLowerCase();
    return {
      ...staticEnvironment,
      online: typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
      effectiveType: EFFECTIVE_TYPES.has(effectiveType) ? effectiveType : 'unknown'
    };
  }

  function rawRecords() {
    try {
      const value = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
      return Array.isArray(value) ? value.filter((record) => record && record.id).slice(-MAX_RECORDS) : [];
    } catch (_) {
      return [];
    }
  }

  function writeRecords(records) {
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
    } catch (_) {
      // AR use must continue even when private browsing blocks storage.
    }
  }

  function activeId() {
    try {
      return localStorage.getItem(ACTIVE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function setActiveId(id) {
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch (_) {
      // AR use must continue even when private browsing blocks storage.
    }
  }

  function finishAbandoned(record, code = 'STALE_TIMEOUT', reason = '試行が完了しないまま30分経過しました。') {
    const timestamp = now();
    record.status = 'abandoned';
    record.stage = safeToken(record.stage, 'unknown');
    record.code = safeToken(code, 'ABANDONED');
    record.failureStage = record.stage;
    record.failureCode = record.code;
    record.failureReason = safeText(reason, '試行が完了しませんでした。');
    record.endedAt = timestamp;
    record.updatedAt = timestamp;
  }

  function finalizeStale(records) {
    const timestamp = now();
    let changed = false;
    for (const record of records) {
      const activityAt = Number(record.updatedAt) || Number(record.startedAt) || 0;
      if (record.status === 'running' && timestamp - activityAt > ACTIVE_MAX_AGE_MS) {
        finishAbandoned(record);
        changed = true;
        if (record.id === activeId()) setActiveId('');
      }
    }
    return changed;
  }

  function readRecords() {
    const records = rawRecords();
    if (finalizeStale(records)) writeRecords(records);
    return records;
  }

  function newId(timestamp) {
    const random = Math.random().toString(36).slice(2, 9);
    return `${timestamp.toString(36)}-${random}`;
  }

  function activeRecord(records = readRecords()) {
    const id = activeId();
    if (!id) return null;
    const record = records.find((entry) => entry.id === id) || null;
    const activityAt = Number(record?.updatedAt) || Number(record?.startedAt) || 0;
    if (!record || record.status === 'abandoned' || now() - activityAt > ACTIVE_MAX_AGE_MS) {
      setActiveId('');
      return null;
    }
    return record;
  }

  function updateActive(update) {
    const records = readRecords();
    const record = activeRecord(records);
    if (!record) return null;
    update(record);
    record.updatedAt = now();
    writeRecords(records);
    return record;
  }

  function begin(route, selectedIds, reuseActive = false) {
    const records = readRecords();
    const current = activeRecord(records);
    if (reuseActive && current?.status === 'running') {
      if (route && !current.route.split(' → ').includes(route)) current.route += ` → ${route}`;
      current.stage = 'route_transition';
      current.code = 'ROUTE_TRANSITION';
      current.updatedAt = now();
      writeRecords(records);
      return current;
    }
    if (current?.status === 'running') {
      finishAbandoned(current, 'NEW_TRIAL_STARTED', '前の試行が完了する前に、新しい試行が始まりました。');
    }
    const timestamp = now();
    const record = {
      id: newId(timestamp),
      startedAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
      route: route || '不明',
      device: deviceFamily(),
      environment: environmentSnapshot(),
      selected: Array.isArray(selectedIds) ? selectedIds.slice(0, 2) : [],
      status: 'running',
      stage: 'launch',
      code: 'TRIAL_STARTED',
      displayMs: null,
      anchoredMs: null,
      resets: 0,
      restarts: 0,
      staffAssist: false,
      paperSwitch: false,
      recovered: false,
      failureStage: '',
      failureCode: '',
      failureReason: '',
      initialFailureStage: '',
      initialFailureCode: '',
      initialFailureReason: ''
    };
    records.push(record);
    writeRecords(records);
    setActiveId(record.id);
    return record;
  }

  function transition(route, selectedIds) {
    const records = readRecords();
    const current = activeRecord(records);
    if (current?.status !== 'running') return begin(route, selectedIds, false);
    if (route && !current.route.split(' → ').includes(route)) current.route += ` → ${route}`;
    current.stage = 'route_transition';
    current.code = 'ROUTE_TRANSITION';
    current.updatedAt = now();
    writeRecords(records);
    return current;
  }

  function detailFields(stageOrDetails, code, defaults) {
    const details = stageOrDetails && typeof stageOrDetails === 'object'
      ? stageOrDetails
      : { stage: stageOrDetails, code };
    return {
      stage: safeToken(details.stage, defaults.stage),
      code: safeToken(details.code, defaults.code)
    };
  }

  function inferFailureDetails(reason) {
    const text = String(reason || '');
    if (/カメラ.*許可|許可.*カメラ/.test(text)) return { stage: 'camera_permission', code: 'CAMERA_PERMISSION_FAILED' };
    if (/カメラ.*見つか|カメラ.*利用でき/.test(text)) return { stage: 'camera', code: 'CAMERA_NOT_FOUND' };
    if (/カメラ/.test(text) && /時間|timeout/i.test(text)) return { stage: 'camera', code: 'CAMERA_TIMEOUT' };
    if (/カメラ/.test(text)) return { stage: 'camera', code: 'CAMERA_START_FAILED' };
    if (/3D|立体|モデル/.test(text) && /時間|timeout/i.test(text)) return { stage: 'model_load', code: 'MODEL_TIMEOUT' };
    if (/3D|立体|モデル/.test(text)) return { stage: 'model_load', code: 'MODEL_LOAD_FAILED' };
    if (/空間認識|AR機能|空間AR/.test(text) && /時間|timeout/i.test(text)) return { stage: 'xr_engine', code: 'XR_TIMEOUT' };
    if (/空間認識|AR機能|空間AR/.test(text)) return { stage: 'xr_engine', code: 'XR_ENGINE_FAILED' };
    return { stage: 'unknown', code: 'UNSPECIFIED_FAILURE' };
  }

  function markStage(stage, code) {
    const details = detailFields(stage, code, { stage: 'unknown', code: 'STAGE_UPDATE' });
    return updateActive((record) => {
      record.stage = details.stage;
      record.code = details.code;
    });
  }

  function rememberInitialFailure(record) {
    if (record.initialFailureReason || !record.failureReason) return;
    record.initialFailureStage = record.failureStage || record.stage || 'unknown';
    record.initialFailureCode = record.failureCode || record.code || 'UNSPECIFIED_FAILURE';
    record.initialFailureReason = record.failureReason;
  }

  function completeSuccess(record, stageOrDetails, code, defaults) {
    const details = detailFields(stageOrDetails, code, defaults);
    if (record.status === 'failed' || record.status === 'abandoned' || record.failureReason) {
      rememberInitialFailure(record);
      record.recovered = true;
    }
    record.failureStage = '';
    record.failureCode = '';
    record.failureReason = '';
    record.stage = details.stage;
    record.code = details.code;
    record.status = 'success';
    record.endedAt = now();
  }

  function markDisplay(stageOrDetails, code) {
    return updateActive((record) => {
      if (record.displayMs == null) record.displayMs = Math.max(0, now() - record.startedAt);
      completeSuccess(record, stageOrDetails, code, { stage: 'display', code: 'DISPLAYED' });
    });
  }

  function markAnchored(stageOrDetails, code) {
    return updateActive((record) => {
      if (record.displayMs == null) record.displayMs = Math.max(0, now() - record.startedAt);
      if (record.anchoredMs == null) record.anchoredMs = Math.max(0, now() - record.startedAt);
      completeSuccess(record, stageOrDetails, code, { stage: 'anchor', code: 'ANCHORED' });
    });
  }

  function markFailure(reason, stageOrDetails, code) {
    const inferred = inferFailureDetails(reason);
    const details = detailFields(stageOrDetails, code, inferred);
    return updateActive((record) => {
      record.status = 'failed';
      record.stage = details.stage;
      record.code = details.code;
      record.failureStage = details.stage;
      record.failureCode = details.code;
      record.failureReason = safeText(reason, '不明なエラー');
      rememberInitialFailure(record);
      record.endedAt = now();
    });
  }

  function increment(field) {
    return updateActive((record) => {
      record[field] = Math.max(0, Number(record[field]) || 0) + 1;
    });
  }

  function markRestart() {
    return updateActive((record) => {
      record.restarts = Math.max(0, Number(record.restarts) || 0) + 1;
      if (record.status === 'failed') {
        rememberInitialFailure(record);
        record.status = 'running';
        record.endedAt = null;
      }
      record.stage = 'retry';
      record.code = 'RETRY_STARTED';
    });
  }

  function markStaffAssist() {
    return updateActive((record) => {
      record.staffAssist = true;
    });
  }

  function markPaperSwitch() {
    return updateActive((record) => {
      const displayedSuccessfully = record.status === 'success' && Number.isFinite(record.displayMs);
      rememberInitialFailure(record);
      record.paperSwitch = true;
      if (displayedSuccessfully) {
        record.stage = 'paper_switch_after_success';
        record.code = 'PAPER_AFTER_SUCCESS';
        record.endedAt ||= now();
        return;
      }
      record.status = 'paper_fallback';
      record.stage = 'paper_switch';
      record.code = 'PAPER_FALLBACK';
      record.failureStage = record.failureStage || 'paper_switch';
      record.failureCode = record.failureCode || 'PAPER_FALLBACK';
      record.failureReason = record.failureReason || '紙面表示へ切り替えました。';
      record.endedAt = now();
    });
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }

  function summary(records = readRecords()) {
    if (finalizeStale(records)) writeRecords(records);
    const completed = records.filter((record) => TERMINAL_STATUSES.has(record.status));
    // The published target is display success. A later reset/tracking failure
    // remains visible in status and error fields, but must not erase the fact
    // that the dishes were displayed successfully.
    const successes = completed.filter((record) => Number.isFinite(record.displayMs));
    const assisted = completed.filter((record) => record.staffAssist);
    const displayTimes = successes.map((record) => record.displayMs).filter(Number.isFinite);
    return {
      attempts: completed.length,
      inProgress: records.filter((record) => record.status === 'running').length,
      successes: successes.length,
      failures: completed.length - successes.length,
      abandoned: completed.filter((record) => record.status === 'abandoned').length,
      paperFallbacks: completed.filter((record) => record.status === 'paper_fallback').length,
      recovered: completed.filter((record) => record.recovered).length,
      successRate: completed.length ? successes.length / completed.length : null,
      medianDisplayMs: median(displayTimes),
      assistRate: completed.length ? assisted.length / completed.length : null
    };
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function yesNoUnknown(value) {
    if (value === true) return 'あり';
    if (value === false) return 'なし';
    return '不明';
  }

  function toCsv(records = readRecords()) {
    if (finalizeStale(records)) writeRecords(records);
    const header = [
      '開始日時', '終了日時', '端末', 'OSメジャー', 'ブラウザ', 'ブラウザメジャー',
      'HTTPS', 'WebGL', 'WASM', 'カメラAPI', 'オンライン', '回線', '経路',
      '候補1', '候補2', '結果', '最終段階', '最終コード', '回復成功',
      '表示時間ms', '位置固定時間ms', 'リセット回数', '再起動回数', '職員介助',
      '紙面切替', '失敗段階', '失敗コード', '失敗内容', '初回失敗段階',
      '初回失敗コード', '初回失敗内容'
    ];
    const rows = records.map((record) => {
      const environment = record.environment || {};
      return [
        new Date(record.startedAt).toISOString(),
        record.endedAt ? new Date(record.endedAt).toISOString() : '',
        record.device, environment.osMajor, environment.browserFamily, environment.browserMajor,
        yesNoUnknown(environment.secureContext), environment.webgl || '不明', yesNoUnknown(environment.wasm),
        yesNoUnknown(environment.cameraApi), yesNoUnknown(environment.online), environment.effectiveType || '不明',
        record.route, record.selected?.[0] || '', record.selected?.[1] || '', record.status,
        record.stage || '', record.code || '', record.recovered ? 'あり' : 'なし', record.displayMs,
        record.anchoredMs, record.resets, record.restarts, record.staffAssist ? 'あり' : 'なし',
        record.paperSwitch ? 'あり' : 'なし', record.failureStage || '', record.failureCode || '',
        record.failureReason || '', record.initialFailureStage || '', record.initialFailureCode || '',
        record.initialFailureReason || ''
      ];
    });
    return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  }

  function downloadCsv() {
    const blob = new Blob([toCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ar-trial-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  window.HIKARI_AR_TRIAL_LOG = Object.freeze({
    begin,
    transition,
    markStage,
    markDisplay,
    markAnchored,
    markFailure,
    markReset: () => increment('resets'),
    markRestart,
    markStaffAssist,
    markPaperSwitch,
    readRecords,
    summary,
    toCsv,
    downloadCsv
  });
})();
