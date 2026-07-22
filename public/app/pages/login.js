// 登录 / 首次 bootstrap 页
(function () {
  'use strict';

  // ---------- 背景特效：版本管理 ----------
  // 每个版本是一个模块路径，模块导出：
  //   mount / unmount / pulse / flashError / focusBoost
  //   renderForm({container, boot}) —— 版本专属登录框，返回 {form,uInput,pInput,btn,errBox,setBusy,showError,clearError}
  var FX_VERSIONS = [
    { key: 'v1', label: 'V1 · 便携机', path: '/pages/login-fx.js' },
    { key: 'v2', label: 'V2 · 终端', path: '/pages/login-fx-v2.js' },
    { key: 'v3', label: 'V3 · 黑洞', path: '/pages/login-fx-v3.js' },
  ];
  var FX_STORAGE_KEY = 'login.fx.version';
  var fx = null;
  var currentVersionKey = null;
  var bootFlag = false;

  function readSavedVersion() {
    try {
      var v = localStorage.getItem(FX_STORAGE_KEY);
      if (v && FX_VERSIONS.some(function (x) { return x.key === v; })) return v;
    } catch (e) {}
    return FX_VERSIONS[0].key;
  }
  function writeSavedVersion(k) {
    try { localStorage.setItem(FX_STORAGE_KEY, k); } catch (e) {}
  }

  /** 捕获当前输入框中的用户名/密码，用于版本切换后恢复 */
  function snapshotInputs() {
    var root = document.getElementById('root');
    var inputs = root ? root.querySelectorAll('input') : [];
    return {
      u: inputs[0] ? inputs[0].value : '',
      p: inputs[1] ? inputs[1].value : '',
    };
  }

  /** 卸载旧版 fx（GL + form + body class） */
  function unloadFx() {
    if (fx && fx.unmount) { try { fx.unmount(); } catch (e) {} }
    fx = null;
  }

  /** 加载并挂载指定版本：切换背景 + 用该版本的 renderForm 重建表单 */
  function loadFx(key) {
    if (currentVersionKey === key && fx) return Promise.resolve(fx);
    var snapshot = snapshotInputs();
    unloadFx();
    var target = FX_VERSIONS.find(function (v) { return v.key === key; }) || FX_VERSIONS[0];
    currentVersionKey = target.key;
    writeSavedVersion(target.key);
    return import(target.path).then(function (mod) {
      fx = mod;
      try { fx.mount(); } catch (e) { console.warn('fx mount failed', e); }
      renderShellAndForm(snapshot);
      return fx;
    }).catch(function (e) {
      console.warn('fx import failed', e);
      fx = null;
    });
  }

  App.boot({ need: 'guest' }).then(function (ctx) {
    if (ctx.skip) return;
    bootFlag = !!ctx.needsBootstrap;
    // 先渲染一个空 shell 占位（品牌 + 内容区），等 fx 加载后填充表单
    var root = document.getElementById('root');
    App.clear(root);
    root.appendChild(App.el('div', { class: 'center-screen' },
      App.el('div', { class: 'brand', style: { justifyContent: 'center', marginBottom: '10px' } },
        App.el('span', { class: 'dot' }), App.el('h1', {}, '游戏管家')),
      bootFlag ? App.el('p', { class: 'muted', style: { textAlign: 'center', margin: '0 0 20px' } }, '首次使用，创建管理员账号') : null,
      App.el('div', { id: 'fx-form-host' })));
    loadFx(readSavedVersion());
    mountVersionSwitcher();
  });

  /** 让当前 fx 用自己的样式重建 form；输入恢复上次 snapshot */
  function renderShellAndForm(snapshot) {
    var host = document.getElementById('fx-form-host');
    if (!host || !fx || !fx.renderForm) return;
    var handle = fx.renderForm({ container: host, boot: bootFlag });
    if (!handle) return;
    if (snapshot) {
      if (handle.uInput) handle.uInput.value = snapshot.u || '';
      if (handle.pInput) handle.pInput.value = snapshot.p || '';
    }
    if (handle.uInput) handle.uInput.addEventListener('focus', function () {
      fx && fx.focusBoost && fx.focusBoost();
    });
    if (handle.pInput) handle.pInput.addEventListener('focus', function () {
      fx && fx.focusBoost && fx.focusBoost();
    });
    handle.form.addEventListener('submit', function (e) {
      e.preventDefault();
      handle.clearError();
      handle.setBusy(true);
      fx && fx.pulse && fx.pulse();
      App.api(bootFlag ? '/auth/bootstrap' : '/auth/login', {
        method: 'POST',
        body: { username: handle.uInput.value, password: handle.pInput.value },
      }).then(function (data) {
        unloadFx();
        location.replace(App.homeForRole(data.user && data.user.role));
      }).catch(function (err) {
        fx && fx.flashError && fx.flashError();
        handle.showError(err.message || '登录失败');
        handle.setBusy(false);
      });
    });
  }

  /** 右下角版本切换器 */
  function mountVersionSwitcher() {
    if (document.getElementById('login-fx-switcher')) return;
    var wrap = App.el('div', { id: 'login-fx-switcher' });
    Object.assign(wrap.style, {
      position: 'fixed', right: '14px', bottom: '14px', zIndex: '3',
      display: 'flex', gap: '6px', padding: '6px',
      background: 'rgba(10, 15, 44, 0.55)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '999px',
      backdropFilter: 'blur(12px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(12px) saturate(1.4)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
      fontSize: '12.5px', fontWeight: '700',
      color: '#e8ecff',
      pointerEvents: 'auto',
    });
    FX_VERSIONS.forEach(function (v) {
      var b = App.el('button', {
        onclick: function () { loadFx(v.key).then(refresh); },
      }, v.label);
      Object.assign(b.style, {
        padding: '6px 12px', borderRadius: '999px',
        border: '1px solid transparent',
        background: 'transparent', color: 'inherit',
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit',
        transition: 'background .15s, color .15s, border-color .15s',
        letterSpacing: '.4px',
      });
      b.dataset.key = v.key;
      wrap.appendChild(b);
    });
    function refresh() {
      var current = currentVersionKey || readSavedVersion();
      Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (b) {
        var on = b.dataset.key === current;
        b.style.background = on ? 'linear-gradient(120deg, #ff1e9b, #00e6ff)' : 'transparent';
        b.style.color = on ? '#fff' : '#e8ecff';
        b.style.borderColor = on ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)';
        b.style.boxShadow = on ? '0 0 18px rgba(0,230,255,0.35)' : 'none';
      });
    }
    document.body.appendChild(wrap);
    refresh();
    var t = setInterval(function () { if (currentVersionKey) { refresh(); clearInterval(t); } }, 100);
  }
})();
