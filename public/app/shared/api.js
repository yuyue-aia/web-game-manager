// 极简 fetch 封装：统一 /api 前缀、JSON body、错误抛 Error(msg)
(function () {
  'use strict';
  var App = window.App = window.App || {};

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch('/api' + path, init).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
        if (!res.ok) {
          var msg = (data && data.error) || ('请求失败 (' + res.status + ')');
          var err = new Error(msg); err.status = res.status; throw err;
        }
        return data;
      });
    });
  }

  App.api = api;
})();
