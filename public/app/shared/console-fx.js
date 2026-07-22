// 登录后工作台环境动效：星图、数据连线与鼠标视差。
(function () {
  'use strict';

  if (/\/login\.html$/.test(location.pathname)) return;

  var THEMES = {
    v1: { primary: '#58e5ff', primaryRgb: '88,229,255', secondary: '#ff57c9', secondaryRgb: '255,87,201', bg: '#050817' },
    v2: { primary: '#ff9f25', primaryRgb: '255,159,37', secondary: '#ffd36a', secondaryRgb: '255,211,106', bg: '#080705' },
    v3: { primary: '#9ec7ff', primaryRgb: '158,199,255', secondary: '#ff70c8', secondaryRgb: '255,112,200', bg: '#000000' },
    v4: { primary: '#69d8ff', primaryRgb: '105,216,255', secondary: '#a9d7e8', secondaryRgb: '169,215,232', bg: '#030507' },
    v5: { primary: '#70f3d4', primaryRgb: '112,243,212', secondary: '#c4fff0', secondaryRgb: '196,255,240', bg: '#050707' }
  };
  var themeKey = 'v1';
  try {
    var savedTheme = localStorage.getItem('login.fx.version');
    if (THEMES[savedTheme]) themeKey = savedTheme;
  } catch (e) {}
  var theme = THEMES[themeKey];
  document.documentElement.dataset.consoleTheme = themeKey;
  document.documentElement.style.setProperty('--cursor-color', theme.primary);
  document.documentElement.style.setProperty('--cursor-glow', 'rgba(' + theme.primaryRgb + ',.24)');
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', theme.bg);

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canvas = document.createElement('canvas');
  canvas.className = 'console-fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  document.body.classList.add('app-console');

  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var width = 0, height = 0, ratio = 1;
  var pointer = { x: .68, y: .28, tx: .68, ty: .28 };
  var nodes = [];
  var frame = 0;
  var visible = true;

  function seed() {
    var count = Math.max(30, Math.min(68, Math.round(width * height / 28000)));
    nodes = [];
    for (var i = 0; i < count; i++) {
      nodes.push({
        x: Math.random(),
        y: Math.random(),
        r: .45 + Math.random() * 1.15,
        a: .12 + Math.random() * .42,
        dx: (Math.random() - .5) * .000035,
        dy: (Math.random() - .5) * .000035,
        pulse: Math.random() * Math.PI * 2
      });
    }
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    seed();
    if (reduced) draw(0);
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    pointer.x += (pointer.tx - pointer.x) * .035;
    pointer.y += (pointer.ty - pointer.y) * .035;

    var px = (pointer.x - .5) * 18;
    var py = (pointer.y - .5) * 18;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!reduced) {
        n.x = (n.x + n.dx + 1) % 1;
        n.y = (n.y + n.dy + 1) % 1;
      }
      var x = n.x * width + px * (n.r / 1.6);
      var y = n.y * height + py * (n.r / 1.6);
      var alpha = n.a * (.72 + Math.sin(time * .0007 + n.pulse) * .28);
      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + theme.primaryRgb + ',' + alpha + ')';
      ctx.arc(x, y, n.r, 0, Math.PI * 2);
      ctx.fill();

      for (var j = i + 1; j < nodes.length; j++) {
        var m = nodes[j];
        var mx = m.x * width + px * (m.r / 1.6);
        var my = m.y * height + py * (m.r / 1.6);
        var dx = x - mx, dy = y - my;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 118) {
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(' + theme.secondaryRgb + ',' + ((1 - dist / 118) * .075) + ')';
          ctx.lineWidth = .65;
          ctx.moveTo(x, y);
          ctx.lineTo(mx, my);
          ctx.stroke();
        }
      }
    }

    if (!reduced && visible) frame = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', function (event) {
    pointer.tx = event.clientX / Math.max(1, width);
    pointer.ty = event.clientY / Math.max(1, height);
    document.documentElement.style.setProperty('--pointer-x', (pointer.tx * 100).toFixed(2) + '%');
    document.documentElement.style.setProperty('--pointer-y', (pointer.ty * 100).toFixed(2) + '%');
  }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    visible = !document.hidden;
    if (!reduced && visible && !frame) frame = requestAnimationFrame(draw);
    if (!visible && frame) { cancelAnimationFrame(frame); frame = 0; }
  });

  resize();
  if (!reduced) frame = requestAnimationFrame(draw);
})();
