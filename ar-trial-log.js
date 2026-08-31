(function () {
  'use strict';

  // Device-local operational log only. It contains no name, account, or device identifier.
  const RECORDS_KEY = 'hikariArTrialRecordsV1';
  const ACTIVE_KEY = 'hikariArActiveTrialV1';
  const MAX_RECORDS = 200;
  const ACTIVE_MAX_AGE_MS = 30 * 60 * 1000;

  function now() {
    return Date.now();
  }

  function readRecords() {
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

  function deviceFamily() {
    const ua = navigator.userAgent || '';
    if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone|iPod/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android';
    return 'その他';
  }

  function newId(timestamp) {
    const random = Math.random().toString(36).slice(2, 9);
    return `${timestamp.toString(36)}-${random}`;
  }

  function activeRecord(records = readRecords()) {
    const id = activeId();
    if (!id) return null;
    const record = records.find((entry) => entry.id === id) || null;
    if (!record || now() - record.startedAt > ACTIVE_MAX_AGE_MS) {
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
    const current = reuseActive ? activeRecord(records) : null;
    if (current) {
      if (route && !current.route.split(' → ').includes(route)) current.route += ` → ${route}`;
      current.updatedAt = now();
      writeRecords(records);
      return current;
    }
    const timestamp = now();
    const record = {
      id: newId(timestamp),
      startedAt: timestamp,
      updatedAt: timestamp,
      route: route || '不明',
      device: deviceFamily(),
      selected: Array.isArray(selectedIds) ? selectedIds.slice(0, 2) : [],
      status: 'running',
      displayMs: null,
      anchoredMs: null,
      resets: 0,
      restarts: 0,
      staffAssist: false,
      paperSwitch: false,
      failureReason: ''
    };
    records.push(record);
    writeRecords(records);
    setActiveId(record.id);
    return record;
  }

  function transition(route, selectedIds) {
    const record = updateActive((current) => {
      if (route && !current.route.split(' → ').includes(route)) current.route += ` → ${route}`;
    });
    return record || begin(route, selectedIds, false);
  }

  function markDisplay() {
    return updateActive((record) => {
      if (record.displayMs == null) record.displayMs = Math.max(0, now() - record.startedAt);
      record.status = 'success';
    });
  }

  function markAnchored() {
    return updateActive((record) => {
      if (record.displayMs == null) record.displayMs = Math.max(0, now() - record.startedAt);
      if (record.anchoredMs == null) record.anchoredMs = Math.max(0, now() - record.startedAt);
      record.status = 'success';
    });
  }

  function markFailure(reason) {
    return updateActive((record) => {
      record.status = 'failed';
      record.failureReason = String(reason || '不明なエラー').slice(0, 160);
    });
  }

  function increment(field) {
    return updateActive((record) => {
      record[field] = Math.max(0, Number(record[field]) || 0) + 1;
    });
  }

  function markStaffAssist() {
    return updateActive((record) => {
      record.staffAssist = true;
    });
  }

  function markPaperSwitch() {
    return updateActive((record) => {
      record.paperSwitch = true;
    });
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }

  function summary(records = readRecords()) {
    const completed = records.filter((record) => record.status === 'success' || record.status === 'failed');
    const successes = completed.filter((record) => record.status === 'success');
    const assisted = completed.filter((record) => record.staffAssist);
    const displayTimes = successes.map((record) => record.displayMs).filter(Number.isFinite);
    return {
      attempts: completed.length,
      inProgress: records.length - completed.length,
      successes: successes.length,
      failures: completed.length - successes.length,
      successRate: completed.length ? successes.length / completed.length : null,
      medianDisplayMs: median(displayTimes),
      assistRate: completed.length ? assisted.length / completed.length : null
    };
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function toCsv(records = readRecords()) {
    const header = [
      '開始日時', '端末', '経路', '候補1', '候補2', '結果', '表示時間ms',
      '位置固定時間ms', 'リセット回数', '再起動回数', '職員介助', '紙面切替', '失敗内容'
    ];
    const rows = records.map((record) => [
      new Date(record.startedAt).toISOString(), record.device, record.route,
      record.selected?.[0] || '', record.selected?.[1] || '', record.status,
      record.displayMs, record.anchoredMs, record.resets, record.restarts,
      record.staffAssist ? 'あり' : 'なし', record.paperSwitch ? 'あり' : 'なし', record.failureReason
    ]);
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
    markDisplay,
    markAnchored,
    markFailure,
    markReset: () => increment('resets'),
    markRestart: () => increment('restarts'),
    markStaffAssist,
    markPaperSwitch,
    readRecords,
    summary,
    toCsv,
    downloadCsv
  });
})();
