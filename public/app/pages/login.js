// 登录 / 首次 bootstrap 页
(function () {
  'use strict';

  App.boot({ need: 'guest' }).then(function (ctx) {
    if (ctx.skip) return;
    render(ctx.needsBootstrap);
  });

  function render(needsBootstrap) {
    var el = App.el, clear = App.clear, api = App.api;
    var root = document.getElementById('root');
    clear(root);

    var boot = !!needsBootstrap;
    var errBox = el('div');
    var uInput = el('input', { autocomplete: 'username', placeholder: '3~32 位，字母数字' });
    var pInput = el('input', { type: 'password', autocomplete: boot ? 'new-password' : 'current-password', placeholder: '至少 6 位' });
    var btn = el('button', { class: 'btn lg' }, boot ? '创建并登录' : '登 录');

    function submit(e) {
      e.preventDefault();
      clear(errBox);
      btn.disabled = true; btn.textContent = '请稍候…';
      api(boot ? '/auth/bootstrap' : '/auth/login',
          { method: 'POST', body: { username: uInput.value, password: pInput.value } })
        .then(function (data) {
          location.replace(App.homeForRole(data.user && data.user.role));
        })
        .catch(function (err) {
          errBox.appendChild(el('div', { class: 'err' }, err.message));
          btn.disabled = false; btn.textContent = boot ? '创建并登录' : '登 录';
        });
    }

    var form = el('form', { class: 'card stack', onsubmit: submit },
      errBox,
      el('label', { class: 'field' }, '用户名', uInput),
      el('label', { class: 'field' }, '密码', pInput),
      btn
    );

    root.appendChild(el('div', { class: 'center-screen' },
      el('div', { class: 'brand', style: { justifyContent: 'center', marginBottom: '6px' } },
        el('span', { class: 'dot' }), el('h1', {}, '游戏管家')),
      boot ? el('p', { class: 'muted', style: { textAlign: 'center', margin: '0 0 20px' } }, '首次使用，创建管理员账号') : null,
      form
    ));
  }
})();
