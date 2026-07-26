// 全局自定义鼠标：页面主题形状 + 柔和拖尾 + 交互反馈。
(function () {
  'use strict';

  var finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!finePointer || reducedMotion) return;

  var path = location.pathname;
  var page = path.indexOf('/admin/dashboard') >= 0 ? 'status'
    : path.indexOf('/admin/config') >= 0 ? 'config'
      : path.indexOf('/admin/devices') >= 0 ? 'devices'
        : path.indexOf('/admin/users') >= 0 ? 'users'
          : path.indexOf('/player') >= 0 ? 'player'
            : path.indexOf('/login') >= 0 ? 'login' : 'entry';
  document.documentElement.dataset.cursorPage = page;

  function start() {
    if (!document.body || document.querySelector('.custom-cursor')) return;

    var cursor = document.createElement('div');
    cursor.className = 'custom-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    var shape = document.createElement('i');
    shape.className = 'custom-cursor__shape';
    var dot = document.createElement('b');
    dot.className = 'custom-cursor__dot';
    cursor.appendChild(shape);
    cursor.appendChild(dot);

    var aura = document.createElement('div');
    aura.className = 'custom-cursor-aura';
    aura.setAttribute('aria-hidden', 'true');

    var trails = [];
    var trailLayer = document.createElement('div');
    trailLayer.className = 'custom-cursor-trails';
    trailLayer.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 6; i++) {
      var trail = document.createElement('i');
      trail.style.setProperty('--trail-index', String(i));
      trailLayer.appendChild(trail);
      trails.push({ node: trail, x: innerWidth / 2, y: innerHeight / 2 });
    }

    document.body.appendChild(aura);
    document.body.appendChild(trailLayer);
    document.body.appendChild(cursor);
    document.documentElement.classList.add('has-custom-cursor');

    var targetX = innerWidth / 2, targetY = innerHeight / 2;
    var cursorX = targetX, cursorY = targetY;
    var auraX = targetX, auraY = targetY;
    var visible = false, activeTarget = null;

    function move(event) {
      targetX = event.clientX; targetY = event.clientY;
      setActiveTarget(event.target);
      if (!visible) {
        visible = true;
        cursor.classList.add('is-visible');
        aura.classList.add('is-visible');
        trailLayer.classList.add('is-visible');
        cursorX = auraX = targetX; cursorY = auraY = targetY;
        trails.forEach(function (trail) { trail.x = targetX; trail.y = targetY; });
      }
    }

    function interactiveOf(target) {
      return target && target.closest ? target.closest('button, a, input, textarea, select, [role="button"]') : null;
    }

    function setActiveTarget(target) {
      var next = interactiveOf(target);
      if (next === activeTarget) return;
      activeTarget = next;
      cursor.classList.toggle('is-interactive', !!next);
      cursor.classList.toggle('is-text', !!next && /^(INPUT|TEXTAREA)$/.test(next.tagName));
    }

    function over(event) { setActiveTarget(event.target); }

    function down(event) {
      cursor.classList.add('is-down');
      var pulse = document.createElement('i');
      pulse.className = 'custom-cursor-pulse';
      pulse.style.left = event.clientX + 'px';
      pulse.style.top = event.clientY + 'px';
      document.body.appendChild(pulse);
      pulse.addEventListener('animationend', function () { pulse.remove(); }, { once: true });
    }
    function up() { cursor.classList.remove('is-down'); }
    function hide() {
      visible = false;
      cursor.classList.remove('is-visible');
      aura.classList.remove('is-visible');
      trailLayer.classList.remove('is-visible');
    }

    function frame() {
      cursorX += (targetX - cursorX) * .36;
      cursorY += (targetY - cursorY) * .36;
      auraX += (targetX - auraX) * .075;
      auraY += (targetY - auraY) * .075;
      cursor.style.transform = 'translate3d(' + (cursorX - 16) + 'px,' + (cursorY - 16) + 'px,0)';
      aura.style.transform = 'translate3d(' + (auraX - 120) + 'px,' + (auraY - 120) + 'px,0)';
      var leadX = cursorX, leadY = cursorY;
      trails.forEach(function (trail, index) {
        var ease = .23 - index * .018;
        trail.x += (leadX - trail.x) * ease;
        trail.y += (leadY - trail.y) * ease;
        trail.node.style.transform = 'translate3d(' + trail.x + 'px,' + trail.y + 'px,0)';
        leadX = trail.x; leadY = trail.y;
      });
      requestAnimationFrame(frame);
    }

    addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerover', over, { passive: true });
    document.addEventListener('pointerdown', down, { passive: true });
    document.addEventListener('pointerup', up, { passive: true });
    document.addEventListener('pointercancel', up, { passive: true });
    document.documentElement.addEventListener('mouseleave', hide, { passive: true });
    addEventListener('blur', hide, { passive: true });
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
