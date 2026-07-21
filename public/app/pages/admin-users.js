// 管理员：账号管理
(function () {
  'use strict';

  App.boot({ need: 'admin', activeNavKey: 'users' }).then(function (ctx) {
    if (ctx.skip) return;
    run(ctx.content, ctx.me);
  });

  function run(container, me) {
    var el = App.el, clear = App.clear, api = App.api, toast = App.toast;

    var box = el('div');
    container.appendChild(box);

    function load() {
      api('/users').then(function (d) { renderList(d.users); }).catch(function (e) {
        clear(box); box.appendChild(el('div', { class: 'err' }, e.message));
      });
    }

    function renderList(users) {
      clear(box);
      var list = el('div', { class: 'card' });
      users.forEach(function (u) {
        var right = [el('span', { class: 'tag ' + u.role }, u.role === 'admin' ? '管理员' : '成员')];
        var editBtn = el('button', { class: 'btn ghost sm' }, '资料');
        editBtn.onclick = function () { App.openEditProfile(u, '/users/' + u.id + '/profile', function () { load(); }); };
        var pwdBtn = el('button', { class: 'btn ghost sm' }, '改密');
        pwdBtn.onclick = function () { App.openAdminSetPassword(u); };
        var roleBtn = el('button', { class: 'btn ghost sm' }, u.role === 'admin' ? '降为成员' : '设为管理员');
        roleBtn.onclick = function () {
          api('/users/' + u.id + '/role', { method: 'PUT', body: { role: u.role === 'admin' ? 'member' : 'admin' } })
            .then(load).catch(function (e) { toast(e.message); });
        };
        right.push(editBtn, pwdBtn, roleBtn);
        if (u.id !== me.id) {
          var delBtn = el('button', { class: 'btn ghost sm' }, '删除');
          delBtn.onclick = function () {
            if (!confirm('删除账号 ' + u.displayName + '？')) return;
            api('/users/' + u.id, { method: 'DELETE' }).then(load).catch(function (e) { toast(e.message); });
          };
          right.push(delBtn);
        }
        list.appendChild(el('div', { class: 'row' },
          el('div', { class: 'player-hero-av', style: { background: App.avColor(u.avatar), width: '40px', height: '40px', fontSize: '22px', borderRadius: '12px' } }, App.avEmoji(u.avatar)),
          el('div', { class: 'grow' },
            el('div', { class: 'uname' }, u.displayName + (u.id === me.id ? ' · 我' : '')),
            el('div', { class: 'muted' }, '登录名 ' + u.username + ' · ' + (u.lastLoginAt ? '上次登录 ' + new Date(u.lastLoginAt).toLocaleString('zh-CN') : '从未登录'))),
          right));
      });
      box.appendChild(list);

      var errBox = el('div');
      var uInput = el('input', { placeholder: '3~32 位，字母数字' });
      var nameInput = el('input', { placeholder: '玩家昵称，1~24 字' });
      var pInput = el('input', { type: 'password', placeholder: '至少 6 位' });
      var roleSel = el('select', {});
      roleSel.appendChild(el('option', { value: 'member' }, '成员（可开关游戏）'));
      roleSel.appendChild(el('option', { value: 'admin' }, '管理员（可改配置/管账号）'));
      roleSel.appendChild(el('option', { value: 'test' }, '测试（不操作插线板）'));
      var picker = App.makeAvatarPicker('star');
      var addBtn = el('button', { class: 'btn' }, '添加账号');
      addBtn.onclick = function () {
        clear(errBox);
        addBtn.disabled = true; addBtn.textContent = '添加中…';
        api('/users', { method: 'POST', body: {
          username: uInput.value, password: pInput.value, role: roleSel.value,
          displayName: nameInput.value, avatar: picker.get()
        } })
          .then(function () { toast('已添加账号'); load(); })
          .catch(function (e) {
            errBox.appendChild(el('div', { class: 'err' }, e.message));
            addBtn.disabled = false; addBtn.textContent = '添加账号';
          });
      };
      box.appendChild(el('div', { class: 'section-title' }, '添加账号'));
      box.appendChild(el('div', { class: 'card stack' },
        errBox,
        el('label', { class: 'field' }, '登录用户名', uInput),
        el('label', { class: 'field' }, '玩家昵称', nameInput),
        el('label', { class: 'field' }, '初始密码', pInput),
        el('label', { class: 'field' }, '角色', roleSel),
        el('div', {}, el('div', { class: 'field', style: { marginBottom: '8px' } }, '头像 logo', picker.node)),
        addBtn
      ));
    }

    load();
  }
})();
