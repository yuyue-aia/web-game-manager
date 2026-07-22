// 游戏 / 电视历史记录卡片（管理员与玩家复用）
(function () {
  'use strict';
  var App = window.App = window.App || {};

  function pad2(n) { return String(n).padStart(2, '0'); }
  function sameLocalDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function shortDate(d) { return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function shortTime(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function historyTimeText(record) {
    var start = new Date(record.startedAt), end = new Date(record.endedAt), now = new Date();
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return '时间记录异常';
    var day = sameLocalDay(start, now) ? '今天' : shortDate(start);
    var endText = sameLocalDay(start, end) ? shortTime(end) : shortDate(end) + ' ' + shortTime(end);
    return day + ' ' + shortTime(start) + '～' + endText;
  }
  function compactHistoryTimeText(record) {
    var start = new Date(record.startedAt), end = new Date(record.endedAt), now = new Date();
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return '--:--';
    return (sameLocalDay(start, now) ? '' : shortDate(start) + ' · ') + shortTime(start) + '—' + shortTime(end);
  }

  function makeHistoryCard(records, isAdmin, filter, onFilter) {
    var el = App.el;
    records = Array.isArray(records) ? records : [];
    filter = filter === 'game' || filter === 'tv' ? filter : 'all';
    var card = el('section', { class: 'card history-card' + (isAdmin ? '' : ' history-card--player') });
    var head = el('div', { class: 'history-head' }, isAdmin
      ? el('h2', {}, '历史使用记录')
      : el('div', { class: 'history-hud-mark', 'aria-label': '记录' }, el('span', {}, '◈')));

    if (!isAdmin) {
      var weekStart = new Date();
      var mondayOffset = (weekStart.getDay() + 6) % 7;
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - mondayOffset);
      var gameTotal = 0, tvTotal = 0;
      records.forEach(function (record) {
        if (new Date(record.endedAt).getTime() < weekStart.getTime()) return;
        if (record.activity === 'tv') tvTotal += Number(record.actualMinutes) || 0;
        else gameTotal += Number(record.actualMinutes) || 0;
      });
      head.appendChild(el('div', { class: 'history-summary' },
        '本周 · 🎮 ' + gameTotal + ' · 📺 ' + tvTotal));
    }
    card.appendChild(head);

    var tabs = el('div', { class: 'history-tabs' });
    [{ k: 'all', t: '全部', icon: '◉' }, { k: 'game', t: '游戏', icon: '🎮' }, { k: 'tv', t: '电视', icon: '📺' }].forEach(function (item) {
      tabs.appendChild(el('button', {
        type: 'button', class: item.k === filter ? 'on' : '', 'aria-label': item.t, title: item.t,
        onclick: function () { if (item.k !== filter) onFilter(item.k); }
      }, isAdmin ? item.t : item.icon));
    });
    card.appendChild(tabs);

    var visible = records.filter(function (record) { return filter === 'all' || record.activity === filter; }).slice(0, 20);
    if (visible.length === 0) {
      card.appendChild(isAdmin
        ? el('p', { class: 'muted', style: { margin: '16px 2px 2px' } }, '暂无使用记录')
        : el('div', { class: 'history-empty', 'aria-label': '暂无使用记录' }, '—'));
      return card;
    }
    visible.forEach(function (record) {
      var isTv = record.activity === 'tv';
      var reason = record.endReason === 'manual' ? '主动停止' : '自动结束';
      card.appendChild(el('div', { class: 'history-row', 'aria-label': isTv ? '电视记录' : '游戏记录' },
        el('div', { class: 'history-icon', 'aria-hidden': 'true' }, isTv ? '📺' : '🎮'),
        el('div', {},
          isAdmin ? el('div', { class: 'history-title' }, record.label + ' · ' + (isTv ? '电视' : '游戏')) : null,
          el('div', { class: 'history-time' }, isAdmin ? historyTimeText(record) : compactHistoryTimeText(record))),
        el('div', {},
          el('div', { class: 'history-minutes' }, isAdmin ? String(record.actualMinutes) + ' 分钟' : String(record.actualMinutes) + '′'),
          isAdmin ? el('div', { class: 'history-reason' }, reason) : null)));
    });
    return card;
  }

  App.makeHistoryCard = makeHistoryCard;
})();
