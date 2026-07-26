// DOM 构造工具（textNode 渲染，天然防 XSS）+ toast
(function () {
  'use strict';
  var App = window.App = window.App || {};
  var LOGIN_ICON_ONLY = /\/login\.html$/.test(location.pathname);
  if (LOGIN_ICON_ONLY) document.documentElement.classList.add('ui-icon-only');

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
    if (LOGIN_ICON_ONLY) prepareIconOnlyElement(e);
    return e;
  }

  function hasWords(text) { return /[A-Za-z\u3400-\u9fff]/.test(text || ''); }

  function iconName(text) {
    text = String(text || '').toLowerCase();
    if (/v1\b/.test(text)) return 'v1';
    if (/v2\b/.test(text)) return 'v2';
    if (/v3\b/.test(text)) return 'v3';
    if (/v4\b/.test(text)) return 'v4';
    if (/v5\b/.test(text)) return 'v5';
    if (/运行|状态|status/.test(text)) return 'status';
    if (/配置|管理时间|config|设置/.test(text)) return 'sliders';
    if (/联网|设备|网关|device|network/.test(text)) return 'network';
    if (/账号|用户|成员|资料|头像|user|profile/.test(text)) return 'user';
    if (/密码|密钥|password/.test(text)) return 'key';
    if (/退出|logout/.test(text)) return 'logout';
    if (/删除|移除|delete/.test(text)) return 'delete';
    if (/刷新|读取|reload|refresh/.test(text)) return 'refresh';
    if (/停止|关机|stop/.test(text)) return 'stop';
    if (/保存|确认|完成|save/.test(text)) return 'check';
    if (/添加|新增|创建|add/.test(text)) return 'add';
    if (/电视|tv/.test(text)) return 'tv';
    if (/游戏|开始|进入|验证|play|start|login/.test(text)) return 'play';
    if (/全部|all/.test(text)) return 'all';
    if (/星期|周一|monday/.test(text)) return 'day1';
    if (/周二|tuesday/.test(text)) return 'day2';
    if (/周三|wednesday/.test(text)) return 'day3';
    if (/周四|thursday/.test(text)) return 'day4';
    if (/周五|friday/.test(text)) return 'day5';
    if (/周六|saturday/.test(text)) return 'day6';
    if (/周日|周天|sunday/.test(text)) return 'day7';
    return 'more';
  }

  function optionSymbol(text) {
    if (/管理员/.test(text)) return '◆';
    if (/成员/.test(text)) return '●';
    if (/测试/.test(text)) return '◇';
    return '◉';
  }

  function fieldIcon(text, type) {
    text = String(text || '').toLowerCase();
    type = String(type || '').toLowerCase();
    if (type === 'password' || /密码|密钥|password|access.*key/.test(text)) return 'lock';
    if (type === 'number' || /时间|分钟|秒|配额|提醒|time|minute|quota/.test(text)) return 'time';
    if (/账号|用户名|成员|昵称|姓名|user|account|player|operator|name/.test(text)) return 'user';
    if (/ip|mac|网址|地址|主机|设备|网关|network|host|device/.test(text)) return 'network';
    if (/提醒|通知|remind|alert/.test(text)) return 'bell';
    return 'edit';
  }

  function prepareIconOnlyElement(e) {
    var tag = e.tagName && e.tagName.toLowerCase();
    if (!tag) return;
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      var placeholder = e.getAttribute('placeholder');
      var autocomplete = e.getAttribute('autocomplete') || '';
      var context = (e.getAttribute('aria-label') || placeholder || '') + ' ' + autocomplete;
      var label = e.closest && e.closest('label');
      if (label) context += ' ' + (label.textContent || '');
      var inputType = e.getAttribute('type') || tag;
      if (inputType !== 'range' && !e.dataset.fieldIcon) e.dataset.fieldIcon = fieldIcon(context, inputType);
      if (!e.getAttribute('aria-label') && context.trim()) {
        e.setAttribute('aria-label', autocomplete === 'username' ? '账号' : (inputType === 'password' ? '密码' : context.trim()));
      }
      if (placeholder) {
        e.removeAttribute('placeholder');
      }
      return;
    }
    if (tag === 'option') {
      var optionLabel = (e.textContent || '').trim();
      if (hasWords(optionLabel)) {
        e.setAttribute('aria-label', optionLabel);
        e.textContent = optionSymbol(optionLabel);
      }
      return;
    }
    if (tag !== 'button' && tag !== 'a') return;
    var label = (e.textContent || '').trim();
    if (!hasWords(label)) return;
    if (!e.getAttribute('aria-label')) e.setAttribute('aria-label', label);
    e.classList.add('icon-control');
    e.dataset.icon = iconName(label);
  }

  function numericOnly(text) {
    var matches = String(text || '').match(/[+\-]?\d+(?::\d+)?(?:[./~～-]\d+)*(?:%|×)?/g);
    return matches ? matches.join(' · ') : '';
  }

  function sanitizeVisibleText(root) {
    if (!root) return;
    if (root.nodeType === 1) {
      prepareIconOnlyElement(root);
      Array.prototype.forEach.call(root.querySelectorAll('input,textarea,select,option,button,a'), prepareIconOnlyElement);
    }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var nodes = [], node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(function (textNode) {
      var parent = textNode.parentElement;
      if (!parent || parent.closest('script,style,title,button,a,option,[aria-hidden="true"]')) return;
      var raw = (textNode.nodeValue || '').trim();
      if (!raw || !hasWords(raw)) return;
      if (!parent.getAttribute('aria-label')) parent.setAttribute('aria-label', raw);
      var next = numericOnly(raw);
      if (textNode.nodeValue !== next) textNode.nodeValue = next;
    });
  }

  if (LOGIN_ICON_ONLY) {
    var iconOnlyObserver = new MutationObserver(function (records) {
      records.forEach(function (record) {
        if (record.type === 'characterData') sanitizeVisibleText(record.target.parentElement);
        else Array.prototype.forEach.call(record.addedNodes || [], function (node) {
          if (node.nodeType === 1) sanitizeVisibleText(node);
        });
      });
    });
    iconOnlyObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
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
  App.prepareIconOnlyElement = prepareIconOnlyElement;
  App.sanitizeVisibleText = sanitizeVisibleText;
})();
