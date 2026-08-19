(function () {
  'use strict';

  const STORAGE_KEY = 'senshakuSelectedIds';
  const DEFAULT_IDS = ['miso_ramen', 'gyudon'];
  const RETRY_DELAY_MS = 350;
  const items = Array.isArray(window.MENU_ITEMS) ? window.MENU_ITEMS : [];
  const byId = new Map(items.map((item) => [item.id, item]));

  const cameraApp = document.getElementById('cameraApp');
  const cameraVideo = document.getElementById('cameraVideo');
  const dishOverlay = document.getElementById('dishOverlay');
  const dishImages = [
    document.getElementById('leftDishImage'),
    document.getElementById('rightDishImage')
  ];
  const dishFallbacks = [
    document.getElementById('leftDishFallback'),
    document.getElementById('rightDishFallback')
  ];
  const dishNames = [
    document.getElementById('leftDishName'),
    document.getElementById('rightDishName')
  ];
  const statusPill = document.getElementById('statusPill');
  const startGate = document.getElementById('startGate');
  const startCameraButton = document.getElementById('startCameraButton');
  const cameraErrorPanel = document.getElementById('cameraErrorPanel');
  const cameraErrorTitle = document.getElementById('cameraErrorTitle');
  const cameraErrorDetail = document.getElementById('cameraErrorDetail');
  const retryCameraButton = document.getElementById('retryCameraButton');
  const sizeControls = document.getElementById('sizeControls');

  let cameraStream = null;
  let cameraAttempt = 0;
  let cameraStarting = false;
  let pageDisposed = false;
  let dishScale = 1;
  let dishesLoaded = false;

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

  function setStatus(text, tone = 'ready') {
    statusPill.textContent = text;
    statusPill.dataset.tone = tone;
  }

  function stopStream(stream) {
    if (!stream?.getTracks) return;
    for (const track of stream.getTracks()) track.stop();
  }

  function releaseCamera() {
    cameraAttempt += 1;
    stopStream(cameraStream);
    cameraStream = null;
    cameraVideo.pause?.();
    cameraVideo.srcObject = null;
    cameraVideo.hidden = true;
    cameraStarting = false;
  }

  function errorDetails(error) {
    return [error?.name, error?.type, error?.message, error?.constraint]
      .filter(Boolean)
      .join(' ');
  }

  function isPermissionError(error) {
    return /NotAllowed|Permission|Denied|Security/i.test(errorDetails(error));
  }

  function isRetryableCameraError(error) {
    return /NotReadable|Abort|Overconstrained|Constraint|TrackStart|NotFound|DevicesNotFound|TypeError/i
      .test(errorDetails(error));
  }

  function cameraErrorMessage(error) {
    const details = errorDetails(error);
    const code = error?.name ? `（診断: ${error.name}）` : '';
    if (isPermissionError(error)) {
      return `カメラが許可されていません。iPadの「設定」→「Safari」→「カメラ」で許可し、この画面でもう一度お試しください。${code}`;
    }
    if (/NotReadable|Abort|TrackStart/i.test(details)) {
      return `カメラをほかの画面が使用している可能性があります。カメラを使う他のタブやアプリを閉じ、数秒待ってからもう一度お試しください。${code}`;
    }
    if (/NotFound|DevicesNotFound/i.test(details)) {
      return `利用できるカメラを確認できませんでした。iPadを再起動してからSafariでお試しください。${code}`;
    }
    if (/Overconstrained|Constraint/i.test(details)) {
      return `カメラ設定を合わせられませんでした。「もう一度試す」を押すと標準設定で再試行します。${code}`;
    }
    if (/TypeError|Security/i.test(details)) {
      return `この開き方ではカメラを利用できません。リンクをSafariで直接開いてください。${code}`;
    }
    return `カメラを開始できませんでした。カメラを使う他のタブやアプリを閉じてから、もう一度お試しください。${code}`;
  }

  function showCameraError(error) {
    cameraStarting = false;
    startCameraButton.disabled = false;
    startCameraButton.textContent = 'カメラを開始';
    startGate.hidden = true;
    cameraErrorTitle.textContent = 'カメラを開始できませんでした';
    cameraErrorDetail.textContent = cameraErrorMessage(error);
    cameraErrorPanel.hidden = false;
    setStatus('カメラ設定を確認してください', 'error');
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function requestCamera(attempt) {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      const unsupported = new Error('getUserMedia is unavailable');
      unsupported.name = 'UnsupportedError';
      throw unsupported;
    }

    const plans = [
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      },
      { audio: false, video: { facingMode: 'environment' } },
      { audio: false, video: true }
    ];
    let lastError = null;

    for (let index = 0; index < plans.length; index += 1) {
      try {
        const stream = await mediaDevices.getUserMedia(plans[index]);
        if (attempt !== cameraAttempt || pageDisposed) {
          stopStream(stream);
          return null;
        }
        return stream;
      } catch (error) {
        lastError = error;
        if (isPermissionError(error) || !isRetryableCameraError(error) || index === plans.length - 1) break;
        await sleep(RETRY_DELAY_MS * (index + 1));
        if (attempt !== cameraAttempt || pageDisposed) return null;
      }
    }
    throw lastError || new Error('Camera request failed');
  }

  function imageUrl(item) {
    const source = item?.photoImage || item?.image || '';
    if (!source || source.startsWith('data:')) return source;
    return new URL(source, document.baseURI).href;
  }

  function loadDishImages() {
    if (dishesLoaded || pageDisposed) return;
    dishesLoaded = true;
    selected.forEach((id, index) => {
      const item = byId.get(id);
      const image = dishImages[index];
      const fallback = dishFallbacks[index];
      dishNames[index].textContent = item?.name || '料理';
      fallback.textContent = item?.emoji || '🍽️';
      image.alt = `${item?.name || '料理'}の写真`;
      image.addEventListener('load', () => {
        image.hidden = false;
        fallback.hidden = true;
      }, { once: true });
      image.addEventListener('error', () => {
        image.hidden = true;
        fallback.hidden = false;
      }, { once: true });
      const source = imageUrl(item);
      if (source) image.src = source;
      else image.hidden = true;
    });
  }

  function finishCameraStart() {
    cameraStarting = false;
    startGate.hidden = true;
    cameraErrorPanel.hidden = true;
    dishOverlay.hidden = false;
    sizeControls.hidden = false;
    loadDishImages();
    setStatus('料理をカメラ映像に重ねて表示しています', 'ready');
  }

  async function playAttachedCamera() {
    cameraVideo.muted = true;
    cameraVideo.defaultMuted = true;
    cameraVideo.autoplay = true;
    cameraVideo.playsInline = true;
    cameraVideo.setAttribute('playsinline', '');
    cameraVideo.setAttribute('webkit-playsinline', '');
    cameraVideo.hidden = false;
    await cameraVideo.play();
  }

  async function startCamera() {
    if (cameraStarting || pageDisposed) return;
    cameraErrorPanel.hidden = true;
    startGate.hidden = false;
    startCameraButton.disabled = true;

    if (cameraStream) {
      cameraStarting = true;
      startCameraButton.textContent = '映像を表示しています';
      try {
        await playAttachedCamera();
        if (!pageDisposed) finishCameraStart();
      } catch (error) {
        cameraStarting = false;
        startCameraButton.disabled = false;
        startCameraButton.textContent = '映像を表示';
        setStatus('もう一度「映像を表示」を押してください', 'warning');
      }
      return;
    }

    cameraStarting = true;
    const attempt = ++cameraAttempt;
    startCameraButton.textContent = 'カメラを起動しています';
    setStatus('カメラの使用を許可してください', 'warning');
    try {
      const stream = await requestCamera(attempt);
      if (!stream || attempt !== cameraAttempt || pageDisposed) return;
      cameraStream = stream;
      cameraVideo.srcObject = stream;
      try {
        await playAttachedCamera();
      } catch (_) {
        if (attempt !== cameraAttempt || pageDisposed) return;
        cameraStarting = false;
        startCameraButton.disabled = false;
        startCameraButton.textContent = '映像を表示';
        setStatus('「映像を表示」をもう一度押してください', 'warning');
        return;
      }
      if (attempt !== cameraAttempt || pageDisposed) return;
      finishCameraStart();
    } catch (error) {
      if (attempt !== cameraAttempt || pageDisposed) return;
      releaseCamera();
      showCameraError(error);
    }
  }

  function retryCamera() {
    cameraErrorPanel.hidden = true;
    startGate.hidden = false;
    startCameraButton.disabled = false;
    startCameraButton.textContent = 'カメラを開始';
    setStatus('カメラを開始できます', 'ready');
  }

  function changeScale(delta) {
    dishScale = Math.min(1.35, Math.max(0.7, dishScale + delta));
    cameraApp.style.setProperty('--dish-scale', String(dishScale));
    setStatus(dishScale === 1 ? '標準サイズに戻しました' : `表示サイズ ${Math.round(dishScale * 100)}%`);
  }

  startCameraButton.addEventListener('click', startCamera);
  retryCameraButton.addEventListener('click', retryCamera);
  document.getElementById('sizeDownButton').addEventListener('click', () => changeScale(-0.1));
  document.getElementById('sizeResetButton').addEventListener('click', () => {
    dishScale = 1;
    cameraApp.style.setProperty('--dish-scale', '1');
    setStatus('標準サイズに戻しました');
  });
  document.getElementById('sizeUpButton').addEventListener('click', () => changeScale(0.1));

  window.addEventListener('pagehide', () => {
    pageDisposed = true;
    releaseCamera();
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
})();
