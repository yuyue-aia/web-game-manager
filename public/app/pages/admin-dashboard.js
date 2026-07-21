// 管理员运行状态页：玩家时间进度条列表 + 当前会话卡片 + 历史记录
(function () {
  'use strict';

  App.boot({ need: 'admin', activeNavKey: 'status' }).then(function (ctx) {
    if (ctx.skip) return;
    run(ctx.content);
  });

  function run(container) {
    var el = App.el, clear = App.clear, api = App.api, toast = App.toast;

    var wrap = el('div');
    container.appendChild(wrap);
    var pollTimer = null, tickTimer = null;
    var status = null;
    var historyRecords = [], historyFilter = 'all';

    function fmt(sec) {
      var m = Math.floor(sec / 60), s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function render() {
      clear(wrap);
      if (!status) { wrap.appendChild(el('div', { class: 'card' }, el('p', { class: 'muted' }, '加载中…'))); return; }

      var a = status.active;
      if (a) {
        var color = App.avColor(a.avatar);
        var stopBtn = el('button', { class: 'btn stop sm' }, '停止');
        stopBtn.onclick = function () {
          stopBtn.disabled = true; stopBtn.textContent = '处理中…';
          api('/game/stop', { method: 'POST', body: {} })
            .then(function (r) { toast(r.message || '已停止'); return load(); })
            .catch(function (e) { toast(e.message); stopBtn.disabled = false; stopBtn.textContent = '停止'; });
        };
        var actLabel = a.activity === 'tv' ? '看电视中' : '游戏中';
        var banner = el('div', { class: 'card active-banner' },
          el('div', { class: 'plist-av', style: { background: color } }, App.avEmoji(a.avatar)),
          el('div', { class: 'grow' },
            el('div', { class: 'uname' }, a.label, el('span', { class: 'playing-dot' }, '● ' + actLabel)),
            el('div', { class: 'bar js-sessbar', style: { marginTop: '8px' } }, el('i', { style: { background: color } })),
            el('div', { class: 'csub js-remain', style: { marginTop: '6px' } }, '')),
          stopBtn);
        wrap.appendChild(banner);
      }

      var players = status.quotas.filter(function (q) { return q.role === 'member'; });
      var list = el('div', { class: 'card' });
      if (players.length === 0) {
        list.appendChild(el('p', { class: 'muted', style: { margin: '4px 0' } }, '还没有玩家账号，去"账号"页添加。'));
      }
      players.forEach(function (q) {
        var bonus = q.bonusMinutes || 0;
        var effective = q.dailyQuotaMin + bonus;
        var pct = effective > 0 ? Math.round(q.remainingMinutes / effective * 100) : 0;
        var barColor = q.remainingMinutes > 0 ? 'var(--go)' : 'var(--stop)';
        var playing = a && a.child === q.child;
        var rowActLabel = playing ? (a.activity === 'tv' ? '● 看电视中' : '● 游戏中') : null;
        var quotaText = '剩余 ' + q.remainingMinutes + ' / 共 ' + effective + ' 分钟'
          + (bonus > 0 ? '（含临时 +' + bonus + '）' : '');
        var bonusBtn = el('button', { class: 'btn ghost sm' }, '改时间');
        bonusBtn.onclick = function () { App.openSetTime(q, load); };
        list.appendChild(el('div', { class: 'plist-row' },
          el('div', { class: 'plist-av', style: { background: App.avColor(q.avatar) } }, App.avEmoji(q.avatar)),
          el('div', { class: 'grow' },
            el('div', { class: 'uname' }, q.label, playing ? el('span', { class: 'playing-dot' }, rowActLabel) : null),
            el('div', { class: 'bar', style: { marginTop: '8px' } }, el('i', { style: { width: pct + '%', background: barColor } })),
            el('div', { class: 'csub', style: { marginTop: '6px' } }, quotaText)),
          el('div', { class: 'plist-num', style: { color: barColor } }, String(q.remainingMinutes)),
          bonusBtn));
      });
      wrap.appendChild(list);
      wrap.appendChild(App.makeHistoryCard(historyRecords, true, historyFilter, function (nextFilter) {
        historyFilter = nextFilter;
        render();
      }));

      if (a) tick();
    }

    function tick() {
      if (!status || !status.active) return;
      var a = status.active;
      var ends = new Date(a.endsAtIso).getTime();
      var started = new Date(a.startedAtIso).getTime();
      var total = Math.max(1, (ends - started) / 1000);
      var remain = Math.max(0, Math.round((ends - Date.now()) / 1000));
      var remainMin = Math.ceil(remain / 60);
      var remEl = wrap.querySelector('.js-remain');
      if (remEl) remEl.textContent = fmt(remain) + ' · 还剩约 ' + remainMin + ' 分钟';
      var barI = wrap.querySelector('.js-sessbar > i');
      if (barI) barI.style.width = (remain / total * 100) + '%';
      if (remain <= 0) load();
      else App.speakRemain(remain, a.label, a.activity);
    }

    function load() {
      return Promise.all([api('/game/status'), api('/game/history?limit=50')]).then(function (result) {
        var s = result[0], history = result[1];
        status = s;
        historyRecords = history.records || [];
        App.setVoiceRemindPoints(s.reminderSeconds);
        if (s.announce && typeof s.announce === 'string') App.speakText(s.announce);
        if (!s.active) App.clearSpoken();
        render();
      }).catch(function (e) {
        clear(wrap);
        wrap.appendChild(el('div', { class: 'err' }, e.message));
      });
    }

    load();
    pollTimer = setInterval(load, 5000);
    tickTimer = setInterval(tick, 1000);
    window.addEventListener('beforeunload', function () {
      clearInterval(pollTimer); clearInterval(tickTimer); App.clearSpoken();
    });
  }
})();
