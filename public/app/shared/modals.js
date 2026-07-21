// 通用弹窗：改密 / 改资料 / 管理员改他人密码 / 管理员改玩家今日总时间
(function () {
  'use strict';
  var App = window.App = window.App || {};

  function openChangePassword() {
    var el = App.el, clear = App.clear, api = App.api, toast = App.toast;
    var errBox = el('div');
    var oldP = el('input', { type: 'password', autocomplete: 'current-password', placeholder: '当前密码' });
    var newP = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '至少 6 位' });
    var confP = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '再输一次新密码' });
    var saveBtn = el('button', { class: 'btn' }, '保存新密码');

    var mask = el('div', { class: 'modal-mask' });
    function close() { mask.remove(); }
    mask.onclick = function (e) { if (e.target === mask) close(); };

    saveBtn.onclick = function () {
      clear(errBox);
      if (newP.value !== confP.value) { errBox.appendChild(el('div', { class: 'err' }, '两次输入的新密码不一致')); return; }
      saveBtn.disabled = true; saveBtn.textContent = '保存中…';
      api('/auth/change-password', { method: 'POST', body: { oldPassword: oldP.value, newPassword: newP.value } })
        .then(function () { close(); toast('密码已修改'); })
        .catch(function (e) {
          errBox.appendChild(el('div', { class: 'err' }, e.message));
          saveBtn.disabled = false; saveBtn.textContent = '保存新密码';
        });
    };

    var card = el('div', { class: 'card stack modal-card' },
      el('div', { class: 'modal-head' }, el('h3', {}, '修改密码'),
        el('button', { class: 'x', onclick: close }, '×')),
      errBox,
      el('label', { class: 'field' }, '当前密码', oldP),
      el('label', { class: 'field' }, '新密码', newP),
      el('label', { class: 'field' }, '确认新密码', confP),
      saveBtn);
    mask.appendChild(card);
    document.body.appendChild(mask);
    oldP.focus();
  }

  function openEditProfile(user, endpoint, onSaved) {
    var el = App.el, clear = App.clear, api = App.api, toast = App.toast;
    var errBox = el('div');
    var nameInput = el('input', { value: user.displayName, placeholder: '玩家昵称，1~24 字' });
    var picker = App.makeAvatarPicker(user.avatar);
    var saveBtn = el('button', { class: 'btn' }, '保存');
    var mask = el('div', { class: 'modal-mask' });
    function close() { mask.remove(); }
    mask.onclick = function (e) { if (e.target === mask) close(); };
    saveBtn.onclick = function () {
      clear(errBox);
      saveBtn.disabled = true; saveBtn.textContent = '保存中…';
      api(endpoint, { method: 'PUT', body: { displayName: nameInput.value, avatar: picker.get() } })
        .then(function (d) { close(); toast('资料已更新'); onSaved && onSaved(d && d.user); })
        .catch(function (e) {
          errBox.appendChild(el('div', { class: 'err' }, e.message));
          saveBtn.disabled = false; saveBtn.textContent = '保存';
        });
    };
    var card = el('div', { class: 'card stack modal-card' },
      el('div', { class: 'modal-head' }, el('h3', {}, '编辑资料'), el('button', { class: 'x', onclick: close }, '×')),
      errBox,
      el('label', { class: 'field' }, '玩家昵称', nameInput),
      el('div', {}, el('div', { class: 'field', style: { marginBottom: '8px' } }, '选择头像'), picker.node),
      saveBtn);
    mask.appendChild(card);
    document.body.appendChild(mask);
    nameInput.focus();
  }

  function openAdminSetPassword(user) {
    var el = App.el, clear = App.clear, api = App.api, toast = App.toast;
    var errBox = el('div');
    var p1 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '至少 6 位' });
    var p2 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '再输一次' });
    var saveBtn = el('button', { class: 'btn' }, '保存新密码');
    var mask = el('div', { class: 'modal-mask' });
    function close() { mask.remove(); }
    mask.onclick = function (e) { if (e.target === mask) close(); };
    saveBtn.onclick = function () {
      clear(errBox);
      if (p1.value !== p2.value) { errBox.appendChild(el('div', { class: 'err' }, '两次输入的密码不一致')); return; }
      saveBtn.disabled = true; saveBtn.textContent = '保存中…';
      api('/users/' + user.id + '/password', { method: 'PUT', body: { password: p1.value } })
        .then(function () { close(); toast('密码已更新'); })
        .catch(function (e) {
          errBox.appendChild(el('div', { class: 'err' }, e.message));
          saveBtn.disabled = false; saveBtn.textContent = '保存新密码';
        });
    };
    var card = el('div', { class: 'card stack modal-card' },
      el('div', { class: 'modal-head' }, el('h3', {}, '设置密码'), el('button', { class: 'x', onclick: close }, '×')),
      el('p', { class: 'muted', style: { margin: '0' } }, '为 ' + user.displayName + '（' + user.username + '）设置新密码'),
      errBox,
      el('label', { class: 'field' }, '新密码', p1),
      el('label', { class: 'field' }, '确认新密码', p2),
      saveBtn);
    mask.appendChild(card);
    document.body.appendChild(mask);
    p1.focus();
  }

  function openSetTime(player, onDone) {
    var el = App.el, clear = App.clear, api = App.api, toast = App.toast;
    var errBox = el('div');
    var cur = Math.max(0, Math.round((Number(player.dailyQuotaMin) || 0) + (Number(player.bonusMinutes) || 0)));
    var input = el('input', { type: 'number', min: '0', max: '1440', value: cur });
    var quick = el('div', { class: 'mins' });
    [0, 30, 60, 90].forEach(function (m) {
      var b = el('button', { type: 'button' }, '+' + String(m));
      b.onclick = function () {
        var current = Math.max(0, Math.round(Number(input.value) || 0));
        input.value = String(Math.min(1440, current + m));
      };
      quick.appendChild(b);
    });
    var saveBtn = el('button', { class: 'btn' }, '确认修改');
    var mask = el('div', { class: 'modal-mask' });
    function close() { mask.remove(); }
    mask.onclick = function (e) { if (e.target === mask) close(); };
    saveBtn.onclick = function () {
      clear(errBox);
      var m = Math.round(Number(input.value));
      if (!Number.isFinite(m) || m < 0 || m > 1440) {
        errBox.appendChild(el('div', { class: 'err' }, '请输入 0~1440 之间的分钟数')); return;
      }
      saveBtn.disabled = true; saveBtn.textContent = '处理中…';
      api('/users/' + player.child + '/quota', { method: 'POST', body: { totalMinutes: m } })
        .then(function (d) {
          close();
          toast('已将 ' + player.label + ' 今日总时间设为 ' + d.totalMinutes + ' 分钟 · 剩余 ' + d.remainingMinutes);
          onDone && onDone();
        })
        .catch(function (e) {
          errBox.appendChild(el('div', { class: 'err' }, e.message));
          saveBtn.disabled = false; saveBtn.textContent = '确认修改';
        });
    };
    var card = el('div', { class: 'card stack modal-card' },
      el('div', { class: 'modal-head' }, el('h3', {}, '修改时间'), el('button', { class: 'x', onclick: close }, '×')),
      el('p', { class: 'muted', style: { margin: '0' } }, '直接设定 ' + player.label + ' 今日总时间（已用时间不变，仅当天有效，次日重置）'),
      errBox,
      el('div', { class: 'field', style: { margin: '2px 0 8px' } }, '快捷增加（分钟）'),
      quick,
      el('label', { class: 'field' }, '今日总时间（分钟）', input),
      saveBtn);
    mask.appendChild(card);
    document.body.appendChild(mask);
    input.focus();
  }

  App.openChangePassword = openChangePassword;
  App.openEditProfile = openEditProfile;
  App.openAdminSetPassword = openAdminSetPassword;
  App.openSetTime = openSetTime;
})();
