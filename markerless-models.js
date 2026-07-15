(function () {
  const highQuality = new Set([
    'shoyu_ramen', 'miso_ramen', 'beef_curry', 'hamburg_steak', 'omurice',
    'fried_chicken_plate', 'udon', 'gyudon', 'katsudon', 'spaghetti'
  ]);

  for (const id of window.REAL_MODEL_TARGETS || []) {
    const folder = highQuality.has(id) ? 'models_high_quality' : 'models';
    const revision = highQuality.has(id) ? '?v=20260715-ios-png1' : '';
    window.registerRealFoodModel(id, {
      url: `assets/${folder}/${id}.glb${revision}`,
      scale: '.13 .13 .13',
      rotation: '0 0 0',
      position: '0 0 0'
    });
  }

  window.HIKARI_HIGH_QUALITY_IDS = highQuality;
})();
