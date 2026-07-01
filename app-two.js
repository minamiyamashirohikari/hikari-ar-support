(function () {
  const MAX_ITEMS = 2;
  const STORAGE_KEY = 'senshakuSelectedIds';
  const PANEL_KEY = 'senshakuPanel';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const markerPatterns = [
    [1,0,1,0, 0,1,0,1, 1,0,1,0, 0,1,0,1],
    [0,1,0,1, 1,0,1,0, 0,1,0,1, 1,0,1,0],
    [1,1,0,0, 1,0,0,1, 0,0,1,1, 0,1,1,0]
  ];

  function safeRead(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function allItems() {
    return Array.isArray(window.MENU_ITEMS) ? window.MENU_ITEMS : [];
  }

  function defaultIds() {
    return allItems().slice(0, MAX_ITEMS).map((item) => item.id);
  }

  let selectedIds = safeRead(STORAGE_KEY, defaultIds()).filter((id) => allItems().some((item) => item.id === id));
  if (selectedIds.length === 0) selectedIds = defaultIds();
  selectedIds = selectedIds.slice(0, MAX_ITEMS);
  safeWrite(STORAGE_KEY, selectedIds);

  function selectedItems() {
    return selectedIds.map((id) => allItems().find((item) => item.id === id)).filter(Boolean);
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function miniMarker(pattern) {
    const cells = pattern.map((cell) => `<span class="${cell ? 'on' : ''}"></span>`).join('');
    return `<div class="mini-marker" aria-hidden="true">${cells}</div>`;
  }

  function renderCount() {
    const pill = $('#countPill');
    if (pill) pill.textContent = `${selectedIds.length}/${MAX_ITEMS}`;
  }

  function renderAR(items) {
    const grid = $('#markerCards');
    if (!grid) return;
    grid.innerHTML = items.map((item, index) => `
      <button class="marker-card ${index === 0 ? 'active' : ''}" type="button" data-index="${index}">
        ${miniMarker(markerPatterns[index % markerPatterns.length])}
        <span>${item.name}</span>
      </button>
    `).join('');

    $$('#markerCards .marker-card').forEach((button) => {
      button.addEventListener('click', () => {
        $$('#markerCards .marker-card').forEach((card) => card.classList.remove('active'));
        button.classList.add('active');
        const item = items[Number(button.dataset.index)];
        updateARPreview(item, markerPatterns[Number(button.dataset.index) % markerPatterns.length]);
        showResult(item);
      });
    });

    if (items[0]) updateARPreview(items[0], markerPatterns[0]);
  }

  function updateARPreview(item, pattern) {
    const image = $('#arFoodImg');
    const label = $('#arLabel');
    const marker = $('#arMarker');
    if (image) {
      image.src = item.image;
      image.alt = item.name;
    }
    if (label) label.innerHTML = `${item.name}<small>${item.reading}</small>`;
    if (marker) marker.innerHTML = pattern.map((cell) => `<span class="${cell ? 'on' : ''}"></span>`).join('');
  }

  function renderThreeD(items) {
    const grid = $('#spinGrid');
    if (!grid) return;
    grid.innerHTML = items.map((item) => `
      <button class="three-card" type="button" data-id="${item.id}">
        <span class="shadow"></span>
        <span class="plate">
          <img src="${item.image}" alt="${item.name}">
          <span class="gloss"></span>
          <span class="steam"></span>
        </span>
        <strong>${item.name}</strong>
        <small>${item.reading}</small>
      </button>
    `).join('');
    $$('#spinGrid .three-card').forEach((card) => {
      card.addEventListener('click', () => {
        $$('#spinGrid .three-card').forEach((button) => button.classList.remove('selected'));
        card.classList.add('selected');
        const item = allItems().find((menu) => menu.id === card.dataset.id);
        const confirm = $('#spinConfirm');
        if (confirm) confirm.disabled = false;
        if (item) showResult(item);
      });
    });
  }

  function renderPrint(items) {
    const date = $('#printDate');
    const grid = $('#printGrid');
    if (date) {
      const now = new Date();
      date.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    }
    if (!grid) return;
    grid.innerHTML = items.map((item, index) => `
      <article class="print-choice">
        <span class="number">${index + 1}</span>
        <img src="${item.image}" alt="${item.name}">
        <strong>${item.name}</strong>
        <small>${item.reading}</small>
      </article>
    `).join('');
  }

  function renderAnim(items) {
    const grid = $('#animGrid');
    if (!grid) return;
    grid.innerHTML = items.map((item) => `
      <button class="anim-card" type="button" data-id="${item.id}">
        <img src="${item.image}" alt="${item.name}">
        <strong>${item.name}</strong>
        <small>${item.tags.slice(0, 3).join(' / ')}</small>
      </button>
    `).join('');
    $$('#animGrid .anim-card').forEach((card) => {
      card.addEventListener('click', () => {
        $$('#animGrid .anim-card').forEach((button) => button.classList.remove('selected'));
        card.classList.add('selected');
        const item = allItems().find((menu) => menu.id === card.dataset.id);
        if (item) showResult(item);
      });
    });
  }

  function renderAll() {
    const items = selectedItems();
    renderCount();
    renderAR(items);
    renderThreeD(items);
    renderPrint(items);
    renderAnim(items);
    renderSelectedBar();
  }

  function renderSelectedBar() {
    const bar = $('#selectedBarSlots');
    if (!bar) return;
    bar.innerHTML = selectedItems().map((item) => `
      <span class="selected-chip">${item.emoji} ${item.name}</span>
    `).join('');
  }

  function showResult(item) {
    const result = $('#resultToast');
    if (!result) return;
    result.textContent = `${item.name} を選びました`;
    result.classList.add('show');
    window.clearTimeout(showResult.timer);
    showResult.timer = window.setTimeout(() => result.classList.remove('show'), 1800);
  }

  function openPicker() {
    const modal = $('#pickerModal');
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }
    renderCategories();
    renderPickerItems();
  }

  function closePicker() {
    const modal = $('#pickerModal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function renderCategories() {
    const target = $('#pickerCategories');
    if (!target) return;
    target.innerHTML = window.MENU_CATEGORIES.map((cat) => {
      const count = allItems().filter((item) => item.category === cat.id).length;
      return `<button type="button" class="category-filter" data-category="${cat.id}">${cat.emoji}<span>${cat.label}</span><small>${count}</small></button>`;
    }).join('');
    $$('#pickerCategories .category-filter').forEach((button) => {
      button.addEventListener('click', () => {
        $$('#pickerCategories .category-filter').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        renderPickerItems(button.dataset.category);
      });
    });
  }

  function renderPickerItems(categoryId) {
    const grid = $('#pickerItems');
    if (!grid) return;
    const items = categoryId ? allItems().filter((item) => item.category === categoryId) : allItems();
    grid.innerHTML = items.map((item) => {
      const active = selectedIds.includes(item.id);
      return `
        <button type="button" class="picker-item ${active ? 'selected' : ''}" data-id="${item.id}">
          <img src="${item.image}" alt="${item.name}">
          <span><strong>${item.name}</strong><small>${item.reading}</small></span>
        </button>
      `;
    }).join('');
    $$('#pickerItems .picker-item').forEach((button) => {
      button.addEventListener('click', () => toggleItem(button.dataset.id, categoryId));
    });
  }

  function toggleItem(id, categoryId) {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((itemId) => itemId !== id);
    } else {
      if (selectedIds.length >= MAX_ITEMS) selectedIds.shift();
      selectedIds.push(id);
    }
    if (selectedIds.length === 0) selectedIds = [id];
    safeWrite(STORAGE_KEY, selectedIds);
    renderAll();
    renderPickerItems(categoryId);
  }

  function setActivePanel(panelId, options = {}) {
    $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.panel === panelId));
    $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === panelId));
    try { localStorage.setItem(PANEL_KEY, panelId); } catch (_) {}
    if (options.scroll) {
      const tabs = $('.tabs');
      if (tabs) tabs.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function bindEvents() {
    $('#openPicker')?.addEventListener('click', openPicker);
    $('#quickPicker')?.addEventListener('click', openPicker);
    $('#closePicker')?.addEventListener('click', closePicker);
    $('#backTop')?.addEventListener('click', scrollToTop);
    $('#clearBtn')?.addEventListener('click', () => {
      selectedIds = defaultIds();
      safeWrite(STORAGE_KEY, selectedIds);
      renderAll();
      renderPickerItems();
    });
    $$('.tab').forEach((tab) => tab.addEventListener('click', () => setActivePanel(tab.dataset.panel, { scroll: false })));
    $('#spinConfirm')?.addEventListener('click', () => closePicker());
    $('.modal-backdrop')?.addEventListener('click', closePicker);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePicker();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    renderAll();
    const savedPanel = safeRead(PANEL_KEY, 'p1');
    setActivePanel(typeof savedPanel === 'string' ? savedPanel : 'p1', { scroll: false });
  });
})();
