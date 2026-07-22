// 玩家首页：个人状态圆环 + 开始游戏/看电视 + 历史记录
(function () {
  'use strict';

  App.boot({ need: 'member', activeNavKey: null }).then(function (ctx) {
    if (ctx.skip) return;
    run(ctx.content, ctx.me);
  });

  function run(container, me) {
    var el = App.el, clear = App.clear, api = App.api, toast = App.toast;

    var wrap = el('div', { class: 'player-cockpit' });
    container.appendChild(wrap);
    var pollTimer = null, tickTimer = null;
    var status = null, prevRemainMin = null, prevKind = null, quotaSignature = '';
    var historyRecords = [], historyFilter = 'all';
    var minutes = 30;
    var activity = 'game';
    var selectionRing = null;

    function fmt(sec) {
      var m = Math.floor(sec / 60), s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function viewKind() {
      if (!status) return 'loading';
      if (status.active) return status.active.child === me.id ? 'mine' : 'other';
      return 'idle';
    }
    function ownQuota() {
      if (!status || !Array.isArray(status.quotas)) return null;
      return status.quotas.find(function (q) { return q.child === me.id; }) || null;
    }

    function launchSequence(kind) {
      var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) return { ready: Promise.resolve(), finish: function () { return Promise.resolve(); } };

      var statusText = el('strong', { 'aria-hidden': 'true' }, '01 / 04');
      var overlay = el('div', { class: 'player-launch-sequence', role: 'status', 'aria-live': 'polite', 'aria-label': '核心充能' },
        el('div', { class: 'player-launch-grid', 'aria-hidden': 'true' }),
        el('div', { class: 'player-launch-beams', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i')),
        el('div', { class: 'player-launch-orbit', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
        el('div', { class: 'player-launch-core', 'aria-hidden': 'true' }),
        el('div', { class: 'player-launch-copy' },
          statusText,
          el('div', { class: 'player-launch-progress', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i'))));
      document.body.appendChild(overlay);
      requestAnimationFrame(function () { overlay.classList.add('is-active'); });

      var closed = false, readyDone = false, resolveReady;
      var ready = new Promise(function (resolve) {
        resolveReady = resolve;
      });
      function markReady() {
        if (readyDone) return;
        readyDone = true;
        resolveReady();
      }
      var lockTimer = setTimeout(function () {
        if (closed) return;
        overlay.classList.add('is-locked');
        overlay.setAttribute('aria-label', '轨道锁定');
        statusText.textContent = '02 / 04';
      }, 900);
      var routeTimer = setTimeout(function () {
        if (closed) return;
        overlay.classList.add('is-routing');
        overlay.setAttribute('aria-label', '链路同步');
        statusText.textContent = '03 / 04';
      }, 1650);
      var warpTimer = setTimeout(function () {
        if (closed) return;
        overlay.classList.add('is-warp');
        overlay.setAttribute('aria-label', '跃迁准备');
        statusText.textContent = '04 / 04';
      }, 2400);
      var readyTimer = setTimeout(markReady, 3000);
      var autoTimer = setTimeout(close, 4600);

      function close() {
        if (closed) return;
        closed = true;
        clearTimeout(lockTimer);
        clearTimeout(routeTimer);
        clearTimeout(warpTimer);
        clearTimeout(readyTimer);
        clearTimeout(autoTimer);
        markReady();
        overlay.remove();
      }
      function finish(ok) {
        if (closed) return Promise.resolve();
        clearTimeout(autoTimer);
        overlay.setAttribute('aria-label', ok ? '启动完成' : '启动失败');
        statusText.textContent = ok ? '04 / 04' : '×';
        overlay.classList.add(ok ? 'is-success' : 'is-error');
        return new Promise(function (resolve) {
          setTimeout(function () { close(); resolve(); }, ok ? 650 : 620);
        });
      }
      return { ready: ready, finish: finish };
    }

    function buildStartArea() {
      var errBox = el('div');
      var quota = ownQuota();
      var totalQuota = quota ? Math.max(0, Math.floor(Number(quota.dailyQuotaMin || 0) + Number(quota.bonusMinutes || 0))) : 60;
      var remainingLimit = quota ? Math.max(0, Math.floor(Number(quota.remainingMinutes || 0))) : 60;
      var hasSelectableQuota = remainingLimit >= 5;
      var maxMinutes = Math.max(5, remainingLimit);
      var axisRatio = totalQuota > 0 ? Math.max(0, Math.min(1, remainingLimit / totalQuota)) : 0;
      minutes = Math.max(5, Math.min(maxMinutes, Math.round(minutes)));

      function lineIcon(kind) {
        var icon = App.svg('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true' });
        var paths = kind === 'game'
          ? [
              'M14 18.5h20c5.8 0 9.2 15.5 5.2 18.2-2.8 1.9-7.4-5.8-10.5-5.8h-9.4c-3.1 0-7.7 7.7-10.5 5.8C4.8 34 8.2 18.5 14 18.5Z',
              'M15 27h8M19 23v8M31.5 24.5h.1M35.5 28.5h.1'
            ]
          : [
              'M8.5 13.5h31v23h-31zM17 40h14M18.5 9l5.5 4.5L29.5 9'
            ];
        paths.forEach(function (d) { icon.appendChild(App.svg('path', { d: d })); });
        return icon;
      }

      var actRow = el('div', { class: 'player-activity' });
      var ACTS = [{ k: 'game', label: '游戏' }, { k: 'tv', label: '电视' }];
      ACTS.forEach(function (o) {
        var b = el('button', {
          class: o.k === activity ? 'sel' : '',
          'aria-label': o.label,
          title: o.label
        }, el('span', { class: 'player-activity-icon' }, lineIcon(o.k)));
        b.onclick = function () { setActivity(o.k); };
        actRow.appendChild(b);
      });
      function setActivity(k) {
        activity = k;
        Array.prototype.forEach.call(actRow.children, function (b, i) {
          b.className = ACTS[i].k === k ? 'sel' : '';
        });
      }

      var minsRow = el('div', { class: 'mins player-minutes' });
      var durationValue = el('output', { class: 'player-duration-readout', 'aria-live': 'polite', 'aria-label': '当前选择 ' + minutes + ' 分钟' },
        el('span', {}, String(minutes)), el('i', { 'aria-hidden': 'true' }, '′'));
      var range = el('input', {
        class: 'player-range', type: 'range', min: '5', max: String(maxMinutes), step: '1', value: minutes,
        disabled: hasSelectableQuota ? null : 'disabled',
        'aria-label': hasSelectableQuota ? '本次时长，最大 ' + remainingLimit + ' 分钟，每次调整 1 分钟' : '剩余配额不足 5 分钟',
        style: { padding: '0' }
      });
      var tickValues = [0, 1 / 3, 2 / 3, 1].map(function (ratio) {
        return Math.round(5 + (maxMinutes - 5) * ratio);
      }).filter(function (m, i, values) { return values.indexOf(m) === i; });
      minsRow.style.gridTemplateColumns = 'repeat(' + tickValues.length + ', 1fr)';
      tickValues.forEach(function (m) {
        var b = el('button', { class: m === minutes ? 'sel' : '' }, String(m));
        b.onclick = function () { setMinutes(m); };
        minsRow.appendChild(b);
      });
      function setMinutes(m) {
        m = Math.max(5, Math.min(maxMinutes, Math.round(m)));
        minutes = m; range.value = m;
        durationValue.querySelector('span').textContent = String(m);
        durationValue.setAttribute('aria-label', '当前选择 ' + m + ' 分钟');
        var centerValue = wrap.querySelector('.js-selected-duration');
        if (centerValue) centerValue.textContent = String(m);
        if (selectionRing) selectionRing.set(m / 60, 'var(--console-primary)');
        Array.prototype.forEach.call(minsRow.children, function (b) {
          b.className = Number(b.textContent) === m ? 'sel' : '';
        });
      }
      range.oninput = function () { setMinutes(Number(range.value)); };
      var igniteIcon = App.svg('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true' });
      igniteIcon.appendChild(App.svg('path', { d: 'M20 15.5 34 24 20 32.5Z' }));
      var btn = el('button', { class: 'player-launch-btn', 'aria-label': '启动', title: '启动' },
        el('span', { class: 'player-ignite-core' }, igniteIcon));
      btn.disabled = !hasSelectableQuota;
      function setLaunchBusy(busy) {
        btn.disabled = busy || !hasSelectableQuota;
        btn.classList.toggle('is-charging', busy);
        btn.setAttribute('aria-label', busy ? '正在启动' : '启动');
      }
      btn.onclick = function () {
        clear(errBox);
        setLaunchBusy(true);
        var sequence = launchSequence(activity);
        api('/game/start', { method: 'POST', body: { minutes: minutes, activity: activity } })
          .then(function (r) {
            return sequence.ready.then(function () { return sequence.finish(true); }).then(function () {
              toast(r.message || '已开始');
              prevKind = null;
              return load();
            });
          })
          .catch(function (e) {
            sequence.finish(false).then(function () {
              errBox.appendChild(el('div', { class: 'err' }, e.message));
              setLaunchBusy(false);
            });
          });
      };
      return el('section', { class: 'player-launch-controls' },
        errBox,
        el('div', { class: 'player-control-deck' },
          actRow,
          el('div', { class: 'player-duration-console' }, durationValue,
            el('div', { class: 'player-time-axis', style: '--quota-axis-ratio:' + axisRatio }, minsRow, range)),
          el('div', { class: 'player-ignite-dock' }, btn)));
    }

    function render() {
      clear(wrap);
      prevKind = viewKind();
      if (!status) { wrap.appendChild(el('div', { class: 'card' }, el('p', { class: 'muted' }, '加载中…'))); return; }
      var active = status.active;
      var card = el('section', { class: 'card player-core-card' + (active ? ' is-active' : '') });
      var rw = el('div', { class: 'ring-wrap player-core' });
      rw.appendChild(el('div', { class: 'player-reactor-halo', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')));
      card.appendChild(rw);

      if (active) {
        selectionRing = null;
        var ring = App.makeRing(240, 14);
        rw._ring = ring;
        rw.appendChild(ring.node);
        if (active.child === me.id) {
          rw.appendChild(el('div', { class: 'player-active-quota', 'aria-live': 'polite' },
            el('span', { class: 'js-quota-used' }, '—'),
            el('i', { 'aria-hidden': 'true' }),
            el('span', { class: 'js-quota-remaining' }, '—')));
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
      } else {
        var idle = App.makeRing(240, 14);
        var quota = ownQuota();
        var totalQuota = quota ? Math.max(0, Number(quota.dailyQuotaMin || 0) + Number(quota.bonusMinutes || 0)) : 0;
        var usedQuota = quota ? Math.max(0, Number(quota.usedMinutes || 0)) : 0;
        var remainingQuota = quota ? Math.max(0, Number(quota.remainingMinutes || 0)) : 0;
        selectionRing = null;
        idle.set(totalQuota > 0 ? remainingQuota / totalQuota : 0, status.allowedToday ? 'var(--console-primary)' : 'var(--line)');
        if (quota) idle.node.setAttribute('aria-label', '今日已用 ' + usedQuota + ' 分钟，剩余 ' + remainingQuota + ' 分钟，总额 ' + totalQuota + ' 分钟');
        if (!status.allowedToday) {
          idle.inner.appendChild(el('div', { class: 'cap' }, '今天不能玩游戏'));
        } else if (quota) {
          idle.inner.appendChild(el('div', { class: 'player-quota-readout' },
            el('div', { class: 'player-quota-primary' },
              el('strong', {}, String(remainingQuota)),
              el('span', {}, '剩余')),
            el('div', { class: 'player-quota-split' },
              el('span', {}, '已用 ' + usedQuota + '′'),
              el('i', { 'aria-hidden': 'true' }),
              el('span', {}, '总额 ' + totalQuota + '′'))));
        } else {
          idle.inner.appendChild(el('div', { class: 'big js-selected-duration player-selected-duration' }, String(minutes)));
          idle.inner.appendChild(el('div', { class: 'cap player-selected-unit' }, '分钟'));
        }
        rw.appendChild(idle.node);
        card.appendChild(buildStartArea());
      }
      wrap.appendChild(card);
      if (active) tick();
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
      rw._ring.node.setAttribute('aria-label', (mine ? '你' : a.label) + actWord + '，剩余 ' + remainMin + ' 分钟');
      clear(rw._ring.inner);
      rw._ring.inner.appendChild(el('div', { class: 'big' }, fmt(remain)));
      var quota = ownQuota();
      if (quota && a.child === me.id) {
        var elapsedMinutes = Math.min(
          Math.max(1, Math.round(total / 60)),
          Math.max(1, Math.ceil((Date.now() - started) / 60000))
        );
        var effectiveQuota = Math.max(0, Number(quota.dailyQuotaMin || 0) + Number(quota.bonusMinutes || 0));
        var liveUsed = Math.min(effectiveQuota, Math.max(0, Number(quota.usedMinutes || 0)) + elapsedMinutes);
        var liveRemaining = Math.max(0, effectiveQuota - liveUsed);
        var quotaBar = rw.querySelector('.player-active-quota');
        if (quotaBar) {
          quotaBar.querySelector('.js-quota-used').textContent = '已用 ' + liveUsed + '′';
          quotaBar.querySelector('.js-quota-remaining').textContent = '剩余 ' + liveRemaining + '′';
          quotaBar.setAttribute('aria-label', '今日已用 ' + liveUsed + ' 分钟，剩余 ' + liveRemaining + ' 分钟');
        }
      }
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
        var currentQuota = ownQuota();
        var nextQuotaSignature = currentQuota
          ? [currentQuota.dailyQuotaMin, currentQuota.bonusMinutes, currentQuota.usedMinutes, currentQuota.remainingMinutes].join(':')
          : 'none';
        App.setVoiceRemindPoints(s.reminderSeconds);
        if (s.announce && typeof s.announce === 'string') App.speakText(s.announce);
        if (!s.active) { prevRemainMin = null; App.clearSpoken(); }
        if (viewKind() !== prevKind || !wrap.querySelector('.card') || nextQuotaSignature !== quotaSignature) {
          quotaSignature = nextQuotaSignature;
          render();
        }
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
