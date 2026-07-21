(function () {
  'use strict';

  const STORAGE_KEY = 'senshakuSelectedIds';
  const FAVORITES = [
    'shoyu_ramen', 'miso_ramen', 'gyudon', 'katsudon', 'beef_curry',
    'hamburg_steak', 'omurice', 'fried_chicken_plate', 'udon', 'spaghetti'
  ];
  const DESKTOP_MENU_PREVIEW_LIMIT = 4;
  const items = Array.isArray(window.MENU_ITEMS) ? window.MENU_ITEMS : [];
  const categories = Array.isArray(window.MENU_CATEGORIES) ? window.MENU_CATEGORIES : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const fallbackIds = ['miso_ramen', 'gyudon'];
  const composer = window.HIKARI_GLB_COMPOSER;
  // Use the same on-device composition path in development and on GitHub Pages.
  const preferLocalPair = Boolean(composer);
  const modelBufferCache = new Map();

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
  const menuPreviewLimit = (isIPhone || isIPad || isAndroid) ? 1 : DESKTOP_MENU_PREVIEW_LIMIT;
  if (!isIPhone) viewer.removeAttribute('ar');

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
  let menuPreviewObserver = null;
  let visibleMenuPreviews = new Set();
  let nativeArSupported = false;
  let cameraStream = null;
  let cameraFacing = 'environment';
  let cameraOpening = false;
  let cameraModelReady = false;
  let cameraVideoReady = false;
  let cameraDistance = 1.18;
  let selected = readSelection();
  const simpleArRequested = new URLSearchParams(location.search).get('simpleAr') === '1';
  let simpleArAutoOpened = false;

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

  async function modelBytes(id) {
    if (!modelBufferCache.has(id)) {
      const item = byId.get(id);
      const controller = new AbortController();
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
        .finally(() => window.clearTimeout(timeout));
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
      const categoryMatch = activeCategory === 'all'
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

  function hydrateMenuPreview(container) {
    if (container.dataset.hydrated === 'true' || container.dataset.modelFailed === 'true') return;
    if (!container.dataset.posterLabel) {
      container.dataset.posterLabel = container.getAttribute('aria-label') || `${container.dataset.modelAlt}の料理写真`;
    }
    const model = document.createElement('model-viewer');
    const attributes = {
      src: container.dataset.modelUrl,
      alt: container.dataset.modelAlt,
      loading: 'eager',
      reveal: 'auto',
      'interaction-prompt': 'none',
      'camera-orbit': '20deg 62deg 3.1m',
      'field-of-view': '30deg',
      exposure: '1.05',
      'shadow-intensity': '.55',
      'shadow-softness': '1',
      'disable-pan': '',
      'disable-zoom': ''
    };
    Object.entries(attributes).forEach(([name, value]) => model.setAttribute(name, value));
    model.addEventListener('error', () => {
      if (!container.contains(model)) return;
      container.dataset.modelFailed = 'true';
      dehydrateMenuPreview(container);
    }, { once: true });
    container.dataset.hydrated = 'true';
    container.removeAttribute('role');
    container.removeAttribute('aria-label');
    container.replaceChildren(model);
  }

  function createMenuPoster(container) {
    const poster = document.createElement('img');
    poster.className = 'menu-photo';
    poster.src = container.dataset.imageUrl;
    poster.alt = '';
    poster.loading = 'lazy';
    poster.decoding = 'async';
    return poster;
  }

  function dehydrateMenuPreview(container) {
    if (container.dataset.hydrated !== 'true') return;
    container.dataset.hydrated = 'false';
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', container.dataset.posterLabel || `${container.dataset.modelAlt}の料理写真`);
    container.replaceChildren(createMenuPoster(container));
  }

  function releaseMenuPreviews() {
    if (menuPreviewObserver) menuPreviewObserver.disconnect();
    visibleMenuPreviews.clear();
    menuGrid.querySelectorAll('.menu-model').forEach(dehydrateMenuPreview);
  }

  function hydrateVisibleMenuPreviews() {
    if (menuPreviewObserver) menuPreviewObserver.disconnect();
    const previews = menuGrid.querySelectorAll('.menu-model');
    visibleMenuPreviews = new Set();
    if (!('IntersectionObserver' in window)) {
      Array.from(previews).slice(0, menuPreviewLimit).forEach(hydrateMenuPreview);
      return;
    }
    // Keep mobile GPU memory stable by retaining card previews only near the viewport.
    menuPreviewObserver = new window.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visibleMenuPreviews.add(entry.target);
        else visibleMenuPreviews.delete(entry.target);
      });
      const viewportCenter = window.innerHeight / 2;
      const keep = new Set([...visibleMenuPreviews]
        .sort((left, right) => {
          const leftBox = left.getBoundingClientRect();
          const rightBox = right.getBoundingClientRect();
          const leftDistance = Math.abs((leftBox.top + leftBox.bottom) / 2 - viewportCenter);
          const rightDistance = Math.abs((rightBox.top + rightBox.bottom) / 2 - viewportCenter);
          return leftDistance - rightDistance;
        })
        .slice(0, menuPreviewLimit));
      previews.forEach((preview) => {
        if (keep.has(preview)) hydrateMenuPreview(preview);
        else dehydrateMenuPreview(preview);
      });
    }, { rootMargin: '160px 0px' });
    previews.forEach((preview) => menuPreviewObserver.observe(preview));
  }

  function renderMenu() {
    const visible = filteredItems();
    menuCount.textContent = `${visible.length}品を表示しています（全${items.length}品）`;
    if (!visible.length) {
      if (menuPreviewObserver) menuPreviewObserver.disconnect();
      menuGrid.innerHTML = '<p>条件に合う料理がありません。</p>';
      return;
    }
    menuGrid.innerHTML = visible.map((item) => {
      const selectedIndex = selected.indexOf(item.id);
      const duplicate = selectedIndex !== -1 && selectedIndex !== activeChoice;
      return `
        <button class="menu-card${selectedIndex !== -1 ? ' selected' : ''}" type="button" data-menu-id="${item.id}" aria-disabled="${duplicate}">
          <span class="menu-model" data-model-url="${item.modelUrl}" data-image-url="${item.image}" data-model-alt="${item.name}の立体" role="img" aria-label="${item.name}の料理写真">
            <img class="menu-photo" src="${item.image}" alt="" loading="lazy" decoding="async">
          </span>
          <span class="menu-card-text">
            <strong>${item.name}</strong>
            <span>${item.categoryLabel}</span>
          </span>
        </button>`;
    }).join('');
    hydrateVisibleMenuPreviews();
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
    nativeArSupported = isIPhone && Boolean(viewer.canActivateAR);
    updateArAvailability();
  }

  function updateArAvailability() {
    if (!viewerReady || !pairModelReady) {
      nativeArButton.hidden = true;
      browserArButton.disabled = true;
      simpleCameraArButton.disabled = true;
      deviceNote.textContent = '選んだ2品の立体を準備しています。';
      return;
    }
    browserArButton.disabled = false;
    simpleCameraArButton.disabled = false;
    nativeArButton.hidden = true;
    if (nativeArSupported) {
      browserArButton.textContent = 'iPhone標準ARを起動';
      deviceNote.textContent = 'iPhone標準ARを優先します。料理を机に置き、端末を動かして横や斜めから確認できます。';
    } else {
      browserArButton.textContent = '空間ARを起動';
      deviceNote.textContent = '追加アプリ不要の空間ARで、料理を机に固定して横や斜めから確認できます。';
    }
  }

  function openSpatialAr() {
    if (!pairModelReady) return;
    const url = new URL('spatial-ar.html', document.baseURI);
    url.searchParams.set('left', selected[0]);
    url.searchParams.set('right', selected[1]);
    location.href = url.href;
  }

  async function openPreferredAr() {
    if (!pairModelReady) return;
    if (!nativeArSupported) {
      openSpatialAr();
      return;
    }
    browserArButton.disabled = true;
    setMessage('iPhone標準ARを起動しています');
    try {
      await viewer.activateAR();
    } catch (_) {
      setMessage('iPhone標準ARを開始できなかったため、空間ARへ切り替えます。', 'warning');
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
    const attempts = [
      {
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
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
      setMessage('料理の立体を準備してから、もう一度カメラARを押してください。', 'warning');
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
    releaseMenuPreviews();
    cameraArModelHost.appendChild(cameraArViewer);
    applyCameraDistance();
    cameraArOverlay.hidden = false;
    document.body.classList.add('camera-ar-open');
    setCameraStatus('カメラと料理の立体を準備しています');
    await startCameraForOverlay();
  }

  function closeCameraAr(restoreFocus = true) {
    stopCameraStream();
    cameraArOverlay.hidden = true;
    document.body.classList.remove('camera-ar-open');
    if (cameraArViewer.parentNode !== viewerHome) viewerHome.insertBefore(cameraArViewer, viewerHomeNext);
    cameraArViewer.setAttribute('touch-action', 'pan-y');
    cameraArViewer.setAttribute('camera-orbit', '0deg 62deg 1.25m');
    if (typeof cameraArViewer.jumpCameraToGoal === 'function') cameraArViewer.jumpCameraToGoal();
    cameraModelReady = false;
    document.getElementById('retryCameraArButton').hidden = true;
    if (restoreFocus) {
      hydrateVisibleMenuPreviews();
      simpleCameraArButton.focus();
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
    if (simpleArRequested && !simpleArAutoOpened) {
      simpleArAutoOpened = true;
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('simpleAr');
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
      failed: '標準ARを起動できませんでした。「カメラARを起動」をご利用ください。',
      'not-presenting': '3D比較画面に戻りました'
    };
    if (messages[event.detail.status]) setMessage(messages[event.detail.status], event.detail.status === 'failed' ? 'warning' : 'normal');
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
    window.setTimeout(updateArAvailability, 1200);
  });

  window.addEventListener('pagehide', () => {
    if (menuPreviewObserver) menuPreviewObserver.disconnect();
    clearViewerLoadTimer();
    closeCameraAr(false);
    if (pairObjectUrl) URL.revokeObjectURL(pairObjectUrl);
  });
})();
