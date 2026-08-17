(function () {
  'use strict';

  const STORAGE_KEY = 'senshakuSelectedIds';
  const DEFAULT_IDS = ['miso_ramen', 'gyudon'];
  const MODEL_TIMEOUT_MS = 60000;
  const ENGINE_TIMEOUT_MS = 60000;
  const HIT_PRIORITY = ['DETECTED_SURFACE', 'ESTIMATED_SURFACE', 'FEATURE_POINT', 'UNSPECIFIED'];
  const items = Array.isArray(window.MENU_ITEMS) ? window.MENU_ITEMS : [];
  const byId = new Map(items.map((item) => [item.id, item]));

  const scene = document.getElementById('xrScene');
  const camera = document.getElementById('arCamera');
  const pairEntity = document.getElementById('pairEntity');
  const dishEntities = [
    document.getElementById('leftDishEntity'),
    document.getElementById('rightDishEntity')
  ];
  const shadowCatcher = document.getElementById('shadowCatcher');
  const statusPill = document.getElementById('statusPill');
  const aimGuide = document.getElementById('aimGuide');
  const startGate = document.getElementById('startGate');
  const startCameraButton = document.getElementById('startCameraButton');
  const placeButton = document.getElementById('placeButton');
  const recenterButton = document.getElementById('recenterButton');
  const sizeControls = document.getElementById('sizeControls');
  const fatalPanel = document.getElementById('fatalPanel');
  const fatalTitle = document.getElementById('fatalTitle');
  const fatalDetail = document.getElementById('fatalDetail');
  const simpleArLink = document.getElementById('simpleArLink');

  let modelLoadTimer = 0;
  let loadedDishCount = 0;
  let engineReady = false;
  let cameraStarted = false;
  let realityReady = false;
  let trackingNormal = false;
  let modelReady = false;
  let placed = false;
  let modelScale = 1;
  let fatalShown = false;

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

  function setStatus(text, tone = 'loading') {
    statusPill.textContent = text;
    statusPill.dataset.tone = tone;
  }

  function updateControls() {
    const canPlace = cameraStarted && realityReady && trackingNormal && modelReady && !fatalShown;
    placeButton.disabled = !canPlace;
    recenterButton.disabled = !cameraStarted || fatalShown;
    aimGuide.dataset.visible = String(canPlace);
    aimGuide.dataset.placed = String(placed);
    sizeControls.hidden = !placed;
  }

  function showFatal(title, detail) {
    if (fatalShown) return;
    fatalShown = true;
    fatalTitle.textContent = title;
    fatalDetail.textContent = detail;
    const fallback = new URL('./', document.baseURI);
    fallback.searchParams.set('simpleAr', '1');
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
    if (entity.dataset.modelLoaded === 'true' || fatalShown) return;
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
    pairEntity.object3D.visible = false;
    if (engineReady && !cameraStarted) setStatus('「カメラを開始」を押してください', 'ready');
    else if (realityReady && trackingNormal) setStatus('中央を机に合わせて「ここに置く」を押してください', 'ready');
    updateControls();
  }

  function prepareDishModels() {
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

  function markEngineReady() {
    if (engineReady) return;
    engineReady = true;
    startCameraButton.disabled = false;
    startCameraButton.textContent = 'カメラを開始';
    if (modelReady) setStatus('「カメラを開始」を押してください', 'ready');
  }

  function startCamera() {
    if (!engineReady || cameraStarted || fatalShown) return;
    cameraStarted = true;
    startCameraButton.disabled = true;
    startCameraButton.textContent = 'カメラを起動しています';
    setStatus('カメラの許可を確認しています');
    try {
      scene.setAttribute('xrweb', 'allowedDevices: any; scale: absolute');
    } catch (error) {
      showFatal('空間ARを開始できませんでした', cameraErrorMessage(error));
    }
  }

  function bestHit(results) {
    const usable = (Array.isArray(results) ? results : []).filter((result) => {
      const position = result?.position;
      return position
        && Number.isFinite(position.x)
        && Number.isFinite(position.y)
        && Number.isFinite(position.z)
        && (!Number.isFinite(result.distance) || (result.distance >= 0.18 && result.distance <= 4));
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
    const cameraPosition = new window.THREE.Vector3();
    camera.object3D.getWorldPosition(cameraPosition);
    return Math.atan2(cameraPosition.x - position.x, cameraPosition.z - position.z) * 180 / Math.PI;
  }

  function applyScale() {
    pairEntity.object3D.scale.setScalar(modelScale);
    shadowCatcher.object3D.scale.setScalar(modelScale);
  }

  function placeAtCenter() {
    if (placeButton.disabled || !window.XR8?.XrController?.hitTest) return;
    let results = [];
    try {
      results = window.XR8.XrController.hitTest(0.5, 0.54, ['FEATURE_POINT']);
    } catch (_) {
      results = [];
    }
    const hit = bestHit(results);
    if (!hit) {
      setStatus('机をゆっくり左右に映してから、もう一度押してください', 'warning');
      return;
    }

    const position = hit.position;
    pairEntity.object3D.position.set(position.x, position.y + 0.006, position.z);
    pairEntity.object3D.rotation.set(0, faceCurrentCamera(position) * Math.PI / 180, 0);
    pairEntity.object3D.visible = true;
    shadowCatcher.object3D.position.set(position.x, position.y + 0.002, position.z);
    shadowCatcher.object3D.rotation.set(-Math.PI / 2, 0, 0);
    shadowCatcher.object3D.visible = true;
    applyScale();
    placed = true;
    placeButton.textContent = 'ここに置き直す';
    setStatus('料理を固定しました。端末を動かして横や斜めから確認できます', 'ready');
    updateControls();
  }

  function recenter() {
    if (!cameraStarted || fatalShown) return;
    pairEntity.object3D.visible = false;
    shadowCatcher.object3D.visible = false;
    placed = false;
    placeButton.textContent = 'ここに置く';
    sizeControls.hidden = true;
    trackingNormal = false;
    setStatus('机をゆっくり映して、位置を取り直しています');
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
    const status = event.detail?.status;
    if (status === 'requesting') setStatus('カメラの使用を許可してください');
    if (status === 'hasStream') setStatus('カメラ映像を開始しています');
    if (status === 'hasVideo') setStatus('机をゆっくり映してください');
    if (status === 'failed') showFatal('カメラを開始できませんでした', cameraErrorMessage(event.detail));
  });

  scene.addEventListener('realityready', () => {
    realityReady = true;
    startGate.hidden = true;
    setStatus(modelReady
      ? '机をゆっくり映してください'
      : 'カメラを開始しました。料理の立体を準備しています');
    updateControls();
  });

  scene.addEventListener('xrtrackingstatus', (event) => {
    trackingNormal = event.detail?.status === 'NORMAL';
    if (trackingNormal) {
      setStatus(placed
        ? '料理は空間に固定されています'
        : '中央を机に合わせて「ここに置く」を押してください', 'ready');
    } else if (realityReady) {
      setStatus('机の模様が見えるように、端末をゆっくり左右へ動かしてください', 'warning');
    }
    updateControls();
  });

  scene.addEventListener('realityerror', (event) => {
    showFatal('空間ARを開始できませんでした', cameraErrorMessage(event.detail?.error || event.detail));
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

  if (window.XR8) markEngineReady();
  else window.addEventListener('xrloaded', markEngineReady, { once: true });

  window.setTimeout(() => {
    if (!engineReady && !fatalShown) {
      showFatal('AR機能の読み込みが完了しませんでした', '通信を確認して「もう一度試す」を押してください。');
    }
  }, ENGINE_TIMEOUT_MS);

  window.addEventListener('pagehide', () => {
    clearModelLoadTimer();
    try {
      window.XR8?.stop?.();
    } catch (_) {
      // The browser will release the camera when this page closes.
    }
  });

  prepareDishModels();
  updateControls();
})();
