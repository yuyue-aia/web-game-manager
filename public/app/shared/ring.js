// 倒计时圆环 / mini 环
(function () {
  'use strict';
  var App = window.App = window.App || {};

  function makeRing(size, stroke) {
    var el = App.el, svg = App.svg;
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var track = svg('circle', { class: 'track', cx: size/2, cy: size/2, r: r });
    var prog = svg('circle', { class: 'prog', cx: size/2, cy: size/2, r: r,
      'stroke-dasharray': c, 'stroke-dashoffset': c });
    var s = svg('svg', { width: size, height: size });
    s.appendChild(track); s.appendChild(prog);
    var inner = el('div', { class: 'inner' });
    var wrap = el('div', { class: 'ring', style: { width: size + 'px', height: size + 'px' } });
    wrap.appendChild(s); wrap.appendChild(inner);
    return {
      node: wrap, inner: inner,
      set: function (fraction, color) {
        var f = Math.max(0, Math.min(1, fraction));
        prog.setAttribute('stroke-dashoffset', c * (1 - f));
        prog.setAttribute('stroke', color);
      },
      pulse: function () {
        wrap.classList.remove('pulse'); void wrap.offsetWidth; wrap.classList.add('pulse');
      }
    };
  }

  function miniRing(size, stroke, fraction, color, label) {
    var el = App.el, svg = App.svg;
    var r = (size - stroke) / 2, c = 2 * Math.PI * r;
    var f = Math.max(0, Math.min(1, fraction));
    var s = svg('svg', { width: size, height: size, style: '' });
    s.style.transform = 'rotate(-90deg)';
    s.appendChild(svg('circle', { fill: 'none', stroke: 'var(--line)', 'stroke-width': stroke, cx: size/2, cy: size/2, r: r }));
    var prog = svg('circle', { fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round',
      cx: size/2, cy: size/2, r: r, 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - f) });
    prog.style.transition = 'stroke-dashoffset .6s';
    s.appendChild(prog);
    var wrap = el('div', { class: 'mini' }, el('div', { class: 'lbl' }, String(label)));
    wrap.insertBefore(s, wrap.firstChild);
    return wrap;
  }

  App.makeRing = makeRing;
  App.miniRing = miniRing;
})();
