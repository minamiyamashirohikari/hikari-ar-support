// ============================================================
// error_guard.js - 全HTMLで共通のクラッシュ防止ガード
// ============================================================
// 目的：
// - 予期しないJSエラーで画面が真っ白になるのを防ぐ
// - ユーザーに何が起きたかをやさしく伝える
// - localStorage/画像/ライブラリ失敗に対応する
// ============================================================

(function() {
  'use strict';

  // ============================================================
  // 1. グローバルエラーハンドラ
  // ============================================================
  let errorCount = 0;
  const MAX_ERROR_SHOWN = 1; // 同時に出すエラー通知は1つまで

  function showGracefulError(msg, detail) {
    errorCount++;
    if (errorCount > MAX_ERROR_SHOWN) return; // うるさくしない

    console.error('[ErrorGuard]', msg, detail);

    // 既にエラーパネルがあれば出さない
    if (document.getElementById('__errorGuardPanel')) return;

    try {
      const panel = document.createElement('div');
      panel.id = '__errorGuardPanel';
      panel.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        left: 20px;
        max-width: 440px;
        margin: 0 auto;
        background: #FFF0E0;
        border: 2px solid #E8A53F;
        border-radius: 14px;
        padding: 14px 18px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.2);
        z-index: 99999;
        font-family: 'Zen Maru Gothic', -apple-system, sans-serif;
        color: #8B5A2B;
        font-size: 13px;
        line-height: 1.6;
        animation: errGuardSlide 0.3s ease-out;
      `;
      panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <span style="font-size:20px;">⚠️</span>
          <b style="color:#C85A2B;font-size:14px;">ちょっとした問題が発生しました</b>
        </div>
        <div style="font-size:12px;color:#5D4E3C;margin-bottom:8px;">
          ${msg || 'システム内部で予期しないエラーが起きました。'}<br>
          <small style="color:#8B7355;">基本的な機能はこのまま使えますが、再読み込みで改善することがあります。</small>
        </div>
        <div style="display:flex;gap:6px;">
          <button onclick="location.reload()" style="flex:1;background:#C85A2B;color:#fff;border:none;padding:8px 12px;border-radius:8px;font-family:inherit;font-weight:800;font-size:12px;cursor:pointer;">🔄 再読み込み</button>
          <button onclick="this.closest('#__errorGuardPanel').remove()" style="background:#F0E4D0;color:#8B5A2B;border:none;padding:8px 12px;border-radius:8px;font-family:inherit;font-weight:800;font-size:12px;cursor:pointer;">閉じる</button>
        </div>
      `;
      (document.body || document.documentElement).appendChild(panel);

      // スタイルアニメーション用
      if (!document.getElementById('__errorGuardStyle')) {
        const style = document.createElement('style');
        style.id = '__errorGuardStyle';
        style.textContent = `
          @keyframes errGuardSlide {
            from { transform: translateY(40px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `;
        document.head.appendChild(style);
      }
    } catch (e) {
      // 最終フォールバック: alertすら出さない（連鎖ダイアログ防止）
      console.error('[ErrorGuard] Failed to show error panel', e);
    }
  }

  // window.onerror
  window.addEventListener('error', function(e) {
    // リソース読み込みエラーは別処理で警告不要なものも多いので軽く処理
    if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
      console.warn('[ErrorGuard] Resource load failed:', e.target.src || e.target.href);
      return;
    }

    const msg = e.message || 'スクリプトエラー';
    const src = e.filename ? (e.filename.split('/').pop() + ':' + e.lineno) : '';
    showGracefulError('スクリプトエラー: ' + msg, src);
  }, true);

  // Unhandled promise rejection
  window.addEventListener('unhandledrejection', function(e) {
    const reason = e.reason;
    const msg = reason && reason.message ? reason.message : String(reason);
    console.error('[ErrorGuard] Unhandled promise:', msg);
    // Promise系エラーは通知しない（大抵はネットワーク由来で自己回復するため）
  });

  // ============================================================
  // 2. localStorage セーフラッパー
  // ============================================================
  window.safeStorage = {
    get: function(key, defaultValue) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? defaultValue : v;
      } catch (e) {
        console.warn('[ErrorGuard] localStorage.get failed:', key, e);
        return defaultValue;
      }
    },
    getJSON: function(key, defaultValue) {
      try {
        const v = localStorage.getItem(key);
        if (v === null) return defaultValue;
        return JSON.parse(v);
      } catch (e) {
        console.warn('[ErrorGuard] localStorage.getJSON failed:', key, e);
        // 破損してたら消す
        try { localStorage.removeItem(key); } catch(_){}
        return defaultValue;
      }
    },
    set: function(key, value) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e) {
        console.warn('[ErrorGuard] localStorage.set failed:', key, e);
        return false;
      }
    },
    setJSON: function(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn('[ErrorGuard] localStorage.setJSON failed:', key, e);
        return false;
      }
    },
    remove: function(key) {
      try { localStorage.removeItem(key); return true; }
      catch (e) { return false; }
    }
  };

  // ============================================================
  // 3. 画像ロード失敗のデフォルトフォールバック
  // ============================================================
  const DEFAULT_FOOD_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <rect width="200" height="200" fill="#F0E4D0"/>
      <text x="100" y="90" text-anchor="middle" font-family="sans-serif" font-size="48" fill="#C85A2B">🍽️</text>
      <text x="100" y="140" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#8B7355">画像なし</text>
    </svg>`
  );

  // 全画像に onerror を自動セット（後から追加された画像にも対応）
  const imageObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (!node.querySelectorAll) return;
        const imgs = node.tagName === 'IMG' ? [node] : node.querySelectorAll('img');
        imgs.forEach(function(img) {
          if (img.dataset.errorGuarded) return;
          img.dataset.errorGuarded = '1';
          img.addEventListener('error', function() {
            if (img.src !== DEFAULT_FOOD_IMG) {
              console.warn('[ErrorGuard] Image failed, using fallback:', img.src.substring(0, 80));
              img.src = DEFAULT_FOOD_IMG;
            }
          }, { once: false });
        });
      });
    });
  });

  // DOM Content Loaded 後に初期の画像もカバー
  function setupInitialImages() {
    document.querySelectorAll('img').forEach(function(img) {
      if (img.dataset.errorGuarded) return;
      img.dataset.errorGuarded = '1';
      img.addEventListener('error', function() {
        if (img.src !== DEFAULT_FOOD_IMG) {
          console.warn('[ErrorGuard] Image failed, using fallback');
          img.src = DEFAULT_FOOD_IMG;
        }
      });
    });

    // Body 出来てから observer を起動
    if (document.body) {
      imageObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupInitialImages);
  } else {
    setupInitialImages();
  }

  // ============================================================
  // 4. DOM要素セーフゲッター
  // ============================================================
  window.safeGetEl = function(id) {
    try {
      return document.getElementById(id);
    } catch (e) {
      return null;
    }
  };
  window.safeQuery = function(selector) {
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  };

  // ============================================================
  // 5. 復旧用ボタン（開発者向け）
  // ============================================================
  window.__resetProject = function() {
    if (confirm('プロジェクトの設定をすべてリセットしますか？\n（選択中のメニュー・カメラ設定・タブ状態が消えます）')) {
      try {
        const keys = ['senshakuSelectedIds', 'senshakuPanel',
                      'webar_camera_facing', 'webar_autostart', 'webar_lr_selection'];
        keys.forEach(k => { try { localStorage.removeItem(k); } catch(_){} });
        alert('リセットしました。ページを再読み込みします。');
        location.reload();
      } catch (e) {
        alert('リセット中にエラーが発生しました: ' + e.message);
      }
    }
  };

  console.log('[ErrorGuard] ✓ 読み込み完了・クラッシュ防止ガード有効');
})();
