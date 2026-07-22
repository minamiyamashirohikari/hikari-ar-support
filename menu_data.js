// Menu data for the decision-support app.
// The image field is generated as a lightweight SVG so the app keeps working
// even when external image services are unavailable. Food images avoid emoji
// and use layered dish illustrations that can later be replaced by real photos.
(function () {
  const categories = [
    ['ramen', 'ラーメン', '🍜', '#E8A53F'],
    ['don', '丼もの', '🍚', '#C85A2B'],
    ['curry', 'カレー', '🍛', '#B8722F'],
    ['japanese', '和食', '🍱', '#8B9467'],
    ['family', 'ファミレス', '🍽️', '#D4884C'],
    ['western', '洋食', '🍝', '#C9453E'],
    ['fastfood', 'ファストフード', '🍔', '#E8935A'],
    ['light', '軽食', '🥪', '#A89968'],
    ['sweets', 'スイーツ', '🍰', '#E8789F'],
    ['drink', '飲み物', '🥤', '#6B8E8E'],
    ['ricebread', 'おにぎり・パン', '🍙', '#D4A574'],
    ['chinese', '中華', '🥟', '#C23E3E'],
    ['event', '行事食', '🎉', '#B85CA0'],
    ['facility', '施設の食事', '🏠', '#7B9EC9']
  ];

  const categoryById = Object.fromEntries(categories.map(([id, label, emoji, color]) => [id, { id, label, emoji, color }]));
  const photoImages = {
    shoyu_ramen: 'assets/photos/shoyu_ramen.png',
    miso_ramen: 'assets/photos/miso_ramen.png',
    beef_curry: 'assets/photos/beef_curry.png',
    hamburg_steak: 'assets/photos/hamburg_steak.png',
    omurice: 'assets/photos/omurice.png',
    fried_chicken_plate: 'assets/photos/fried_chicken_plate.png',
    udon: 'assets/photos/udon.png',
    gyudon: 'assets/photos/gyudon.png',
    katsudon: 'assets/photos/katsudon.png',
    spaghetti: 'assets/photos/spaghetti.png',
    sushi: 'assets/photos/sushi.png',
    grilled_fish: 'assets/photos/grilled_fish.png',
    tempura: 'assets/photos/tempura.png',
    hamburger: 'assets/photos/hamburger.png',
    sandwich: 'assets/photos/sandwich.png',
    onigiri: 'assets/photos/onigiri.png'
  };

  function svgFood(item) {
    const label = item.name;
    const color = item.color;
    const id = item.id;
    const category = item.category;
    const tagText = item.tags.join(' ');
    const isRamen = category === 'ramen' || ['udon', 'toshikoshi_soba'].includes(id);
    const isCurry = category === 'curry';
    const isDon = category === 'don' || id === 'fried_rice';
    const isDrink = category === 'drink';
    const isSweets = category === 'sweets';
    const isBread = category === 'ricebread' || ['sandwich', 'hamburger', 'pizza', 'toast', 'bread_roll'].includes(id);
    const isPlate = ['hamburg_steak', 'fried_chicken_plate', 'kids_plate', 'spaghetti', 'gratin', 'stew', 'gyoza', 'mapo_tofu', 'harumaki', 'tempura', 'grilled_fish', 'salad', 'soup'].includes(id);
    const isSushi = ['sushi', 'chirashi_sushi', 'ehomaki', 'osechi'].includes(id);

    const steam = /あたたかい|スープ|めん|カレー|丼|定食|中華|焼き目|揚げ物/.test(tagText)
      ? '<path d="M322 180c-34 42 30 54-5 96" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" opacity=".55"/><path d="M392 158c-38 48 36 58-8 112" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity=".62"/><path d="M472 184c-30 38 26 50-4 92" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" opacity=".48"/>'
      : '';

    function bowl(contents) {
      return `
        ${steam}
        <ellipse cx="400" cy="608" rx="245" ry="42" fill="#1e1713" opacity=".18"/>
        <ellipse cx="400" cy="414" rx="272" ry="176" fill="#fffaf4"/>
        <ellipse cx="400" cy="398" rx="226" ry="128" fill="#d4853a"/>
        ${contents}
        <path d="M172 438c34 146 112 226 228 226s194-80 228-226c-58 84-398 84-456 0z" fill="#f6efe4" stroke="#d9c9b5" stroke-width="10"/>
        <path d="M230 520c65 60 275 60 340 0" fill="none" stroke="#c9b69d" stroke-width="10" opacity=".75"/>
      `;
    }

    function plate(contents) {
      return `
        ${steam}
        <ellipse cx="400" cy="620" rx="260" ry="44" fill="#1e1713" opacity=".16"/>
        <ellipse cx="400" cy="438" rx="290" ry="204" fill="#fffdf8"/>
        <ellipse cx="400" cy="438" rx="222" ry="148" fill="#f1e5d4"/>
        ${contents}
        <ellipse cx="400" cy="438" rx="290" ry="204" fill="none" stroke="#ffffff" stroke-width="18" opacity=".8"/>
      `;
    }

    let dish = '';
    if (isRamen) {
      const soup = id.includes('miso') ? '#b86d32' : id.includes('tonkotsu') ? '#efe1bd' : '#8c4e29';
      dish = bowl(`
        <ellipse cx="400" cy="398" rx="208" ry="112" fill="${soup}"/>
        <path d="M238 402c74-48 228 42 330-18" fill="none" stroke="#f4ce58" stroke-width="18" stroke-linecap="round"/>
        <path d="M258 446c86-50 218 34 298-26" fill="none" stroke="#f7d96c" stroke-width="14" stroke-linecap="round"/>
        <circle cx="505" cy="358" r="42" fill="#f8e5b2"/><circle cx="515" cy="358" r="20" fill="#e69f32"/>
        <rect x="288" y="325" width="118" height="44" rx="20" fill="#cf805b" transform="rotate(-8 347 347)"/>
        <rect x="432" y="424" width="128" height="18" rx="9" fill="#31472a" transform="rotate(12 496 433)"/>
        <circle cx="312" cy="434" r="18" fill="#6ea84f"/><circle cx="352" cy="420" r="14" fill="#6ea84f"/>
      `);
    } else if (isCurry) {
      dish = plate(`
        <path d="M232 420c48-92 192-128 312-72 66 31 96 86 72 140-38 86-224 108-336 54-72-35-84-70-48-122z" fill="#a25a25"/>
        <path d="M244 404c90 4 160 36 196 106-66 40-170 34-226-14-38-34-30-72 30-92z" fill="#f8f0d8"/>
        <rect x="438" y="364" width="72" height="44" rx="12" fill="#d99a45"/>
        <rect x="510" y="430" width="58" height="38" rx="11" fill="#b67336"/>
        ${id.includes('katsu') ? '<path d="M262 354l170-34 18 48-164 52z" fill="#d49a42"/><path d="M282 350l130-26" stroke="#7b4a24" stroke-width="8"/>' : ''}
        ${id.includes('vegetable') ? '<circle cx="528" cy="388" r="22" fill="#5ca65c"/><circle cx="574" cy="480" r="18" fill="#db6a4b"/>' : ''}
      `);
    } else if (isDon) {
      dish = bowl(`
        <ellipse cx="400" cy="398" rx="210" ry="116" fill="#fff4dc"/>
        <path d="M246 396c70-78 160-72 214-18 40 40 94 28 116 76-72 54-238 66-330-8z" fill="#b76835"/>
        <path d="M310 358c54 20 94 54 126 102" fill="none" stroke="#f1d35d" stroke-width="24" opacity=".9"/>
        <path d="M274 438c92 24 176 20 266-12" fill="none" stroke="#63371f" stroke-width="18" opacity=".35"/>
        ${id.includes('katsu') ? '<path d="M282 342l188-28 18 46-184 48z" fill="#d99b3c"/>' : ''}
      `);
    } else if (isSushi) {
      dish = plate(`
        <rect x="248" y="342" width="104" height="68" rx="28" fill="#fff6e4" transform="rotate(-8 300 376)"/>
        <rect x="252" y="320" width="104" height="44" rx="20" fill="#d85742" transform="rotate(-8 304 342)"/>
        <rect x="374" y="334" width="104" height="68" rx="28" fill="#fff6e4" transform="rotate(5 426 368)"/>
        <rect x="378" y="312" width="104" height="44" rx="20" fill="#e8893c" transform="rotate(5 430 334)"/>
        <rect x="492" y="354" width="94" height="64" rx="28" fill="#fff6e4" transform="rotate(12 539 386)"/>
        <rect x="496" y="334" width="94" height="40" rx="18" fill="#efcc4d" transform="rotate(12 543 354)"/>
        ${id.includes('osechi') ? '<circle cx="314" cy="478" r="34" fill="#8fb66a"/><circle cx="404" cy="492" r="36" fill="#d85f54"/><circle cx="498" cy="478" r="34" fill="#d5a342"/>' : ''}
      `);
    } else if (isDrink) {
      const drink = id === 'water' ? '#bfe7ff' : id === 'tea' ? '#8fa95a' : id === 'orange_juice' ? '#f6a03a' : '#fff1d0';
      dish = `
        <ellipse cx="400" cy="640" rx="170" ry="34" fill="#1e1713" opacity=".15"/>
        <path d="M286 208h228l-34 390c-4 40-38 70-80 70s-76-30-80-70z" fill="#f9fbff" stroke="#d7e0e6" stroke-width="12"/>
        <path d="M314 370h172l-20 208c-4 26-28 46-66 46s-62-20-66-46z" fill="${drink}" opacity=".9"/>
        <ellipse cx="400" cy="370" rx="86" ry="22" fill="${drink}" opacity=".65"/>
        <path d="M336 246c38 18 86 20 128 2" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity=".75"/>
      `;
    } else if (isSweets) {
      dish = plate(`
        <path d="M300 510l88-168 138 38-28 144c-50 30-136 34-198-14z" fill="#f8d7b4"/>
        <path d="M318 384l76-72 130 38-132 56z" fill="#fff1f6"/>
        <path d="M392 406l132-56 2 54-136 58z" fill="#d97791"/>
        <circle cx="410" cy="334" r="18" fill="#d84848"/>
        ${id.includes('ice') ? '<circle cx="346" cy="376" r="58" fill="#f6e3c8"/><circle cx="438" cy="360" r="58" fill="#f7c0d0"/><path d="M330 430l142 0-70 138z" fill="#d69b50"/>' : ''}
        ${id.includes('pudding') ? '<ellipse cx="404" cy="476" rx="118" ry="58" fill="#e8b75b"/><path d="M304 450c28 58 176 58 204 0v80c-28 64-176 64-204 0z" fill="#f1ce75"/><ellipse cx="404" cy="448" rx="100" ry="36" fill="#8d4c27"/>' : ''}
      `);
    } else if (isBread) {
      dish = plate(`
        <path d="M250 450c26-92 114-142 204-118 82 22 126 86 108 156-46 76-220 98-312-38z" fill="#d89445"/>
        <path d="M278 424c74-42 174-34 252 28" fill="none" stroke="#fff0c8" stroke-width="22" opacity=".75"/>
        ${id.includes('onigiri') ? '<path d="M400 302l150 242H250z" fill="#fff8e9" stroke="#d8c8af" stroke-width="8"/><rect x="358" y="488" width="84" height="72" fill="#203924"/>' : ''}
        ${id.includes('pizza') ? '<path d="M264 514l296-190-84 248z" fill="#f0bd54"/><circle cx="418" cy="442" r="18" fill="#be3d2e"/><circle cx="478" cy="404" r="16" fill="#be3d2e"/>' : ''}
        ${id.includes('sandwich') ? '<path d="M270 390l260-72 24 138-248 82z" fill="#f3dfaa"/><path d="M294 430l242-68" stroke="#64a15f" stroke-width="24"/>' : ''}
      `);
    } else if (isPlate) {
      dish = plate(`
        <ellipse cx="380" cy="430" rx="126" ry="82" fill="#8b4b2c"/>
        <path d="M276 392c62-38 168-32 224 18" fill="none" stroke="#dca14d" stroke-width="18" opacity=".55"/>
        <circle cx="536" cy="408" r="42" fill="#78a957"/>
        <circle cx="552" cy="488" r="34" fill="#d85f4a"/>
        <path d="M244 512c82 40 204 40 306-6" fill="none" stroke="#f0d66a" stroke-width="24" stroke-linecap="round"/>
        ${id.includes('fish') ? '<path d="M280 410c90-86 214-74 284 10-86 82-210 82-284-10z" fill="#c79a69"/><circle cx="516" cy="402" r="8" fill="#1f1a16"/>' : ''}
        ${id.includes('tempura') || id.includes('chicken') || id.includes('harumaki') ? '<rect x="286" y="358" width="88" height="144" rx="28" fill="#d99a3c" transform="rotate(-18 330 430)"/><rect x="404" y="350" width="86" height="152" rx="28" fill="#d99a3c" transform="rotate(14 447 426)"/>' : ''}
      `);
    } else {
      dish = plate(`
        <ellipse cx="384" cy="426" rx="122" ry="78" fill="${color}"/>
        <circle cx="516" cy="414" r="42" fill="#7fb36c"/>
        <circle cx="548" cy="488" r="32" fill="#d8664d"/>
        <path d="M260 520c96 42 214 38 318-10" fill="none" stroke="#f4d36a" stroke-width="24" stroke-linecap="round"/>
      `);
    }

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fffaf0"/>
            <stop offset="1" stop-color="#ead7bd"/>
          </linearGradient>
          <radialGradient id="light" cx="38%" cy="22%" r="68%">
            <stop offset="0" stop-color="#ffffff" stop-opacity=".96"/>
            <stop offset=".55" stop-color="#fff7e8" stop-opacity=".58"/>
            <stop offset="1" stop-color="${color}" stop-opacity=".18"/>
          </radialGradient>
        </defs>
        <rect width="800" height="800" rx="120" fill="url(#bg)"/>
        <rect width="800" height="800" rx="120" fill="url(#light)"/>
        <path d="M98 642c130 86 476 86 604-10" fill="none" stroke="#fff" stroke-width="20" opacity=".24"/>
        ${dish}
        <text x="400" y="708" text-anchor="middle" font-size="46" font-family="Yu Gothic, Hiragino Sans, sans-serif" font-weight="800" fill="#3d2e1f">${label}</text>
      </svg>`;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  const rawItems = [
    ['shoyu_ramen', '醤油ラーメン', 'しょうゆらーめん', 'ramen', '🍜', ['あたたかい', 'めん', 'しょうゆ']],
    ['miso_ramen', '味噌ラーメン', 'みそらーめん', 'ramen', '🍜', ['あたたかい', 'みそ', 'こってり']],
    ['tonkotsu_ramen', '豚骨ラーメン', 'とんこつらーめん', 'ramen', '🍜', ['あたたかい', 'こってり', '白いスープ']],
    ['tsukemen', 'つけ麺', 'つけめん', 'ramen', '🍜', ['めん', 'つけだれ', 'しっかり']],

    ['gyudon', '牛丼', 'ぎゅうどん', 'don', '🍚', ['ごはん', '牛肉', '甘辛い']],
    ['oyakodon', '親子丼', 'おやこどん', 'don', '🍚', ['ごはん', 'たまご', 'やさしい']],
    ['katsudon', 'カツ丼', 'かつどん', 'don', '🍚', ['ごはん', 'カツ', 'しっかり']],

    ['beef_curry', 'カレーライス', 'かれーらいす', 'curry', '🍛', ['ごはん', 'カレー', '人気']],
    ['katsu_curry', 'カツカレー', 'かつかれー', 'curry', '🍛', ['カツ', 'カレー', '満足感']],
    ['vegetable_curry', '野菜カレー', 'やさいかれー', 'curry', '🍛', ['野菜', 'カレー', '彩り']],

    ['sushi', 'お寿司', 'おすし', 'japanese', '🍣', ['特別感', '和食', '冷たい']],
    ['grilled_fish', '焼き魚', 'やきざかな', 'japanese', '🐟', ['和食', '魚', 'あっさり']],
    ['tempura', '天ぷら', 'てんぷら', 'japanese', '🍤', ['揚げ物', '和食', 'サクサク']],
    ['udon', 'うどん', 'うどん', 'japanese', '🍜', ['めん', 'やさしい', 'あたたかい']],

    ['hamburg_steak', 'ハンバーグ', 'はんばーぐ', 'family', '🍽️', ['肉', 'やわらかい', '人気']],
    ['omurice', 'オムライス', 'おむらいす', 'family', '🍳', ['たまご', 'ごはん', '洋食']],
    ['fried_chicken_plate', '唐揚げ定食', 'からあげていしょく', 'family', '🍗', ['揚げ物', '定食', 'しっかり']],
    ['kids_plate', 'お子様ランチ', 'おこさまらんち', 'family', '🚩', ['楽しい', '少しずつ', '彩り']],

    ['spaghetti', 'スパゲティ', 'すぱげてぃ', 'western', '🍝', ['めん', '洋食', 'トマト']],
    ['gratin', 'グラタン', 'ぐらたん', 'western', '🧀', ['あたたかい', 'チーズ', 'やわらかい']],
    ['stew', 'シチュー', 'しちゅー', 'western', '🥣', ['あたたかい', 'やさしい', '白い']],

    ['hamburger', 'ハンバーガー', 'はんばーがー', 'fastfood', '🍔', ['手で持てる', 'パン', '肉']],
    ['pizza', 'ピザ', 'ぴざ', 'fastfood', '🍕', ['チーズ', '分けやすい', '楽しい']],
    ['fried_potato', 'フライドポテト', 'ふらいどぽてと', 'fastfood', '🍟', ['サクサク', 'つまみやすい', '軽い']],

    ['sandwich', 'サンドイッチ', 'さんどいっち', 'light', '🥪', ['パン', '軽食', '手で持てる']],
    ['soup', 'スープ', 'すーぷ', 'light', '🥣', ['あたたかい', 'やさしい', '飲みやすい']],
    ['salad', 'サラダ', 'さらだ', 'light', '🥗', ['野菜', 'さっぱり', '冷たい']],

    ['pudding', 'プリン', 'ぷりん', 'sweets', '🍮', ['甘い', 'やわらかい', 'おやつ']],
    ['cake', 'ケーキ', 'けーき', 'sweets', '🍰', ['甘い', '特別感', 'お祝い']],
    ['ice_cream', 'アイスクリーム', 'あいすくりーむ', 'sweets', '🍨', ['冷たい', '甘い', 'なめらか']],
    ['fruit_jelly', 'フルーツゼリー', 'ふるーつぜりー', 'sweets', '🍧', ['冷たい', '果物', 'つるん']],

    ['tea', 'お茶', 'おちゃ', 'drink', '🍵', ['飲み物', 'さっぱり', '食事中']],
    ['water', '水', 'みず', 'drink', '💧', ['水分', '休憩', '食事前後']],
    ['orange_juice', 'オレンジジュース', 'おれんじじゅーす', 'drink', '🧃', ['甘い', '果物', '冷たい']],
    ['milk', '牛乳', 'ぎゅうにゅう', 'drink', '🥛', ['飲み物', 'カルシウム', '冷たい']],

    ['onigiri', 'おにぎり', 'おにぎり', 'ricebread', '🍙', ['ごはん', '手で持てる', '食べやすい']],
    ['bread_roll', 'ロールパン', 'ろーるぱん', 'ricebread', '🥐', ['パン', 'やわらかい', '軽い']],
    ['toast', 'トースト', 'とーすと', 'ricebread', '🍞', ['パン', '朝食', '香ばしい']],

    ['gyoza', '餃子', 'ぎょうざ', 'chinese', '🥟', ['中華', '焼き目', '人気']],
    ['fried_rice', 'チャーハン', 'ちゃーはん', 'chinese', '🍚', ['ごはん', '中華', '香ばしい']],
    ['mapo_tofu', '麻婆豆腐', 'まーぼーどうふ', 'chinese', '🥘', ['豆腐', '中華', 'とろみ']],
    ['harumaki', '春巻き', 'はるまき', 'chinese', '🥠', ['サクサク', '中華', '揚げ物']],

    ['osechi', 'おせち料理', 'おせちりょうり', 'event', '🎍', ['正月', '特別', '華やか']],
    ['chirashi_sushi', 'ちらし寿司', 'ちらしずし', 'event', '🍣', ['行事', '彩り', '華やか']],
    ['ehomaki', '恵方巻き', 'えほうまき', 'event', '🍙', ['節分', '巻き寿司', '行事']],
    ['toshikoshi_soba', '年越しそば', 'としこしそば', 'event', '🍜', ['大晦日', 'そば', 'あたたかい']],

    ['facility_breakfast', '朝ごはん', 'あさごはん', 'facility', '🌅', ['朝食', 'やさしい', '定番']],
    ['facility_lunch', '昼ごはん', 'ひるごはん', 'facility', '🍱', ['昼食', 'バランス', '定食']],
    ['facility_snack_fruit', 'フルーツおやつ', 'ふるーつおやつ', 'facility', '🍎', ['おやつ', '果物', 'さっぱり']],
    ['facility_snack_yogurt', 'ヨーグルト', 'よーぐると', 'facility', '🥣', ['おやつ', 'やわらかい', '冷たい']]
  ];

  window.MENU_CATEGORIES = categories.map(([id, label, emoji, color]) => ({ id, label, emoji, color }));
  window.MENU_ITEMS = rawItems.map(([id, name, reading, category, emoji, tags]) => {
    const realModel = window.REAL_MODEL_FILES && window.REAL_MODEL_FILES[id];
    const item = {
      id,
      name,
      reading,
      romaji: id.replace(/_/g, ' '),
      category,
      categoryLabel: categoryById[category].label,
      emoji,
      color: categoryById[category].color,
      modelUrl: realModel ? realModel.url : '',
      modelScale: realModel ? realModel.scale : '',
      modelRotation: realModel ? realModel.rotation : '',
      modelPosition: realModel ? realModel.position : '',
      tags
    };
    item.image = (window.PHOTO_IMAGES && window.PHOTO_IMAGES[id]) || photoImages[id] || svgFood(item);
    item.generatedImage = svgFood(item);
    item.photoImage = (window.PHOTO_IMAGES && window.PHOTO_IMAGES[id]) || photoImages[id] || '';
    return item;
  });
})();
