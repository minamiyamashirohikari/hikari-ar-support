// GLB model registry.
// Every menu item is listed here so AR and preview pages can treat it as a 3D target.
(function () {
  window.REAL_MODEL_TARGETS = [
    'shoyu_ramen',
    'miso_ramen',
    'tonkotsu_ramen',
    'tsukemen',
    'gyudon',
    'oyakodon',
    'katsudon',
    'beef_curry',
    'katsu_curry',
    'vegetable_curry',
    'sushi',
    'grilled_fish',
    'tempura',
    'ebi_fry',
    'udon',
    'hamburg_steak',
    'omurice',
    'fried_chicken_plate',
    'kids_plate',
    'spaghetti',
    'gratin',
    'stew',
    'hamburger',
    'pizza',
    'fried_potato',
    'sandwich',
    'sandwich2',
    'soup',
    'salad',
    'pudding',
    'cake',
    'ice_cream',
    'fruit_jelly',
    'tea',
    'water',
    'orange_juice',
    'milk',
    'onigiri',
    'bread_roll',
    'toast',
    'gyoza',
    'fried_rice',
    'mapo_tofu',
    'harumaki',
    'osechi',
    'chirashi_sushi',
    'ehomaki',
    'toshikoshi_soba',
    'facility_breakfast',
    'facility_lunch',
    'facility_snack_fruit',
    'facility_snack_yogurt'
  ];

  window.REAL_MODEL_FILES = window.REAL_MODEL_FILES || {};

  window.registerRealFoodModel = function registerRealFoodModel(id, options) {
    if (!id || !options || !options.url) return;
    window.REAL_MODEL_FILES[id] = {
      url: options.url,
      scale: options.scale || '.9 .9 .9',
      rotation: options.rotation || '0 0 0',
      position: options.position || '0 .12 0'
    };
  };
})();
