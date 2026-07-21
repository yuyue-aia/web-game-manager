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

  function makeHistoryCard(records, isAdmin, filter, onFilter) {
    var el = App.el;
    records = Array.isArray(records) ? records : [];
    filter = filter === 'game' || filter === 'tv' ? filter : 'all';
    var card = el('section', { class: 'card history-card' });
    var head = el('div', { class: 'history-head' }, el('h2', {}, isAdmin ? '历史使用记录' : '我的历史记录'));

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
        '本周：游戏 ' + gameTotal + ' 分钟', el('br'), '电视 ' + tvTotal + ' 分钟'));
    }
    card.appendChild(head);

    var tabs = el('div', { class: 'history-tabs' });
    [{ k: 'all', t: '全部' }, { k: 'game', t: '游戏' }, { k: 'tv', t: '电视' }].forEach(function (item) {
      tabs.appendChild(el('button', {
        type: 'button', class: item.k === filter ? 'on' : '',
        onclick: function () { if (item.k !== filter) onFilter(item.k); }
      }, item.t));
    });
    card.appendChild(tabs);

    var visible = records.filter(function (record) { return filter === 'all' || record.activity === filter; }).slice(0, 20);
    if (visible.length === 0) {
      card.appendChild(el('p', { class: 'muted', style: { margin: '16px 2px 2px' } }, '暂无使用记录'));
      return card;
    }
    visible.forEach(function (record) {
      var isTv = record.activity === 'tv';
      var reason = record.endReason === 'manual' ? '主动停止' : '自动结束';
      card.appendChild(el('div', { class: 'history-row' },
        el('div', { class: 'history-icon' }, isTv ? '📺' : '🎮'),
        el('div', {},
          el('div', { class: 'history-title' }, (isAdmin ? record.label + ' · ' : '') + (isTv ? '电视' : '游戏')),
          el('div', { class: 'history-time' }, historyTimeText(record))),
        el('div', {},
          el('div', { class: 'history-minutes' }, String(record.actualMinutes) + ' 分钟'),
          el('div', { class: 'history-reason' }, reason))));
    });
    return card;
  }

  App.makeHistoryCard = makeHistoryCard;
})();
