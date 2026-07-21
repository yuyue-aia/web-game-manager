// 页面壳：登录守卫 + 顶栏 + 侧导航
// 各页面统一入口：App.boot({ need, activeNavKey }).then(function ({me, content}) { ... })
//   need: 'admin' | 'member' | 'guest' | 'any'
//     - 'admin'  仅管理员，其它角色跳到 /player.html
//     - 'member' 仅成员/测试，管理员跳到 /admin/dashboard.html
//     - 'guest'  仅未登录页（login.html）；已登录直接按角色跳走
//     - 'any'    只要求已登录
//   activeNavKey: 'status'|'config'|'devices'|'users'|'play'|null （null 表示不渲染侧导航）
(function () {
  'use strict';
  var App = window.App = window.App || {};

  var ADMIN_HOME = '/admin/dashboard.html';
  var PLAYER_HOME = '/player.html';
  var LOGIN_URL = '/login.html';

  var ADMIN_ROUTES = [
    { k: 'status',  href: '/admin/dashboard.html', label: '运行状态' },
    { k: 'config',  href: '/admin/config.html',    label: '游戏管理' },
    { k: 'devices', href: '/admin/devices.html',   label: '联网管理' },
    { k: 'users',   href: '/admin/users.html',     label: '账号管理' }
  ];
  var PLAYER_ROUTES = [
    { k: 'play', href: '/player.html', label: '游戏' }
  ];

  function homeForRole(role) { return role === 'admin' ? ADMIN_HOME : PLAYER_HOME; }

  function replaceLocation(url) { location.replace(url); }

  function boot(opts) {
    opts = opts || {};
    var need = opts.need || 'any';
    var activeNavKey = opts.activeNavKey || null;

    return App.api('/auth/me').then(function (d) {
      var me = d.user;
      var needsBootstrap = !!d.needsBootstrap;

      if (need === 'guest') {
        if (me) { replaceLocation(homeForRole(me.role)); return { skip: true }; }
        return { me: null, needsBootstrap: needsBootstrap, content: null };
      }
      if (!me) { replaceLocation(LOGIN_URL); return { skip: true }; }
      if (need === 'admin' && me.role !== 'admin') { replaceLocation(PLAYER_HOME); return { skip: true }; }
      if (need === 'member' && me.role === 'admin') { replaceLocation(ADMIN_HOME); return { skip: true }; }

      var content = mountShell(me, activeNavKey);
      return { me: me, content: content, needsBootstrap: needsBootstrap };
    }).catch(function (err) {
      var root = document.getElementById('root');
      App.clear(root);
      root.appendChild(App.el('div', { class: 'center-screen' },
        App.el('p', { class: 'muted', style: { textAlign: 'center' } },
          '无法连接服务，请刷新重试' + (err && err.message ? '（' + err.message + '）' : ''))));
      return { skip: true };
    });
  }

  /** 渲染顶栏 + 侧导航（activeNavKey 为 null 时不渲染侧导航），返回内容容器。 */
  function mountShell(me, activeNavKey) {
    var el = App.el;
    var root = document.getElementById('root');
    App.clear(root);

    var isAdmin = me.role === 'admin';

    // ---- 顶部账户栏 ----
    var logoutBtn = el('button', { class: 'btn ghost sm', onclick: function () {
      App.api('/auth/logout', { method: 'POST', body: {} }).catch(function () {}).then(function () {
        replaceLocation(LOGIN_URL);
      });
    } }, '退出');
    var profBtn = el('button', { class: 'btn ghost sm', onclick: function () {
      App.openEditProfile(me, '/auth/profile', function (updated) {
        // 资料变更后简单刷新页面，让顶栏 emoji 与后续页面数据一致
        if (updated) location.reload();
      });
    } }, App.avEmoji(me.avatar) + ' 资料');
    var pwdBtn = el('button', { class: 'btn ghost sm', onclick: App.openChangePassword }, '改密');

    root.appendChild(el('div', { class: 'brand' },
      el('span', { class: 'dot' }), el('h1', {}, '游戏管家'),
      el('span', { class: 'who' }, me.displayName, profBtn, pwdBtn, logoutBtn)));

    // ---- 侧导航（可选） + 内容区 ----
    var content = el('div', { class: 'content' });
    if (activeNavKey) {
      var routes = isAdmin ? ADMIN_ROUTES : PLAYER_ROUTES;
      var sidenav = el('nav', { class: 'sidenav' });
      routes.forEach(function (r) {
        sidenav.appendChild(el('a', {
          href: r.href,
          class: r.k === activeNavKey ? 'active' : ''
        }, r.label));
      });
      root.appendChild(el('div', { class: 'layout' }, sidenav, content));
    } else {
      root.appendChild(content);
    }
    return content;
  }

  App.boot = boot;
  App.mountShell = mountShell;
  App.homeForRole = homeForRole;
})();
