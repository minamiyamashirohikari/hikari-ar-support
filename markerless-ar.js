(function () {
  'use strict';

  const STORAGE_KEY = 'senshakuSelectedIds';
  const FAVORITES = [
    'shoyu_ramen', 'miso_ramen', 'gyudon', 'katsudon', 'beef_curry',
    'hamburg_steak', 'omurice', 'fried_chicken_plate', 'udon', 'spaghetti'
  ];
  const MAX_MENU_PREVIEWS = 4;
  const items = Array.isArray(window.MENU_ITEMS) ? window.MENU_ITEMS : [];
  const categories = Array.isArray(window.MENU_CATEGORIES) ? window.MENU_CATEGORIES : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const qualityIds = window.HIKARI_HIGH_QUALITY_IDS || new Set();
  const fallbackIds = ['miso_ramen', 'gyudon'];
  const composer = window.HIKARI_GLB_COMPOSER;
  const preferLocalPair = location.hostname.endsWith('.github.io') || location.protocol === 'file:';
  const modelBufferCache = new Map();

  const viewer = document.getElementById('pairViewer');
  const viewerMessage = document.getElementById('viewerMessage');
  const deviceNote = document.getElementById('deviceNote');
  const arButton = document.getElementById('arButton');
  const menuGrid = document.getElementById('menuGrid');
  const menuCount = document.getElementById('menuCount');
  const categoryStrip = document.getElementById('categoryStrip');
  const searchInput = document.getElementById('searchInput');
  const targetLabel = document.getElementById('targetLabel');
  const progressBar = document.getElementById('progressBar');

  let activeChoice = 0;
  let activeCategory = 'favorites';
  let pairFallbackActive = false;
  let localPairAttempted = false;
  let pairLoadRevision = 0;
  let pairObjectUrl = '';
  let menuPreviewObserver = null;
  let visibleMenuPreviews = new Set();
  let selected = readSelection();

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

  function pairUrl() {
    const url = new URL('api/pair.glb', document.baseURI);
    url.searchParams.set('left', selected[0]);
    url.searchParams.set('right', selected[1]);
    return url.href;
  }

  async function modelBytes(id) {
    if (!modelBufferCache.has(id)) {
      const item = byId.get(id);
      const request = fetch(new URL(item.modelUrl, document.baseURI), { cache: 'force-cache' })
        .then((response) => {
          if (!response.ok) throw new Error(`Model unavailable: ${id}`);
          return response.arrayBuffer();
        })
        .then((buffer) => new Uint8Array(buffer))
        .catch((error) => {
          modelBufferCache.delete(id);
          throw error;
        });
      modelBufferCache.set(id, request);
    }
    return modelBufferCache.get(id);
  }

  function replaceViewerSource(url, ownsObjectUrl = false) {
    if (pairObjectUrl && pairObjectUrl !== url) URL.revokeObjectURL(pairObjectUrl);
    pairObjectUrl = ownsObjectUrl ? url : '';
    // Attributes survive a late <model-viewer> custom-element upgrade; expando
    // properties set before registration can otherwise be replaced by HTML defaults.
    viewer.setAttribute('src', url);
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
      replaceViewerSource(objectUrl, true);
    } catch (_) {
      if (revision !== pairLoadRevision) return;
      pairFallbackActive = true;
      replaceViewerSource(byId.get(selected[0]).modelUrl);
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
    if (preferLocalPair && composer) {
      loadLocalPair(revision);
    } else {
      replaceViewerSource(pairUrl());
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
    if (container.dataset.hydrated === 'true') return;
    if (!container.dataset.loadingLabel) {
      container.dataset.loadingLabel = container.getAttribute('aria-label') || `${container.dataset.modelAlt}を準備中`;
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
    container.dataset.hydrated = 'true';
    container.removeAttribute('role');
    container.removeAttribute('aria-label');
    container.replaceChildren(model);
  }

  function dehydrateMenuPreview(container) {
    if (container.dataset.hydrated !== 'true') return;
    container.dataset.hydrated = 'false';
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', container.dataset.loadingLabel || `${container.dataset.modelAlt}を準備中`);
    container.replaceChildren();
  }

  function hydrateVisibleMenuPreviews() {
    if (menuPreviewObserver) menuPreviewObserver.disconnect();
    const previews = menuGrid.querySelectorAll('.menu-model');
    visibleMenuPreviews = new Set();
    if (!('IntersectionObserver' in window)) {
      Array.from(previews).slice(0, MAX_MENU_PREVIEWS).forEach(hydrateMenuPreview);
      return;
    }
    // Keep iPhone memory stable by retaining card previews only near the viewport.
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
        .slice(0, MAX_MENU_PREVIEWS));
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
      const quality = qualityIds.has(item.id) ? '<span class="quality-mark">写真質感</span>' : '';
      return `
        <button class="menu-card${selectedIndex !== -1 ? ' selected' : ''}" type="button" data-menu-id="${item.id}" aria-disabled="${duplicate}">
          ${quality}
          <span class="menu-model" data-model-url="${item.modelUrl}" data-model-alt="${item.name}の立体" role="img" aria-label="${item.name}の3Dを準備中"></span>
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

  function updateArAvailability() {
    const supported = Boolean(viewer.canActivateAR);
    arButton.hidden = !supported;
    if (supported) {
      deviceNote.textContent = '「ARで机に表示」を押し、机をゆっくり映して配置してください。マーカーは不要です。';
    } else {
      deviceNote.textContent = 'この端末ではARを起動できないため、指やマウスで回せる3D表示を利用しています。';
    }
  }

  viewer.addEventListener('progress', (event) => {
    const progress = Math.max(0, Math.min(1, event.detail.totalProgress || 0));
    progressBar.style.width = `${Math.round(progress * 100)}%`;
    if (progress >= 1) progressBar.style.width = '0%';
  });

  viewer.addEventListener('load', () => {
    const left = byId.get(selected[0]);
    const right = byId.get(selected[1]);
    setMessage(pairFallbackActive
      ? `${left.name}を3D表示しています。2品表示は再読み込みで復旧できます。`
      : `${left.name}と${right.name}を立体で表示しています`);
    updateArAvailability();
  });

  viewer.addEventListener('error', () => {
    if (!localPairAttempted && composer) {
      setMessage('端末内で2品の立体を準備し直しています', 'warning');
      loadLocalPair(pairLoadRevision);
      return;
    }
    if (!pairFallbackActive) {
      pairFallbackActive = true;
      replaceViewerSource(byId.get(selected[0]).modelUrl);
      setMessage('2品の読み込みに失敗したため、候補1を安全表示しています。', 'warning');
      return;
    }
    setMessage('3Dを読み込めませんでした。通信を確認して再読み込みしてください。', 'error');
  });

  viewer.addEventListener('ar-status', (event) => {
    const messages = {
      'session-started': '机をゆっくり映してください',
      'object-placed': '料理を机に配置しました。端末を動かして確認できます。',
      failed: 'ARを起動できませんでした。この画面の3D表示をご利用ください。',
      'not-presenting': '3D比較画面に戻りました'
    };
    if (messages[event.detail.status]) setMessage(messages[event.detail.status], event.detail.status === 'failed' ? 'warning' : 'normal');
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

  const helpDialog = document.getElementById('helpDialog');
  document.getElementById('helpButton').addEventListener('click', () => helpDialog.showModal());
  document.getElementById('closeHelpButton').addEventListener('click', () => helpDialog.close());
  helpDialog.addEventListener('click', (event) => {
    if (event.target === helpDialog) helpDialog.close();
  });

  const isEmbeddedBrowser = /Line\//i.test(navigator.userAgent)
    || /FBAN|FBAV|Instagram/i.test(navigator.userAgent);
  const browserNotice = document.getElementById('browserNotice');
  browserNotice.hidden = !isEmbeddedBrowser;
  document.getElementById('copyUrlButton').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
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
    updateArAvailability();
    window.setTimeout(updateArAvailability, 1200);
  });

  window.addEventListener('pagehide', () => {
    if (menuPreviewObserver) menuPreviewObserver.disconnect();
    if (pairObjectUrl) URL.revokeObjectURL(pairObjectUrl);
  });
})();
