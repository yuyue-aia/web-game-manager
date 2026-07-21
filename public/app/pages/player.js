// 玩家首页：个人状态圆环 + 开始游戏/看电视 + 历史记录
(function () {
  'use strict';

  App.boot({ need: 'member', activeNavKey: 'play' }).then(function (ctx) {
    if (ctx.skip) return;
    run(ctx.content, ctx.me);
  });

  function run(container, me) {
    var el = App.el, clear = App.clear, api = App.api, toast = App.toast;

    var wrap = el('div');
    container.appendChild(wrap);
    var pollTimer = null, tickTimer = null;
    var status = null, prevRemainMin = null, prevKind = null;
    var historyRecords = [], historyFilter = 'all';
    var minutes = 30;
    var activity = 'game';

    function fmt(sec) {
      var m = Math.floor(sec / 60), s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function myQuota() {
      return status && status.quotas ? status.quotas.filter(function (q) { return q.child === me.id; })[0] : null;
    }
    function viewKind() {
      if (!status) return 'loading';
      if (status.active) return status.active.child === me.id ? 'mine' : 'other';
      return 'idle';
    }

    function buildStartArea() {
      var errBox = el('div');

      var actRow = el('div', { class: 'mins', style: { gridTemplateColumns: '1fr 1fr' } });
      var ACTS = [{ k: 'game', t: '🎮 玩游戏' }, { k: 'tv', t: '📺 看电视' }];
      ACTS.forEach(function (o) {
        var b = el('button', { class: o.k === activity ? 'sel' : '' }, o.t);
        b.onclick = function () { setActivity(o.k); };
        actRow.appendChild(b);
      });
      function setActivity(k) {
        activity = k;
        Array.prototype.forEach.call(actRow.children, function (b, i) {
          b.className = ACTS[i].k === k ? 'sel' : '';
        });
        btn.textContent = startLabel();
      }
      function startLabel() { return (activity === 'tv' ? '开始看电视' : '开始游戏') + ' · 通电'; }

      var minsRow = el('div', { class: 'mins' });
      var minsLabel = el('b', { style: { color: 'var(--ink)' } }, minutes + ' 分钟');
      var range = el('input', { type: 'range', min: '3', max: '60', step: '1', value: minutes, style: { marginTop: '14px', padding: '0' } });
      [10, 20, 30, 60].forEach(function (m) {
        var b = el('button', { class: m === minutes ? 'sel' : '' }, String(m));
        b.onclick = function () { setMinutes(m); };
        minsRow.appendChild(b);
      });
      function setMinutes(m) {
        minutes = m; minsLabel.textContent = m + ' 分钟'; range.value = m;
        Array.prototype.forEach.call(minsRow.children, function (b) {
          b.className = Number(b.textContent) === m ? 'sel' : '';
        });
      }
      range.oninput = function () { setMinutes(Number(range.value)); };
      var btn = el('button', { class: 'btn go lg', style: { marginTop: '16px' } }, startLabel());
      btn.onclick = function () {
        clear(errBox);
        btn.disabled = true; btn.textContent = '开机中…';
        api('/game/start', { method: 'POST', body: { minutes: minutes, activity: activity } })
          .then(function (r) { toast(r.message || '已开始'); return load(); })
          .catch(function (e) {
            errBox.appendChild(el('div', { class: 'err' }, e.message));
            btn.disabled = false; btn.textContent = startLabel();
          });
      };
      return el('div', {},
        errBox,
        el('div', { class: 'field', style: { margin: '2px 0 8px' } }, '做什么？'),
        actRow,
        el('div', { class: 'field', style: { margin: '14px 0 8px' } }, '用多久？', minsLabel),
        minsRow, range, btn);
    }

    function render() {
      clear(wrap);
      prevKind = viewKind();
      if (!status) { wrap.appendChild(el('div', { class: 'card' }, el('p', { class: 'muted' }, '加载中…'))); return; }
      var active = status.active;
      var card = el('div', { class: 'card' });
      var rw = el('div', { class: 'ring-wrap' });
      card.appendChild(rw);

      if (active) {
        var ring = App.makeRing(240, 14);
        rw._ring = ring;
        rw.appendChild(ring.node);
        if (active.child === me.id) {
          var stopBtn = el('button', { class: 'btn stop lg', style: { marginTop: '14px' } }, '停止游戏 · 关机');
          stopBtn.onclick = function () {
            stopBtn.disabled = true; stopBtn.textContent = '处理中…';
            api('/game/stop', { method: 'POST', body: {} })
              .then(function (r) { toast(r.message || '已停止'); return load(); })
              .catch(function (e) { toast(e.message); stopBtn.disabled = false; stopBtn.textContent = '停止游戏 · 关机'; });
          };
          rw.appendChild(stopBtn);
        } else {
          rw.appendChild(el('p', { class: 'muted', style: { textAlign: 'center', margin: '10px 0 0' } },
            '正在有人玩，等 TA 玩完再轮到你哦'));
        }
        tick();
      } else {
        var color = App.avColor(me.avatar);
        var q = myQuota();
        var effective = q ? q.dailyQuotaMin + (q.bonusMinutes || 0) : 0;
        var frac = (q && effective > 0) ? q.remainingMinutes / effective : 0;
        var ringColor = !status.allowedToday
          ? 'var(--line)'
          : (q && q.remainingMinutes > 0 ? 'var(--go)' : 'var(--stop)');
        var idle = App.makeRing(240, 14);
        idle.set(frac, ringColor);
        idle.inner.appendChild(el('div', { class: 'player-hero-av', style: { background: color, width: '44px', height: '44px', fontSize: '26px', borderRadius: '14px', margin: '0 auto 4px' } }, App.avEmoji(me.avatar)));
        idle.inner.appendChild(el('div', { class: 'name', style: { color: color } }, me.displayName));
        if (!status.allowedToday) {
          idle.inner.appendChild(el('div', { class: 'cap' }, '今天不能玩游戏'));
        } else if (q) {
          idle.inner.appendChild(el('div', { class: 'big', style: { fontSize: '34px', marginTop: '2px' } }, String(q.remainingMinutes)));
          idle.inner.appendChild(el('div', { class: 'cap' }, '分钟 · 今日共 ' + effective + ((q.bonusMinutes || 0) > 0 ? '（含临时 +' + q.bonusMinutes + '）' : '')));
        } else {
          idle.inner.appendChild(el('div', { class: 'cap' }, '准备好就开始吧'));
        }
        rw.appendChild(idle.node);
        card.appendChild(buildStartArea());
      }
      wrap.appendChild(card);
      wrap.appendChild(App.makeHistoryCard(historyRecords, false, historyFilter, function (nextFilter) {
        historyFilter = nextFilter;
        render();
      }));
    }

    function tick() {
      if (!status || !status.active) return;
      var rw = wrap.querySelector('.ring-wrap');
      if (!rw || !rw._ring) return;
      var a = status.active;
      var ends = new Date(a.endsAtIso).getTime();
      var started = new Date(a.startedAtIso).getTime();
      var total = Math.max(1, (ends - started) / 1000);
      var remain = Math.max(0, Math.round((ends - Date.now()) / 1000));
      var remainMin = Math.ceil(remain / 60);
      var color = App.avColor(a.avatar);
      var mine = a.child === me.id;
      var actWord = a.activity === 'tv' ? '正在看电视' : '正在玩游戏';
      rw._ring.set(remain / total, color);
      clear(rw._ring.inner);
      rw._ring.inner.appendChild(el('div', { class: 'name', style: { color: color } },
        App.avEmoji(a.avatar) + ' ' + (mine ? '你' : a.label) + ' ' + actWord));
      rw._ring.inner.appendChild(el('div', { class: 'big' }, fmt(remain)));
      rw._ring.inner.appendChild(el('div', { class: 'cap' }, '还剩约 ' + remainMin + ' 分钟'));
      if (prevRemainMin !== null && remainMin !== prevRemainMin) rw._ring.pulse();
      prevRemainMin = remainMin;
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
        if (!s.active) { prevRemainMin = null; App.clearSpoken(); }
        if (viewKind() !== prevKind || !wrap.querySelector('.card')) render();
        else tick();
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
