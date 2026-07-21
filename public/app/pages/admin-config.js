// 管理员：游戏时间配置
(function () {
  'use strict';

  App.boot({ need: 'admin', activeNavKey: 'config' }).then(function (ctx) {
    if (ctx.skip) return;
    run(ctx.content);
  });

  function run(container) {
    var el = App.el, clear = App.clear, api = App.api, toast = App.toast;

    var gameBox = el('div');
    container.appendChild(gameBox);
    gameBox.appendChild(el('div', { class: 'card' }, el('p', { class: 'muted' }, '游戏配置加载中…')));

    api('/config').then(function (d) {
      var cfg = d.config, labels = d.weekdayLabels;
      clear(gameBox);
      var errBox = el('div');
      var daily = el('input', { type: 'number', min: '5', max: '1440', value: cfg.dailyQuotaMin });
      var minS = el('input', { type: 'number', min: '1', value: cfg.minSingleSessionMin });
      var maxS = el('input', { type: 'number', min: '1', value: cfg.maxSingleSessionMin });
      var reminders = el('input', { value: cfg.reminderSeconds.join(', ') });

      var selectedDays = cfg.allowedWeekdays.slice();
      var chipRow = el('div', { class: 'chip-row' });
      labels.forEach(function (lbl, d) {
        var chip = el('button', { class: 'chip' + (selectedDays.indexOf(d) >= 0 ? ' on' : '') }, lbl);
        chip.onclick = function () {
          var i = selectedDays.indexOf(d);
          if (i >= 0) selectedDays.splice(i, 1); else selectedDays.push(d);
          chip.className = 'chip' + (selectedDays.indexOf(d) >= 0 ? ' on' : '');
        };
        chipRow.appendChild(chip);
      });

      var btn = el('button', { class: 'btn' }, '保存游戏配置');
      btn.onclick = function () {
        clear(errBox);
        var payload = {
          dailyQuotaMin: Number(daily.value),
          allowedWeekdays: selectedDays.slice().sort(function (a, b) { return a - b; }),
          maxSingleSessionMin: Number(maxS.value),
          minSingleSessionMin: Number(minS.value),
          reminderSeconds: reminders.value.split(',').map(function (s) { return Number(s.trim()); }).filter(function (n) { return n > 0; })
        };
        btn.disabled = true; btn.textContent = '保存中…';
        api('/config', { method: 'PUT', body: { config: payload } })
          .then(function () { toast('游戏配置已保存并生效'); btn.disabled = false; btn.textContent = '保存游戏配置'; })
          .catch(function (e) {
            errBox.appendChild(el('div', { class: 'err' }, e.message));
            btn.disabled = false; btn.textContent = '保存游戏配置';
          });
      };

      gameBox.appendChild(el('div', { class: 'card stack' },
        el('h2', { style: { margin: '0', fontSize: '18px' } }, '游戏时间配置'),
        errBox,
        el('label', { class: 'field' }, '每日配额（分钟 / 每人）', daily),
        el('div', {}, el('div', { class: 'field', style: { marginBottom: '8px' } }, '允许玩的星期'), chipRow),
        el('div', { class: 'kid-row' },
          el('label', { class: 'field' }, '单次下限（分钟）', minS),
          el('label', { class: 'field' }, '单次上限（分钟）', maxS)),
        el('label', { class: 'field' }, '到期前提醒（秒，逗号分隔）', reminders),
        btn
      ));
    }).catch(function (e) {
      clear(gameBox); gameBox.appendChild(el('div', { class: 'err' }, e.message));
    });
  }
})();
