(function () {
  const priorityModels = new Set([
    'shoyu_ramen', 'miso_ramen', 'beef_curry', 'hamburg_steak', 'omurice',
    'fried_chicken_plate', 'udon', 'gyudon', 'katsudon', 'spaghetti',
    'sushi', 'grilled_fish', 'tempura', 'ebi_fry', 'hamburger', 'sandwich',
    'sandwich2', 'onigiri'
  ]);
  const revision = '?v=20260722-foodfix12';

  for (const id of window.REAL_MODEL_TARGETS || []) {
    const folder = priorityModels.has(id) ? 'models_high_quality' : 'models';
    window.registerRealFoodModel(id, {
      url: `assets/${folder}/${id}.glb${revision}`,
      scale: '.13 .13 .13',
      rotation: '0 0 0',
      position: '0 0 0'
    });
  }

})();
