// DOM 构造工具（textNode 渲染，天然防 XSS）+ toast
(function () {
  'use strict';
  var App = window.App = window.App || {};

  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, props) {
    var e = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v == null) continue;
        if (k === 'class') e.className = v;
        else if (k === 'style' && typeof v === 'object') { for (var s in v) e.style[s] = v[s]; }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') e.value = v;
        else e.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }

  function svg(tag, props) {
    var e = document.createElementNS(SVGNS, tag);
    if (props) for (var k in props) if (props[k] != null) e.setAttribute(k, props[k]);
    return e;
  }

  function append(parent, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(parent, c); }); return; }
    if (child.nodeType) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var toastTimer = null;
  function toast(msg) {
    var old = document.querySelector('.ok-toast');
    if (old) old.remove();
    var n = el('div', { class: 'ok-toast' }, msg);
    document.body.appendChild(n);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.remove(); }, 2200);
  }

  App.el = el;
  App.svg = svg;
  App.append = append;
  App.clear = clear;
  App.toast = toast;
})();
