(function () {
  'use strict';

  const STORAGE_KEY = 'senshakuSelectedIds';
  const DEFAULT_IDS = ['miso_ramen', 'gyudon'];
  const MODEL_TIMEOUT_MS = 60000;
  const ENGINE_CORE_TIMEOUT_MS = 15000;
  const SLAM_CHUNK_TIMEOUT_MS = 30000;
  const REALITY_TIMEOUT_MS = 30000;
  const HIT_TEST_TYPES = ['DETECTED_SURFACE', 'ESTIMATED_SURFACE', 'FEATURE_POINT'];
  const HIT_PRIORITY = [...HIT_TEST_TYPES, 'UNSPECIFIED'];
  const PREVIEW_SURFACE_PROBE_MS = 450;
  const SURFACE_STABILITY_SAMPLES = 3;
  const SURFACE_STABILITY_DISTANCE = 0.12;
  const items = Array.isArray(window.MENU_ITEMS) ? window.MENU_ITEMS : [];
  const byId = new Map(items.map((item) => [item.id, item]));

  const arApp = document.getElementById('arApp');
  const scene = document.getElementById('xrScene');
  const camera = document.getElementById('arCamera');
  const fallbackCameraVideo = document.getElementById('fallbackCameraVideo');
  const pairEntity = document.getElementById('pairEntity');
  const dishEntities = [
    document.getElementById('leftDishEntity'),
    document.getElementById('rightDishEntity')
  ];
  const shadowCatcher = document.getElementById('shadowCatcher');
  const statusPill = document.getElementById('statusPill');
  const aimGuide = document.getElementById('aimGuide');
  const startGate = document.getElementById('startGate');
  const startTitle = document.getElementById('startTitle');
  const spatialStartSteps = document.getElementById('spatialStartSteps');
  const fallbackStartSteps = document.getElementById('fallbackStartSteps');
  const startCameraButton = document.getElementById('startCameraButton');
  const placeButton = document.getElementById('placeButton');
  const recenterButton = document.getElementById('recenterButton');
  const sizeControls = document.getElementById('sizeControls');
  const fatalPanel = document.getElementById('fatalPanel');
  const fatalTitle = document.getElementById('fatalTitle');
  const fatalDetail = document.getElementById('fatalDetail');
  const simpleArLink = document.getElementById('simpleArLink');

  let modelLoadTimer = 0;
  let engineLoadTimer = 0;
  let realityReadyTimer = 0;
  let loadedDishCount = 0;
  let engineAttempt = 0;
  let enginePreparing = false;
  let engineReady = false;
  let modelsPrepared = false;
  let fallbackMode = false;
  let fallbackRouting = false;
  let fallbackStream = null;
  let fallbackCameraAttempt = 0;
  let pageDisposed = false;
  let cameraStarted = false;
  let realityReady = false;
  let trackingNormal = false;
  let modelReady = false;
  let placed = false;
  let placementMode = 'none';
  let modelScale = 1;
  let fatalShown = false;
  let previewAnimationFrame = 0;
  let lastSurfaceProbeAt = 0;
  let previewWorldPosition = null;
  let previewCameraPosition = null;
  let previewOrientation = null;
  let previewOffset = null;
  let stableSurfaceHit = null;
  let stableSurfaceHitCount = 0;

  function selectedIds() {
    const params = new URLSearchParams(location.search);
    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (_) {
      stored = [];
    }
    const left = params.get('left') || stored[0] || DEFAULT_IDS[0];
    const right = params.get('right') || stored[1] || DEFAULT_IDS[1];
    if (!byId.has(left) || !byId.has(right) || left === right) return [...DEFAULT_IDS];
    return [left, right];
  }

  const selected = selectedIds();
  const fallbackRequested = new URLSearchParams(location.search).get('camera') === '1';

  function setStatus(text, tone = 'loading') {
    statusPill.textContent = text;
    statusPill.dataset.tone = tone;
  }

  function clearRealityReadyTimer() {
    if (!realityReadyTimer) return;
    window.clearTimeout(realityReadyTimer);
    realityReadyTimer = 0;
  }

  function clearEngineLoadTimer() {
    if (!engineLoadTimer) return;
    window.clearTimeout(engineLoadTimer);
    engineLoadTimer = 0;
  }

  function setEntityVisible(entity, visible) {
    if (!entity) return;
    if (entity.getAttribute('visible') !== visible) entity.setAttribute('visible', visible);
    if (entity.object3D && entity.object3D.visible !== visible) entity.object3D.visible = visible;
  }

  function canShowPair() {
    return cameraStarted && realityReady && modelReady && !fatalShown && !pageDisposed;
  }

  function updateControls() {
    const fallbackPairVisible = fallbackMode && canShowPair();
    const canPlace = !fallbackMode && canShowPair() && trackingNormal;
    placeButton.hidden = fallbackMode;
    placeButton.disabled = !canPlace;
    recenterButton.hidden = fallbackMode;
    recenterButton.disabled = fallbackMode || !cameraStarted || fatalShown;
    aimGuide.dataset.visible = String(canPlace);
    aimGuide.dataset.placed = String(placed);
    sizeControls.hidden = !(placed || fallbackPairVisible);
  }

  function stopFallbackCamera() {
    fallbackCameraAttempt += 1;
    if (fallbackStream) {
      for (const track of fallbackStream.getTracks()) track.stop();
    }
    fallbackStream = null;
    if (fallbackCameraVideo) {
      fallbackCameraVideo.pause?.();
      fallbackCameraVideo.srcObject = null;
      fallbackCameraVideo.hidden = true;
    }
  }

  function showFatal(title, detail) {
    if (fatalShown || pageDisposed) return;
    fatalShown = true;
    clearEngineLoadTimer();
    clearRealityReadyTimer();
    stopPreviewLoop();
    stopFallbackCamera();
    fatalTitle.textContent = title;
    fatalDetail.textContent = detail;
    const fallback = new URL('camera-ar.html', document.baseURI);
    fallback.searchParams.set('v', '20260820-minicam43');
    fallback.searchParams.set('left', selected[0]);
    fallback.searchParams.set('right', selected[1]);
    simpleArLink.href = fallback.href;
    fatalPanel.hidden = false;
    startGate.hidden = true;
    setStatus(title, 'error');
    updateControls();
  }

  function cameraErrorMessage(error) {
    const details = [error?.name, error?.type, error?.message, error?.err, error?.reason]
      .filter(Boolean)
      .join(' ');
    if (/NotAllowed|Permission|Denied/i.test(details)) {
      return 'カメラが許可されていません。SafariまたはChromeのサイト設定でカメラを許可してください。';
    }
    if (/NotFound|DevicesNotFound/i.test(details)) {
      return '背面カメラを見つけられませんでした。別のブラウザまたは端末でお試しください。';
    }
    if (/Incompatible|Unsupported|WebAssembly|WebGL|SIMD/i.test(details)) {
      return 'このOSまたはブラウザは空間ARに対応していません。OSとSafari・Chromeを更新するか、簡易カメラ表示をご利用ください。';
    }
    return 'AR機能またはカメラを開始できませんでした。通信を確認し、SafariまたはChromeで開き直してください。';
  }

  function clearModelLoadTimer() {
    if (!modelLoadTimer) return;
    window.clearTimeout(modelLoadTimer);
    modelLoadTimer = 0;
  }

  function normalizeDishEntity(entity, offsetX, model) {
    if (!entity?.object3D || !model || !window.THREE) {
      throw new Error('Dish model is unavailable');
    }
    entity.object3D.position.set(0, 0, 0);
    entity.object3D.rotation.set(0, 0, 0);
    entity.object3D.scale.setScalar(1);
    entity.object3D.updateMatrixWorld(true);
    model.updateMatrixWorld(true);

    const bounds = new window.THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new window.THREE.Vector3());
    const center = bounds.getCenter(new window.THREE.Vector3());
    const horizontalSpan = Math.max(size.x, size.z);
    if (!Number.isFinite(horizontalSpan) || horizontalSpan <= 0) {
      throw new Error('Dish model has invalid bounds');
    }

    const scale = 0.22 / horizontalSpan;
    entity.object3D.scale.setScalar(scale);
    entity.object3D.rotation.set(0, Math.PI, 0);
    entity.object3D.position.set(
      offsetX + center.x * scale,
      -bounds.min.y * scale,
      center.z * scale
    );
    entity.object3D.updateMatrixWorld(true);
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = false;
    });
  }

  function armModelLoadTimer(item) {
    clearModelLoadTimer();
    modelLoadTimer = window.setTimeout(() => {
      showFatal(
        `${item.name}の立体を読み込めませんでした`,
        '通信を確認して「もう一度試す」を押してください。高品質モデルは変更せず再読み込みします。'
      );
    }, MODEL_TIMEOUT_MS);
  }

  function beginDishLoad(index) {
    if (pageDisposed) return;
    const item = byId.get(selected[index]);
    const entity = dishEntities[index];
    if (!item?.modelUrl || !entity) {
      showFatal('料理の3Dモデルが見つかりません', '料理選択に戻り、別の2品を選んでください。');
      return;
    }
    setStatus(`${item.name}を読み込んでいます（${index + 1}/2）`);
    armModelLoadTimer(item);
    entity.dataset.modelLoaded = 'false';
    entity.setAttribute('gltf-model', new URL(item.modelUrl, document.baseURI).href);
  }

  function handleDishLoaded(index, event) {
    const entity = dishEntities[index];
    if (entity.dataset.modelLoaded === 'true' || fatalShown || pageDisposed) return;
    clearModelLoadTimer();
    try {
      normalizeDishEntity(entity, index === 0 ? -0.145 : 0.145, event.detail?.model);
    } catch (_) {
      showFatal('料理の立体を配置できませんでした', '画面を再読み込みしてください。改善しない場合は簡易カメラ表示をご利用ください。');
      return;
    }
    entity.dataset.modelLoaded = 'true';
    loadedDishCount += 1;
    if (index === 0) {
      beginDishLoad(1);
      return;
    }

    modelReady = loadedDishCount === dishEntities.length;
    setEntityVisible(pairEntity, false);
    if (engineReady && !cameraStarted) setStatus('「カメラを開始」を押してください', 'ready');
    else if (realityReady && trackingNormal) setStatus('中央を机に合わせて「ここに置く」を押してください', 'ready');
    updateControls();
    ensurePreviewVisible();
  }

  function prepareDishModels() {
    if (modelsPrepared || pageDisposed) return;
    modelsPrepared = true;
    if (!byId.size) {
      showFatal('料理データを準備できませんでした', '画面を再読み込みしてください。改善しない場合は簡易カメラ表示をご利用ください。');
      return;
    }
    const left = byId.get(selected[0]);
    const right = byId.get(selected[1]);
    if (!left?.modelUrl || !right?.modelUrl) {
      showFatal('料理の3Dモデルが見つかりません', '料理選択に戻り、別の2品を選んでください。');
      return;
    }
    loadedDishCount = 0;
    setStatus(`${left.name}と${right.name}を順番に準備しています`);
    beginDishLoad(0);
  }

  function persistSelection() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch (_) {
      // The URL still carries the selection when storage is unavailable.
    }
  }

  function markEngineReady() {
    if (engineReady || fallbackMode || fallbackRouting || fatalShown || pageDisposed) return;
    clearEngineLoadTimer();
    enginePreparing = false;
    engineReady = true;
    prepareDishModels();
    startCameraButton.disabled = false;
    startCameraButton.textContent = 'カメラを開始';
    if (modelReady) setStatus('「カメラを開始」を押してください', 'ready');
  }

  function fallbackUrl() {
    const url = new URL('camera-ar.html', document.baseURI);
    url.searchParams.set('v', '20260820-minicam43');
    url.searchParams.set('left', selected[0]);
    url.searchParams.set('right', selected[1]);
    return url;
  }

  function routeToCameraFallback(message) {
    if (fallbackMode || fallbackRouting || fatalShown || pageDisposed) return;
    fallbackRouting = true;
    engineAttempt += 1;
    clearEngineLoadTimer();
    clearRealityReadyTimer();
    persistSelection();
    setStatus(message || '軽量カメラARへ切り替えています', 'warning');
    try {
      window.XR8?.stop?.();
    } catch (_) {
      // Reloading the page releases any partially initialized XR resources.
    }
    location.replace(fallbackUrl().href);
  }

  function enableCameraFallback() {
    if (fatalShown || pageDisposed) return;
    fallbackMode = true;
    fallbackRouting = false;
    engineAttempt += 1;
    clearEngineLoadTimer();
    clearRealityReadyTimer();
    enginePreparing = false;
    engineReady = false;
    arApp.dataset.arMode = 'camera-fallback';
    startTitle.textContent = '料理をカメラ映像に重ねて表示します';
    spatialStartSteps.hidden = true;
    fallbackStartSteps.hidden = false;
    startCameraButton.disabled = false;
    startCameraButton.textContent = 'カメラARを開始';
    startGate.hidden = false;
    setStatus('軽量カメラARを利用できます', 'ready');
    prepareDishModels();
    updateControls();
  }

  function prepareSpatialEngine() {
    if (engineReady || enginePreparing || fallbackMode || fallbackRouting || fatalShown || pageDisposed) return;
    if (!window.XR8) {
      routeToCameraFallback('空間認識を読み込めないため、軽量表示へ切り替えています');
      return;
    }
    if (window.XR8.XrController) {
      markEngineReady();
      return;
    }
    if (typeof window.XR8.loadChunk !== 'function') {
      routeToCameraFallback('空間認識に対応していないため、軽量表示へ切り替えています');
      return;
    }

    enginePreparing = true;
    const attempt = ++engineAttempt;
    setStatus('空間認識を準備しています');
    clearEngineLoadTimer();
    engineLoadTimer = window.setTimeout(() => {
      if (attempt === engineAttempt && !engineReady && !fallbackMode && !fatalShown && !pageDisposed) {
        routeToCameraFallback('空間認識の準備に時間がかかるため、軽量表示へ切り替えています');
      }
    }, SLAM_CHUNK_TIMEOUT_MS);

    Promise.resolve()
      .then(() => window.XR8.loadChunk('slam'))
      .then(() => {
        if (attempt !== engineAttempt || fallbackMode || fallbackRouting || fatalShown || pageDisposed) return;
        if (!window.XR8?.XrController) throw new Error('SLAM controller is unavailable');
        markEngineReady();
      })
      .catch(() => {
        if (attempt === engineAttempt && !fallbackMode && !fallbackRouting && !fatalShown && !pageDisposed) {
          routeToCameraFallback('空間認識を開始できないため、軽量表示へ切り替えています');
        }
      });
  }

  function loadSpatialEngine() {
    if (pageDisposed) return;
    if (window.XR8) {
      prepareSpatialEngine();
      return;
    }
    window.addEventListener('xrloaded', prepareSpatialEngine, { once: true });
    const script = document.createElement('script');
    script.src = new URL('vendor/8thwall/xr.js?v=20260819-ipad42', document.baseURI).href;
    script.async = true;
    script.addEventListener('load', () => {
      if (window.XR8) prepareSpatialEngine();
    });
    script.addEventListener('error', () => {
      routeToCameraFallback('AR機能を読み込めないため、軽量表示へ切り替えています');
    });
    document.head.appendChild(script);
    engineLoadTimer = window.setTimeout(() => {
      if (!window.XR8 && !fallbackMode && !fallbackRouting && !fatalShown && !pageDisposed) {
        routeToCameraFallback('AR機能の準備に時間がかかるため、軽量表示へ切り替えています');
      }
    }, ENGINE_CORE_TIMEOUT_MS);
  }

  async function startFallbackCamera() {
    if (!fallbackMode || cameraStarted || fatalShown || pageDisposed) return;
    const attempt = ++fallbackCameraAttempt;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      showFatal('カメラを開始できませんでした', 'このブラウザではカメラを利用できません。SafariまたはChromeで開いてください。');
      return;
    }
    cameraStarted = true;
    startCameraButton.disabled = true;
    startCameraButton.textContent = 'カメラを起動しています';
    setStatus('カメラの使用を許可してください');
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      if (attempt !== fallbackCameraAttempt || pageDisposed) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      fallbackStream = stream;
      fallbackCameraVideo.srcObject = fallbackStream;
      fallbackCameraVideo.hidden = false;
      await fallbackCameraVideo.play();
      if (attempt !== fallbackCameraAttempt || pageDisposed) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      realityReady = true;
      trackingNormal = false;
      placed = false;
      placementMode = 'preview';
      startGate.hidden = true;
      updateControls();
      ensurePreviewVisible();
      if (!modelReady) setStatus('カメラを開始しました。料理の立体を準備しています');
    } catch (error) {
      if (attempt !== fallbackCameraAttempt) return;
      cameraStarted = false;
      stopFallbackCamera();
      showFatal('カメラを開始できませんでした', cameraErrorMessage(error));
    }
  }

  function startCamera() {
    if (pageDisposed) return;
    if (fallbackMode) {
      startFallbackCamera();
      return;
    }
    if (!engineReady || cameraStarted || fatalShown) return;
    cameraStarted = true;
    startCameraButton.disabled = true;
    startCameraButton.textContent = 'カメラを起動しています';
    setStatus('カメラの許可を確認しています');
    clearRealityReadyTimer();
    try {
      scene.setAttribute('xrweb', 'allowedDevices: mobile; scale: absolute');
    } catch (error) {
      cameraStarted = false;
      routeToCameraFallback('空間ARを開始できないため、軽量表示へ切り替えています');
    }
  }

  function armRealityReadyTimer() {
    if (realityReady || fatalShown || realityReadyTimer) return;
    realityReadyTimer = window.setTimeout(() => {
      if (!realityReady && !fatalShown) {
        routeToCameraFallback('空間認識を開始できないため、軽量表示へ切り替えています');
      }
    }, REALITY_TIMEOUT_MS);
  }

  function bestHit(results, { surfaceOnly = false, maxDistance = 4 } = {}) {
    const usable = (Array.isArray(results) ? results : []).filter((result) => {
      const position = result?.position;
      return position
        && Number.isFinite(position.x)
        && Number.isFinite(position.y)
        && Number.isFinite(position.z)
        && (!surfaceOnly || result.type === 'DETECTED_SURFACE' || result.type === 'ESTIMATED_SURFACE')
        && (!Number.isFinite(result.distance) || (result.distance > 0 && result.distance <= maxDistance));
    });
    usable.sort((left, right) => {
      const leftPriority = HIT_PRIORITY.indexOf(left.type);
      const rightPriority = HIT_PRIORITY.indexOf(right.type);
      const priorityDifference = (leftPriority < 0 ? HIT_PRIORITY.length : leftPriority)
        - (rightPriority < 0 ? HIT_PRIORITY.length : rightPriority);
      if (priorityDifference) return priorityDifference;
      return (left.distance || 99) - (right.distance || 99);
    });
    return usable[0] || null;
  }

  function faceCurrentCamera(position) {
    if (!camera?.object3D || !window.THREE) return 0;
    previewCameraPosition ||= new window.THREE.Vector3();
    camera.object3D.getWorldPosition(previewCameraPosition);
    return Math.atan2(previewCameraPosition.x - position.x, previewCameraPosition.z - position.z) * 180 / Math.PI;
  }

  function applyScale() {
    pairEntity.object3D.scale.setScalar(modelScale);
    shadowCatcher.object3D.scale.setScalar(modelScale);
  }

  function hitAtCenter(options) {
    if (!window.XR8?.XrController?.hitTest) return null;
    let results = [];
    try {
      results = window.XR8.XrController.hitTest(0.5, 0.54, HIT_TEST_TYPES);
    } catch (_) {
      results = [];
    }
    return bestHit(results, options);
  }

  function previewPosition() {
    if (!camera?.object3D || !window.THREE) return null;
    previewWorldPosition ||= new window.THREE.Vector3();
    previewOrientation ||= new window.THREE.Quaternion();
    previewOffset ||= new window.THREE.Vector3();
    camera.object3D.getWorldPosition(previewWorldPosition);
    camera.object3D.getWorldQuaternion(previewOrientation);
    previewOffset.set(0, -0.16, -0.82).applyQuaternion(previewOrientation);
    return previewWorldPosition.add(previewOffset);
  }

  function updatePreviewPose() {
    if (placementMode !== 'preview' || !canShowPair()) return false;
    const position = previewPosition();
    if (!position) return false;
    pairEntity.object3D.position.copy(position);
    pairEntity.object3D.rotation.set(0, faceCurrentCamera(position) * Math.PI / 180, 0);
    setEntityVisible(pairEntity, true);
    setEntityVisible(shadowCatcher, false);
    applyScale();
    return true;
  }

  function showCameraPreview() {
    if (!canShowPair() || placed) return false;
    const enteringPreview = placementMode !== 'preview';
    placementMode = 'preview';
    if (enteringPreview) resetSurfaceStability();
    placeButton.textContent = '机に固定する';
    const shown = updatePreviewPose();
    if (shown) {
      setStatus(fallbackMode
        ? '料理をカメラ映像に重ねて表示しています（空間固定なし）'
        : '料理を仮表示しました。机をゆっくり映すと自動で固定します',
      fallbackMode ? 'ready' : 'warning');
      startPreviewLoop();
    }
    updateControls();
    return shown;
  }

  function ensurePreviewVisible() {
    if (!canShowPair() || placed || placementMode === 'surface') return;
    showCameraPreview();
  }

  function anchorPair(hit, automatic = false) {
    if (!hit?.position) return false;

    const position = hit.position;
    pairEntity.object3D.position.set(position.x, position.y + 0.006, position.z);
    pairEntity.object3D.rotation.set(0, faceCurrentCamera(position) * Math.PI / 180, 0);
    setEntityVisible(pairEntity, true);
    shadowCatcher.object3D.position.set(position.x, position.y + 0.002, position.z);
    shadowCatcher.object3D.rotation.set(-Math.PI / 2, 0, 0);
    setEntityVisible(shadowCatcher, true);
    applyScale();
    placed = true;
    placementMode = 'surface';
    resetSurfaceStability();
    stopPreviewLoop();
    placeButton.textContent = 'ここに置き直す';
    setStatus(automatic
      ? '机を検出し、料理を自動で固定しました。端末を動かして確認できます'
      : '料理を固定しました。端末を動かして横や斜めから確認できます', 'ready');
    updateControls();
    return true;
  }

  function placeAtCenter() {
    if (placeButton.disabled) return;
    const hit = hitAtCenter({ maxDistance: 4 });
    if (hit) {
      anchorPair(hit);
      return;
    }
    placed = false;
    placementMode = 'preview';
    resetSurfaceStability();
    showCameraPreview();
    setStatus('料理は見える位置に仮表示中です。机をゆっくり左右に映してください', 'warning');
  }

  function startPreviewLoop() {
    if (previewAnimationFrame || placementMode !== 'preview' || !canShowPair()) return;
    previewAnimationFrame = window.requestAnimationFrame(updatePreview);
  }

  function stopPreviewLoop() {
    if (!previewAnimationFrame) return;
    window.cancelAnimationFrame(previewAnimationFrame);
    previewAnimationFrame = 0;
  }

  function resetSurfaceStability() {
    stableSurfaceHit = null;
    stableSurfaceHitCount = 0;
  }

  function stableSurfaceAnchor(hit) {
    if (!hit?.position) {
      resetSurfaceStability();
      return null;
    }
    const previous = stableSurfaceHit?.position;
    const delta = previous
      ? Math.hypot(
        hit.position.x - previous.x,
        hit.position.y - previous.y,
        hit.position.z - previous.z
      )
      : Infinity;
    stableSurfaceHitCount = delta <= SURFACE_STABILITY_DISTANCE
      ? stableSurfaceHitCount + 1
      : 1;
    stableSurfaceHit = {
      ...hit,
      position: { x: hit.position.x, y: hit.position.y, z: hit.position.z }
    };
    return stableSurfaceHitCount >= SURFACE_STABILITY_SAMPLES ? stableSurfaceHit : null;
  }

  function updatePreview(timestamp) {
    previewAnimationFrame = 0;
    if (placementMode === 'preview' && canShowPair()) {
      updatePreviewPose();
      if (!fallbackMode && trackingNormal && timestamp - lastSurfaceProbeAt >= PREVIEW_SURFACE_PROBE_MS) {
        lastSurfaceProbeAt = timestamp;
        const hit = hitAtCenter({ surfaceOnly: true, maxDistance: 3 });
        const stableHit = stableSurfaceAnchor(hit);
        if (stableHit) anchorPair(stableHit, true);
      }
    }
    startPreviewLoop();
  }

  function recenter() {
    if (fallbackMode || !cameraStarted || fatalShown) return;
    placed = false;
    placementMode = 'preview';
    resetSurfaceStability();
    setEntityVisible(shadowCatcher, false);
    placeButton.textContent = '机に固定する';
    sizeControls.hidden = true;
    trackingNormal = false;
    updatePreviewPose();
    startPreviewLoop();
    setStatus('料理を仮表示しながら、机の位置を取り直しています');
    try {
      window.XR8?.XrController?.recenter();
    } catch (_) {
      location.reload();
      return;
    }
    updateControls();
  }

  function changeScale(delta) {
    modelScale = Math.min(1.45, Math.max(0.65, modelScale + delta));
    applyScale();
    setStatus(modelScale === 1 ? '実物大に戻しました' : `大きさ ${Math.round(modelScale * 100)}%`, 'ready');
  }

  dishEntities.forEach((entity, index) => {
    entity.addEventListener('model-loaded', (event) => handleDishLoaded(index, event));
    entity.addEventListener('model-error', () => {
      clearModelLoadTimer();
      const item = byId.get(selected[index]);
      showFatal(
        `${item?.name || '料理'}の立体を表示できませんでした`,
        '高品質モデルを読み直すため、「もう一度試す」を押してください。'
      );
    });
  });

  scene.addEventListener('camerastatuschange', (event) => {
    if (fallbackMode || pageDisposed) return;
    const status = event.detail?.status;
    if (status === 'requesting') setStatus('カメラの使用を許可してください');
    if (status === 'hasStream') {
      setStatus('カメラ映像を開始しています');
      armRealityReadyTimer();
    }
    if (status === 'hasVideo') {
      setStatus('机をゆっくり映してください');
      armRealityReadyTimer();
    }
    if (status === 'failed') {
      const detail = cameraErrorMessage(event.detail);
      if (detail.startsWith('カメラが許可されていません')) {
        showFatal('カメラを開始できませんでした', detail);
      } else {
        cameraStarted = false;
        routeToCameraFallback('空間ARカメラを開始できないため、軽量表示へ切り替えています');
      }
    }
  });

  scene.addEventListener('realityready', () => {
    if (fallbackMode || fallbackRouting || pageDisposed) return;
    clearRealityReadyTimer();
    realityReady = true;
    startGate.hidden = true;
    updateControls();
    ensurePreviewVisible();
    if (!modelReady) setStatus('カメラを開始しました。料理の立体を準備しています');
  });

  scene.addEventListener('xrtrackingstatus', (event) => {
    if (fallbackMode || fallbackRouting || pageDisposed) return;
    trackingNormal = event.detail?.status === 'NORMAL';
    ensurePreviewVisible();
    if (trackingNormal) {
      if (placed) setStatus('料理は空間に固定されています', 'ready');
      else if (placementMode === 'preview') {
        setStatus('料理を仮表示中です。机を中央に映すと自動で固定します', 'warning');
      } else {
        setStatus('中央を机に合わせて「ここに置く」を押してください', 'ready');
      }
    } else if (realityReady) {
      setStatus(modelReady
        ? '料理を仮表示中です。机の模様が見えるように端末をゆっくり動かしてください'
        : '料理の立体を準備しています', 'warning');
    }
    updateControls();
  });

  scene.addEventListener('realityerror', (event) => {
    if (pageDisposed) return;
    clearRealityReadyTimer();
    const detail = cameraErrorMessage(event.detail?.error || event.detail);
    if (detail.startsWith('カメラが許可されていません')) {
      showFatal('空間ARを開始できませんでした', detail);
    } else {
      cameraStarted = false;
      routeToCameraFallback('空間認識を開始できないため、軽量表示へ切り替えています');
    }
  });

  startCameraButton.addEventListener('click', startCamera);
  placeButton.addEventListener('click', placeAtCenter);
  recenterButton.addEventListener('click', recenter);
  document.getElementById('sizeDownButton').addEventListener('click', () => changeScale(-0.1));
  document.getElementById('sizeResetButton').addEventListener('click', () => {
    modelScale = 1;
    applyScale();
    setStatus('実物大に戻しました', 'ready');
  });
  document.getElementById('sizeUpButton').addEventListener('click', () => changeScale(0.1));
  document.getElementById('retryButton').addEventListener('click', () => location.reload());

  window.addEventListener('pagehide', () => {
    pageDisposed = true;
    engineAttempt += 1;
    clearEngineLoadTimer();
    clearModelLoadTimer();
    clearRealityReadyTimer();
    stopPreviewLoop();
    stopFallbackCamera();
    try {
      window.XR8?.stop?.();
    } catch (_) {
      // The browser will release the camera when this page closes.
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });

  if (fallbackRequested) enableCameraFallback();
  else loadSpatialEngine();
  updateControls();
})();
