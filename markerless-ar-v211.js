(function () {
  'use strict';

  const STORAGE_KEY = 'senshakuSelectedIds';
  const FAVORITES = [
    'shoyu_ramen', 'miso_ramen', 'gyudon', 'katsudon', 'beef_curry',
    'hamburg_steak', 'omurice', 'fried_chicken_plate', 'udon', 'spaghetti'
  ];
  const items = Array.isArray(window.MENU_ITEMS) ? window.MENU_ITEMS : [];
  const categories = Array.isArray(window.MENU_CATEGORIES) ? window.MENU_CATEGORIES : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const fallbackIds = ['miso_ramen', 'gyudon'];
  const composer = window.HIKARI_GLB_COMPOSER;
  // Use the same on-device composition path in development and on GitHub Pages.
  const preferLocalPair = Boolean(composer);
  const modelBufferCache = new Map();
  const modelFetchControllers = new Map();

  const viewer = document.getElementById('pairViewer');
  const viewerMessage = document.getElementById('viewerMessage');
  const deviceNote = document.getElementById('deviceNote');
  const nativeArButton = document.getElementById('nativeArButton');
  const browserArButton = document.getElementById('browserArButton');
  const simpleCameraArButton = document.getElementById('simpleCameraArButton');
  const cameraArOverlay = document.getElementById('cameraArOverlay');
  const cameraArVideo = document.getElementById('cameraArVideo');
  const cameraArViewer = viewer;
  const cameraArModelHost = document.getElementById('cameraArModelHost');
  const viewerHome = viewer.parentNode;
  const viewerHomeNext = viewer.nextSibling;
  const cameraArStatus = document.getElementById('cameraArStatus');
  const cameraArNames = document.getElementById('cameraArNames');
  const menuGrid = document.getElementById('menuGrid');
  const menuCount = document.getElementById('menuCount');
  const categoryStrip = document.getElementById('categoryStrip');
  const searchInput = document.getElementById('searchInput');
  const targetLabel = document.getElementById('targetLabel');
  const progressBar = document.getElementById('progressBar');
  const iosOrientationNote = document.getElementById('iosOrientationNote');
  const isIPad = /iPad/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIPhone = /iPhone|iPod/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const ipadVersionMatch = isIPad && (
    navigator.userAgent.match(/(?:CPU (?:iPhone )?OS|CPU OS) (\d+)[._](\d+)/i)
    || navigator.userAgent.match(/Version\/(\d+)(?:\.(\d+))?/i)
  );
  const ipadOsVersion = ipadVersionMatch
    ? Number(ipadVersionMatch[1]) + Number(ipadVersionMatch[2] || 0) / 10
    : 0;
  const needsLegacyIPadCamera = isIPad && ipadOsVersion > 0 && ipadOsVersion < 16.4;
  const supportsPlatformAr = isIPhone || isIPad || isAndroid;
  if (!supportsPlatformAr) viewer.removeAttribute('ar');
  if (needsLegacyIPadCamera) viewer.removeAttribute('ar');

  let activeChoice = 0;
  let activeCategory = 'favorites';
  let pairFallbackActive = false;
  let localPairAttempted = false;
  let pairLoadRevision = 0;
  let pairObjectUrl = '';
  let expectedViewerSource = '';
  let expectedViewerRevision = 0;
  let viewerLoadTimer = 0;
  let viewerReady = false;
  let pairModelReady = false;
  let nativeArSupported = false;
  let nativeArAttempted = false;
  let nativeArAttemptTimer = 0;
  let spatialArOpening = false;
  let cameraStream = null;
  let cameraFacing = 'environment';
  let cameraOpening = false;
  let cameraModelReady = false;
  let cameraVideoReady = false;
  let cameraDistance = 1.18;
  let cameraLandscape = window.innerWidth > window.innerHeight;
  let cameraViewportTimer = 0;
  let cameraRestartTimer = 0;
  let selected = readSelection();
  const legacy3dRequested = needsLegacyIPadCamera
    && new URLSearchParams(location.search).get('legacy3d') === '1';
  let legacy3dAutoOpened = false;

  function readSelection() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const valid = stored.filter((id) => byId.has(id));
      const result = [valid[0] || fallbackIds[0], valid[1] || fallbackIds[1]];
      if (result[0] === result[1]) result[1] = items.find((item) => item.id !== result[0])?.id || fallbackIds[1];
      return result;
    } catch (_) {
      return [...fallbackIds];
    }
  }

  function saveSelection() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
  }

  function pairUrl(revision) {
    const url = new URL('api/pair.glb', document.baseURI);
    url.searchParams.set('left', selected[0]);
    url.searchParams.set('right', selected[1]);
    url.searchParams.set('request', String(revision));
    return url.href;
  }

  function normalizedModelUrl(url) {
    try {
      return new URL(url, document.baseURI).href;
    } catch (_) {
      return String(url || '');
    }
  }

  function clearViewerLoadTimer() {
    if (!viewerLoadTimer) return;
    window.clearTimeout(viewerLoadTimer);
    viewerLoadTimer = 0;
  }

  function clearNativeArAttempt() {
    nativeArAttempted = false;
    if (!nativeArAttemptTimer) return;
    window.clearTimeout(nativeArAttemptTimer);
    nativeArAttemptTimer = 0;
  }

  function beginNativeArAttempt() {
    clearNativeArAttempt();
    nativeArAttempted = true;
    nativeArAttemptTimer = window.setTimeout(clearNativeArAttempt, 30000);
  }

  function releasePairResources() {
    clearNativeArAttempt();
    pairLoadRevision += 1;
    expectedViewerRevision = pairLoadRevision;
    expectedViewerSource = '';
    pairModelReady = false;
    clearViewerLoadTimer();
    for (const controller of modelFetchControllers.values()) controller.abort();
    modelFetchControllers.clear();
    modelBufferCache.clear();
    viewer.removeAttribute('src');
    if (pairObjectUrl) URL.revokeObjectURL(pairObjectUrl);
    pairObjectUrl = '';
  }

  async function modelBytes(id) {
    if (!modelBufferCache.has(id)) {
      const item = byId.get(id);
      const controller = new AbortController();
      modelFetchControllers.set(id, controller);
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      const request = fetch(new URL(item.modelUrl, document.baseURI), {
        cache: 'force-cache',
        signal: controller.signal
      })
        .then((response) => {
          if (!response.ok) throw new Error(`Model unavailable: ${id}`);
          return response.arrayBuffer();
        })
        .then((buffer) => new Uint8Array(buffer))
        .catch((error) => {
          modelBufferCache.delete(id);
          throw error;
        })
        .finally(() => {
          window.clearTimeout(timeout);
          if (modelFetchControllers.get(id) === controller) modelFetchControllers.delete(id);
        });
      modelBufferCache.set(id, request);
    }
    return modelBufferCache.get(id);
  }

  function replaceViewerSource(url, ownsObjectUrl = false, revision = pairLoadRevision) {
    if (pairObjectUrl && pairObjectUrl !== url) URL.revokeObjectURL(pairObjectUrl);
    pairObjectUrl = ownsObjectUrl ? url : '';
    expectedViewerSource = normalizedModelUrl(url);
    expectedViewerRevision = revision;
    pairModelReady = false;
    viewer.setAttribute('aria-busy', 'true');
    updateArAvailability();
    viewer.setAttribute('src', url);
    clearViewerLoadTimer();
    viewerLoadTimer = window.setTimeout(() => {
      if (revision !== pairLoadRevision || revision !== expectedViewerRevision || pairModelReady) return;
      handleViewerFailure('timeout');
    }, 20000);
  }

  async function loadLocalPair(revision) {
    localPairAttempted = true;
    try {
      const [leftBytes, rightBytes] = await Promise.all([
        modelBytes(selected[0]),
        modelBytes(selected[1])
      ]);
      const pairBytes = composer.mergeGlbs(leftBytes, rightBytes, {
        leftId: selected[0],
        rightId: selected[1]
      });
      const objectUrl = URL.createObjectURL(new Blob([pairBytes], { type: 'model/gltf-binary' }));
      if (revision !== pairLoadRevision) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      replaceViewerSource(objectUrl, true, revision);
    } catch (_) {
      if (revision !== pairLoadRevision) return;
      pairFallbackActive = true;
      replaceViewerSource(byId.get(selected[0]).modelUrl, false, revision);
      setMessage('2品の準備に失敗したため、候補1を安全表示しています。', 'warning');
    }
  }

  function setMessage(text, tone = 'normal') {
    viewerMessage.textContent = text;
    viewerMessage.dataset.tone = tone;
  }

  function updateChoiceButtons() {
    selected.forEach((id, index) => {
      const item = byId.get(id);
      document.getElementById(`choiceName${index}`).textContent = item?.name || id;
      const button = document.querySelector(`[data-choice-index="${index}"]`);
      button.classList.toggle('active', activeChoice === index);
      button.setAttribute('aria-pressed', String(activeChoice === index));
    });
    targetLabel.textContent = `候補${activeChoice + 1}を選択中`;
  }

  function refreshPair() {
    const left = byId.get(selected[0]);
    const right = byId.get(selected[1]);
    const revision = ++pairLoadRevision;
    pairFallbackActive = false;
    localPairAttempted = false;
    viewer.setAttribute('alt', `${left.name}と${right.name}を並べた立体比較`);
    progressBar.style.width = '0%';
    setMessage(`${left.name}と${right.name}の立体を準備しています`);
    if (!viewerReady) {
      nativeArButton.hidden = true;
      browserArButton.disabled = true;
      simpleCameraArButton.disabled = true;
    } else if (preferLocalPair && composer) {
      loadLocalPair(revision);
    } else {
      replaceViewerSource(pairUrl(revision), false, revision);
    }
    updateChoiceButtons();
    saveSelection();
    renderMenu();
    updateArAvailability();
  }

  function categoryButtons() {
    const entries = [
      { id: 'favorites', label: 'よく使う10品' },
      { id: 'all', label: 'すべて' },
      ...categories.map((category) => ({ id: category.id, label: category.label }))
    ];
    categoryStrip.innerHTML = entries.map((entry) => (
      `<button class="category-button${entry.id === activeCategory ? ' active' : ''}" type="button" data-category="${entry.id}">${entry.label}</button>`
    )).join('');
    categoryStrip.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        activeCategory = button.dataset.category;
        categoryButtons();
        renderMenu();
      });
    });
  }

  function filteredItems() {
    const query = searchInput.value.trim().toLocaleLowerCase('ja');
    return items.filter((item) => {
      // A typed search always covers all 53 dishes. Restricting it to the
      // initially selected favorites category made valid dishes look missing.
      const categoryMatch = Boolean(query)
        || activeCategory === 'all'
        || (activeCategory === 'favorites' && FAVORITES.includes(item.id))
        || item.category === activeCategory;
      if (!categoryMatch) return false;
      if (!query) return true;
      return [item.name, item.reading, item.romaji, ...(item.tags || [])]
        .join(' ')
        .toLocaleLowerCase('ja')
        .includes(query);
    });
  }

  function armMenuPoster(poster, fallbackUrl) {
    if (!fallbackUrl) return;
    poster.addEventListener('error', () => {
      if (poster.dataset.fallbackApplied === 'true') return;
      poster.dataset.fallbackApplied = 'true';
      poster.src = fallbackUrl;
    }, { once: true });
  }

  function renderMenu() {
    const visible = filteredItems();
    menuCount.textContent = `${visible.length}品を表示しています（全${items.length}品）`;
    if (!visible.length) {
      menuGrid.innerHTML = '<p>条件に合う料理がありません。</p>';
      return;
    }
    menuGrid.innerHTML = visible.map((item) => {
      const selectedIndex = selected.indexOf(item.id);
      const duplicate = selectedIndex !== -1 && selectedIndex !== activeChoice;
      const revision = item.modelUrl.includes('?')
        ? item.modelUrl.slice(item.modelUrl.indexOf('?'))
        : '';
      const thumbnailUrl = item.modelUrl
        ? `assets/model-posters/${item.id}.jpg${revision}`
        : item.image;
      const fallbackUrl = item.photoImage || item.image;
      return `
        <button class="menu-card${selectedIndex !== -1 ? ' selected' : ''}" type="button" data-menu-id="${item.id}" aria-disabled="${duplicate}">
          <span class="menu-model" data-image-url="${thumbnailUrl}" data-fallback-image-url="${fallbackUrl}" role="img" aria-label="${item.name}の3D見本画像">
            <img class="menu-photo" alt="" loading="lazy" decoding="async">
          </span>
          <span class="menu-card-text">
            <strong>${item.name}</strong>
            <span>${item.categoryLabel}</span>
          </span>
        </button>`;
    }).join('');
    menuGrid.querySelectorAll('.menu-model').forEach((container) => {
      const poster = container.querySelector('.menu-photo');
      armMenuPoster(poster, container.dataset.fallbackImageUrl);
      poster.src = container.dataset.imageUrl;
    });
    menuGrid.querySelectorAll('.menu-card').forEach((button) => {
      button.addEventListener('click', () => chooseItem(button.dataset.menuId));
    });
  }

  function chooseItem(id) {
    const otherIndex = activeChoice === 0 ? 1 : 0;
    if (selected[otherIndex] === id) {
      setMessage('同じ料理は2つ選べません。別の料理を選んでください。', 'warning');
      return;
    }
    selected[activeChoice] = id;
    activeChoice = otherIndex;
    refreshPair();
    document.querySelector('.viewer-panel').scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  function detectNativeArSupport() {
    nativeArSupported = supportsPlatformAr && Boolean(viewer.canActivateAR);
    updateArAvailability();
  }

  function spatialSelectionReady() {
    return selected.length === 2
      && selected[0] !== selected[1]
      && selected.every((id) => Boolean(byId.get(id)?.modelUrl));
  }

  function updateArAvailability() {
    if (needsLegacyIPadCamera) {
      nativeArButton.hidden = true;
      simpleCameraArButton.hidden = true;
      browserArButton.disabled = !pairModelReady;
      browserArButton.textContent = pairModelReady
        ? '3Dカメラ比較を起動'
        : '高品質3Dを準備しています';
      deviceNote.textContent = '高品質な2品をカメラ映像の上に3D表示します。机への空間固定は行いません。';
      return;
    }
    const sharedRouteReady = (isIPad || isAndroid) && spatialSelectionReady();
    if (!sharedRouteReady && (!viewerReady || !pairModelReady)) {
      nativeArButton.hidden = true;
      browserArButton.disabled = true;
      simpleCameraArButton.disabled = true;
      deviceNote.textContent = '選んだ2品の立体を準備しています。';
      return;
    }
    browserArButton.disabled = false;
    simpleCameraArButton.disabled = !pairModelReady;
    nativeArButton.hidden = true;
    if (isIPad || isAndroid) {
      browserArButton.textContent = '空間ARを起動';
      deviceNote.textContent = '2品を別々に読み込む共通ARで、料理をすぐ表示してから机へ固定します。';
    } else if (nativeArSupported) {
      const platformLabel = 'iPhone標準AR';
      browserArButton.textContent = `${platformLabel}を起動`;
      deviceNote.textContent = `${platformLabel}を優先します。料理を机に置き、端末を動かして横や斜めから確認できます。`;
    } else {
      browserArButton.textContent = '空間ARを起動';
      deviceNote.textContent = '端末標準ARが使えないため、追加アプリ不要の共通空間ARを使用します。';
    }
  }

  function openSpatialAr() {
    if (!spatialSelectionReady() || spatialArOpening) return;
    if (needsLegacyIPadCamera) {
      openCameraAr();
      return;
    }
    spatialArOpening = true;
    const url = new URL('spatial-ar.html', document.baseURI);
    url.searchParams.set('v', '20260820-prebuilt46');
    url.searchParams.set('left', selected[0]);
    url.searchParams.set('right', selected[1]);
    releasePairResources();
    location.href = url.href;
  }

  async function openPreferredAr() {
    // The shared route keeps the two selected GLBs separate and can show a
    // camera-relative preview before surface tracking settles. This is more
    // reliable than converting a large merged Blob in iPad Quick Look or
    // waiting indefinitely for Android WebXR floor placement.
    if (needsLegacyIPadCamera) {
      if (!pairModelReady) {
        setMessage('高品質な2品の3Dを準備しています。準備完了後にもう一度押してください。', 'warning');
        return;
      }
      await openCameraAr();
      return;
    }
    if (isIPad || isAndroid || !nativeArSupported) {
      openSpatialAr();
      return;
    }
    if (!pairModelReady) return;
    browserArButton.disabled = true;
    setMessage('iPhone標準ARを起動しています');
    beginNativeArAttempt();
    try {
      await viewer.activateAR();
    } catch (_) {
      clearNativeArAttempt();
      setMessage('端末標準ARを開始できなかったため、共通空間ARへ切り替えます。', 'warning');
      openSpatialAr();
    } finally {
      browserArButton.disabled = false;
    }
  }

  const canonicalAppUrl = new URL('.', document.baseURI).href;
  let shareQrReady = false;

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) throw new Error('Copy command failed');
  }

  function prepareShareDetails() {
    const link = document.getElementById('shareUrlLink');
    link.href = canonicalAppUrl;
    link.textContent = canonicalAppUrl;
    if (shareQrReady) return;
    const host = document.getElementById('shareQrCode');
    if (typeof window.QRCode !== 'function') {
      return;
    }
    host.replaceChildren();
    new window.QRCode(host, {
      text: canonicalAppUrl,
      width: 220,
      height: 220,
      colorDark: '#102423',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
    shareQrReady = true;
  }

  function setCameraStatus(text, tone = 'normal') {
    cameraArStatus.textContent = text;
    cameraArStatus.dataset.tone = tone;
  }

  function isLandscapeCameraViewport() {
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    return width > height;
  }

  function refreshCameraViewerFraming() {
    if (cameraArOverlay.hidden) return;
    try {
      const update = typeof cameraArViewer.updateFraming === 'function'
        ? cameraArViewer.updateFraming()
        : null;
      if (update?.catch) update.catch(() => {});
    } catch (_) {
      // Older model-viewer releases still resize correctly through ResizeObserver.
    }
    window.requestAnimationFrame(() => {
      applyCameraDistance();
    });
  }

  function syncCameraViewport() {
    const viewport = window.visualViewport;
    const width = Math.max(1, Math.round(viewport?.width || window.innerWidth));
    const height = Math.max(1, Math.round(viewport?.height || window.innerHeight));
    cameraLandscape = width > height;
    cameraArOverlay.dataset.orientation = cameraLandscape ? 'landscape' : 'portrait';
    cameraArOverlay.style.setProperty('--camera-viewport-width', `${width}px`);
    cameraArOverlay.style.setProperty('--camera-viewport-height', `${height}px`);
    if (cameraArOverlay.hidden) return;
    cameraArViewer.style.width = `${width}px`;
    cameraArViewer.style.height = `${height}px`;
    refreshCameraViewerFraming();
  }

  function restartCameraForOrientation() {
    if (cameraArOverlay.hidden || !cameraStream) return;
    if (cameraOpening) {
      cameraRestartTimer = window.setTimeout(restartCameraForOrientation, 300);
      return;
    }
    setCameraStatus('画面の向きに合わせてカメラを調整しています');
    startCameraForOverlay();
  }

  function queueCameraViewportSync() {
    window.clearTimeout(cameraViewportTimer);
    cameraViewportTimer = window.setTimeout(() => {
      const previousLandscape = cameraLandscape;
      syncCameraViewport();
      if (previousLandscape === cameraLandscape
        || cameraArOverlay.hidden
        || !cameraStream) return;
      window.clearTimeout(cameraRestartTimer);
      cameraRestartTimer = window.setTimeout(() => {
        restartCameraForOrientation();
      }, 360);
    }, 180);
  }

  function stopCameraStream() {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    cameraArVideo.pause();
    cameraArVideo.srcObject = null;
    cameraVideoReady = false;
  }

  function getUserMediaWithTimeout(constraints) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const timeout = window.setTimeout(() => {
        finished = true;
        const error = new Error('Camera permission timeout');
        error.name = 'CameraTimeoutError';
        reject(error);
      }, 15000);
      navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        if (finished) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        finished = true;
        window.clearTimeout(timeout);
        resolve(stream);
      }).catch((error) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async function requestCameraStream(facing) {
    const landscape = isLandscapeCameraViewport();
    const attempts = [
      {
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: landscape ? 1920 : 1080 },
          height: { ideal: landscape ? 1080 : 1920 },
          aspectRatio: { ideal: landscape ? 16 / 9 : 9 / 16 }
        }
      },
      { audio: false, video: { facingMode: facing } },
      { audio: false, video: true }
    ];
    let lastError;
    for (const constraints of attempts) {
      try {
        return await getUserMediaWithTimeout(constraints);
      } catch (error) {
        lastError = error;
        if (error?.name === 'NotAllowedError'
          || error?.name === 'SecurityError'
          || error?.name === 'CameraTimeoutError') break;
      }
    }
    throw lastError || new Error('Camera unavailable');
  }

  function waitForCameraVideo() {
    if (cameraArVideo.readyState >= 2 && cameraArVideo.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error('Camera start timeout')), 12000);
      function finish(error) {
        window.clearTimeout(timeout);
        cameraArVideo.removeEventListener('loadeddata', onReady);
        cameraArVideo.removeEventListener('canplay', onReady);
        if (error) reject(error);
        else resolve();
      }
      function onReady() {
        if (cameraArVideo.videoWidth > 0) finish();
      }
      cameraArVideo.addEventListener('loadeddata', onReady);
      cameraArVideo.addEventListener('canplay', onReady);
    });
  }

  function cameraFailureMessage(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return 'カメラが許可されていません。SafariまたはChromeのサイト設定でカメラを許可し、「カメラ再試行」を押してください。';
    }
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      return '利用できるカメラが見つかりません。端末のカメラ制限を確認してください。';
    }
    if (error?.name === 'CameraTimeoutError') {
      return 'カメラ許可の応答を確認できませんでした。サイト設定でカメラを許可し、「カメラ再試行」を押してください。';
    }
    return 'カメラを起動できませんでした。ほかのアプリでカメラを閉じてから再試行してください。';
  }

  function updateCameraReadyStatus() {
    if (cameraVideoReady && cameraModelReady) {
      setCameraStatus('2品をカメラ映像の上に立体表示しています');
    } else if (cameraVideoReady) {
      setCameraStatus('カメラ起動済み・料理の立体を準備しています');
    } else if (cameraModelReady) {
      setCameraStatus('料理の立体を準備済み・カメラを起動しています');
    }
  }

  async function startCameraFeed() {
    if (!window.isSecureContext) throw new Error('Camera requires HTTPS');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable');
    stopCameraStream();
    setCameraStatus('カメラを起動しています');
    cameraStream = await requestCameraStream(cameraFacing);
    cameraArVideo.setAttribute('playsinline', '');
    cameraArVideo.setAttribute('webkit-playsinline', '');
    cameraArVideo.muted = true;
    cameraArVideo.srcObject = cameraStream;
    await cameraArVideo.play();
    await waitForCameraVideo();
    cameraVideoReady = true;
    syncCameraViewport();
    updateCameraReadyStatus();
  }

  async function startCameraForOverlay() {
    if (cameraOpening) return;
    cameraOpening = true;
    const retry = document.getElementById('retryCameraArButton');
    retry.hidden = true;
    try {
      await startCameraFeed();
    } catch (error) {
      stopCameraStream();
      setCameraStatus(cameraFailureMessage(error), 'error');
      retry.hidden = false;
    } finally {
      cameraOpening = false;
    }
  }

  function applyCameraDistance() {
    cameraArViewer.setAttribute('camera-orbit', `0deg 66deg ${cameraDistance.toFixed(2)}m`);
    if (typeof cameraArViewer.jumpCameraToGoal === 'function') cameraArViewer.jumpCameraToGoal();
  }

  async function openCameraAr() {
    if (!pairModelReady || cameraOpening) return;
    const source = viewer.getAttribute('src');
    if (!source) {
      setMessage('料理の立体を準備してから、もう一度3Dカメラ比較を押してください。', 'warning');
      return;
    }
    const left = byId.get(selected[0]);
    const right = byId.get(selected[1]);
    cameraModelReady = true;
    cameraVideoReady = false;
    cameraDistance = 1.18;
    cameraArNames.textContent = `${left.name} と ${right.name}`;
    cameraArViewer.setAttribute('alt', `${left.name}と${right.name}をカメラ映像に重ねた立体比較`);
    cameraArViewer.setAttribute('touch-action', 'none');
    cameraArModelHost.appendChild(cameraArViewer);
    cameraArOverlay.hidden = false;
    document.body.classList.add('camera-ar-open');
    cameraLandscape = isLandscapeCameraViewport();
    syncCameraViewport();
    setCameraStatus('カメラと料理の立体を準備しています');
    await startCameraForOverlay();
  }

  function closeCameraAr(restoreFocus = true) {
    stopCameraStream();
    window.clearTimeout(cameraViewportTimer);
    window.clearTimeout(cameraRestartTimer);
    cameraArOverlay.hidden = true;
    document.body.classList.remove('camera-ar-open');
    if (cameraArViewer.parentNode !== viewerHome) viewerHome.insertBefore(cameraArViewer, viewerHomeNext);
    cameraArViewer.setAttribute('touch-action', 'pan-y');
    cameraArViewer.style.removeProperty('width');
    cameraArViewer.style.removeProperty('height');
    cameraArViewer.setAttribute('camera-orbit', '0deg 62deg 1.25m');
    if (typeof cameraArViewer.jumpCameraToGoal === 'function') cameraArViewer.jumpCameraToGoal();
    cameraModelReady = false;
    document.getElementById('retryCameraArButton').hidden = true;
    if (restoreFocus) {
      (needsLegacyIPadCamera ? browserArButton : simpleCameraArButton).focus();
    }
  }

  async function switchCameraAr() {
    cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    await startCameraForOverlay();
  }

  viewer.addEventListener('progress', (event) => {
    const progress = Math.max(0, Math.min(1, event.detail.totalProgress || 0));
    progressBar.style.width = `${Math.round(progress * 100)}%`;
    if (progress >= 1) progressBar.style.width = '0%';
  });

  viewer.addEventListener('load', (event) => {
    const loadedSource = normalizedModelUrl(event.detail?.url);
    if (!loadedSource || loadedSource !== expectedViewerSource || expectedViewerRevision !== pairLoadRevision) return;
    clearViewerLoadTimer();
    pairModelReady = true;
    viewer.setAttribute('aria-busy', 'false');
    const left = byId.get(selected[0]);
    const right = byId.get(selected[1]);
    setMessage(pairFallbackActive
      ? `${left.name}を3D表示しています。2品表示は再読み込みで復旧できます。`
      : `${left.name}と${right.name}を立体で表示しています`);
    updateArAvailability();
    detectNativeArSupport();
    if (legacy3dRequested && !legacy3dAutoOpened) {
      legacy3dAutoOpened = true;
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('legacy3d');
      history.replaceState(null, '', cleanUrl);
      window.setTimeout(openCameraAr, 0);
    }
  });

  function handleViewerFailure(reason = 'error') {
    if (expectedViewerRevision !== pairLoadRevision || pairModelReady) return;
    clearViewerLoadTimer();
    if (!localPairAttempted && composer) {
      setMessage('端末内で2品の立体を準備し直しています', 'warning');
      loadLocalPair(pairLoadRevision);
      return;
    }
    if (!pairFallbackActive) {
      pairFallbackActive = true;
      replaceViewerSource(byId.get(selected[0]).modelUrl, false, pairLoadRevision);
      setMessage('2品の読み込みに失敗したため、候補1を安全表示しています。', 'warning');
      return;
    }
    viewer.setAttribute('aria-busy', 'false');
    setMessage(reason === 'timeout'
      ? '3Dの準備に時間がかかっています。通信を確認して再読み込みしてください。'
      : '3Dを読み込めませんでした。通信を確認して再読み込みしてください。', 'error');
  }

  viewer.addEventListener('error', (event) => {
    const failedUrl = event.detail?.sourceError?.target?.responseURL
      || event.detail?.sourceError?.url
      || '';
    if (failedUrl && normalizedModelUrl(failedUrl) !== expectedViewerSource) return;
    handleViewerFailure('error');
  });

  viewer.addEventListener('ar-status', (event) => {
    const messages = {
      'session-started': '机をゆっくり映してください',
      'object-placed': '料理を机に配置しました。端末を動かして確認できます。',
      failed: '標準ARを起動できなかったため、共通空間ARへ切り替えます。',
      'not-presenting': '3D比較画面に戻りました'
    };
    if (messages[event.detail.status]) setMessage(messages[event.detail.status], event.detail.status === 'failed' ? 'warning' : 'normal');
    if (event.detail.status === 'failed' && nativeArAttempted) {
      clearNativeArAttempt();
      window.setTimeout(openSpatialAr, 0);
    }
    if (['session-started', 'object-placed', 'not-presenting'].includes(event.detail.status)) clearNativeArAttempt();
  });

  cameraArViewer.addEventListener('load', () => {
    if (cameraArOverlay.hidden) return;
    cameraModelReady = true;
    updateCameraReadyStatus();
  });

  cameraArViewer.addEventListener('error', () => {
    if (cameraArOverlay.hidden) return;
    cameraModelReady = false;
    setCameraStatus('料理の立体を読み込めませんでした。画面を閉じて再度お試しください。', 'error');
  });

  document.querySelectorAll('[data-choice-index]').forEach((button) => {
    button.addEventListener('click', () => {
      activeChoice = Number(button.dataset.choiceIndex);
      updateChoiceButtons();
      renderMenu();
      document.getElementById('menuTitle').scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  });

  searchInput.addEventListener('input', renderMenu);

  browserArButton.addEventListener('click', openPreferredAr);
  simpleCameraArButton.addEventListener('click', openCameraAr);
  document.getElementById('closeCameraArButton').addEventListener('click', () => closeCameraAr());
  document.getElementById('switchCameraArButton').addEventListener('click', switchCameraAr);
  document.getElementById('retryCameraArButton').addEventListener('click', startCameraForOverlay);
  cameraArVideo.addEventListener('resize', queueCameraViewportSync);
  window.addEventListener('resize', queueCameraViewportSync);
  window.visualViewport?.addEventListener('resize', queueCameraViewportSync);
  window.screen.orientation?.addEventListener('change', queueCameraViewportSync);
  window.addEventListener('orientationchange', () => {
    queueCameraViewportSync();
    window.setTimeout(queueCameraViewportSync, 620);
  });
  document.getElementById('cameraSizeDownButton').addEventListener('click', () => {
    cameraDistance = Math.min(2.4, cameraDistance + .16);
    applyCameraDistance();
  });
  document.getElementById('cameraSizeUpButton').addEventListener('click', () => {
    cameraDistance = Math.max(.62, cameraDistance - .14);
    applyCameraDistance();
  });
  document.getElementById('cameraResetButton').addEventListener('click', () => {
    cameraDistance = 1.18;
    applyCameraDistance();
  });

  const helpDialog = document.getElementById('helpDialog');
  document.getElementById('helpButton').addEventListener('click', () => helpDialog.showModal());
  document.getElementById('closeHelpButton').addEventListener('click', () => helpDialog.close());
  helpDialog.addEventListener('click', (event) => {
    if (event.target === helpDialog) helpDialog.close();
  });

  const shareDialog = document.getElementById('shareDialog');
  document.getElementById('shareButton').addEventListener('click', () => {
    prepareShareDetails();
    shareDialog.showModal();
  });
  document.getElementById('closeShareButton').addEventListener('click', () => shareDialog.close());
  shareDialog.addEventListener('click', (event) => {
    if (event.target === shareDialog) shareDialog.close();
  });
  document.getElementById('copyShareUrlButton').addEventListener('click', async (event) => {
    try {
      await copyText(canonicalAppUrl);
      event.currentTarget.textContent = 'コピーしました';
    } catch (_) {
      event.currentTarget.textContent = 'コピーできませんでした';
    }
  });

  const isEmbeddedBrowser = /Line\//i.test(navigator.userAgent)
    || /FBAN|FBAV|Instagram/i.test(navigator.userAgent);
  const browserNotice = document.getElementById('browserNotice');
  browserNotice.hidden = !isEmbeddedBrowser;
  iosOrientationNote.hidden = !isIPhone;
  document.getElementById('copyUrlButton').addEventListener('click', async () => {
    try {
      await copyText(canonicalAppUrl);
      document.getElementById('copyUrlButton').textContent = 'コピーしました';
    } catch (_) {
      setMessage('URLをコピーできませんでした。共有メニューからSafariで開いてください。', 'warning');
    }
  });

  categoryButtons();
  updateChoiceButtons();
  renderMenu();
  refreshPair();

  customElements.whenDefined('model-viewer').then(() => {
    viewerReady = true;
    refreshPair();
    updateArAvailability();
    detectNativeArSupport();
    [1200, 3000, 6000].forEach((delay) => {
      window.setTimeout(detectNativeArSupport, delay);
    });
  });

  window.addEventListener('pagehide', () => {
    closeCameraAr(false);
    releasePairResources();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      location.reload();
      return;
    }
    spatialArOpening = false;
  });
})();
