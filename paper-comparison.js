(function () {
  'use strict';

  const STORAGE_KEY = 'senshakuSelectedIds';
  const DEFAULT_IDS = ['miso_ramen', 'gyudon'];
  const items = Array.isArray(window.MENU_ITEMS) ? window.MENU_ITEMS : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const params = new URLSearchParams(location.search);

  function selection() {
    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (_) {
      stored = [];
    }
    const selected = [
      params.get('left') || stored[0] || DEFAULT_IDS[0],
      params.get('right') || stored[1] || DEFAULT_IDS[1]
    ];
    if (selected[0] === selected[1] || selected.some((id) => !byId.has(id))) return [...DEFAULT_IDS];
    return selected;
  }

  function posterUrl(item) {
    const revision = item.modelUrl.includes('?') ? item.modelUrl.slice(item.modelUrl.indexOf('?')) : '';
    return `assets/model-posters/${item.id}.jpg${revision}`;
  }

  const selected = selection();
  selected.forEach((id, index) => {
    const item = byId.get(id);
    const image = document.getElementById(`paperImage${index}`);
    image.src = posterUrl(item);
    image.alt = `${item.name}の比較用画像`;
    image.addEventListener('error', () => {
      if (image.dataset.fallback === 'true') return;
      image.dataset.fallback = 'true';
      image.src = item.photoImage || item.image;
    }, { once: true });
    document.getElementById(`paperName${index}`).textContent = item.name;
  });

  document.getElementById('printButton').addEventListener('click', () => window.print());
})();
