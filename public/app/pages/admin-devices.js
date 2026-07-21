// 管理员：设备网络管理
//
// 页面结构（自上而下）：
//   [顶部条] 全局开关 · 路由器状态 · 汇总（几台禁网中）· 下一步动作 · [全部禁网][全部恢复]
//   [已管理设备列表] 每张卡片独立操作：改时段、立即禁/放、移除
//   [底部]   [+ 从网关添加] [+ 手动 MAC]
//
// 权威数据源：/api/ipad-access —— 本地配置就是已管理设备列表。
// 网关只在打开"添加"弹窗时读取（只有在线设备才回来，这是网关的固有局限）。
// 保存策略：任何修改（勾选/时段/添加/移除/全局开关）都整表 PUT + expectedRevision 乐观锁。
(function () {
  'use strict';

  App.boot({ need: 'admin', activeNavKey: 'devices' }).then(function (ctx) {
    if (ctx.skip) return;
    run(ctx.content);
  });

  function run(container) {
    var el = App.el, clear = App.clear, api = App.api, toast = App.toast;

    var box = el('div');
    container.appendChild(box);
    box.appendChild(el('div', { class: 'card' }, el('p', { class: 'muted' }, '设备网络管理加载中…')));

    // 网关在线设备 —— 后台异步拉取，用于给已管理设备补上"在线/离线"标记。
    // 拉不到也不影响主视图运行。缓存最近一次结果供刷新按钮使用。
    var gatewayCache = null; // { onlineByMac: Map<mac, {ip,type,connection}>, at: Date }
    function fetchGateway(force) {
      return api('/network-devices' + (force ? '?refresh=1' : ''))
        .then(function (result) {
          var map = {};
          (result.devices || []).forEach(function (d) {
            var mac = String(d.mac || '').toUpperCase();
            if (mac) map[mac] = {
              ip: d.ip || '',
              type: d.type || d.model || '',
              connection: d.connectionType || ''
            };
          });
          gatewayCache = { onlineByMac: map, at: new Date() };
          return gatewayCache;
        });
    }

    // ---------- 时间/文案工具 ----------
    function shortTime(iso) {
      var d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return '';
      return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
    }
    function humanETA(iso) {
      var t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return '';
      var diff = Math.max(0, Math.round((t - Date.now()) / 60000));
      if (diff < 1) return '不到 1 分钟';
      if (diff < 60) return '还有 ' + diff + ' 分钟';
      var h = Math.floor(diff / 60), m = diff % 60;
      return '还有 ' + h + 'h' + (m > 0 ? m + 'm' : '');
    }
    function hhmmToMin(hhmm) {
      var p = String(hhmm || '').split(':');
      var h = Number(p[0]), m = Number(p[1]);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
      return Math.max(0, Math.min(1439, h * 60 + m));
    }
    var HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
    var MINUTE_STEP = 5; // 分钟档位；如原值不在网格上（例如迁移过来的 08:13）会自动补一档

    /**
     * 时间胶囊：两个自定义 <select>（小时 + 分钟），风格与站点一致。
     * 返回 { root, get(), set('HH:mm'), onChange(fn) }。
     */
    function timePill(labelText, initialHHmm) {
      var listeners = [];
      var hourSel = el('select', { class: 'dev__time-sel' });
      var minSel = el('select', { class: 'dev__time-sel' });
      for (var h = 0; h < 24; h++) {
        var s = String(h).padStart(2, '0');
        hourSel.appendChild(el('option', { value: s }, s));
      }
      var minutes = [];
      for (var m = 0; m < 60; m += MINUTE_STEP) minutes.push(m);
      function rebuildMinutes(includeExtra) {
        clear(minSel);
        var list = minutes.slice();
        if (Number.isFinite(includeExtra) && list.indexOf(includeExtra) === -1) list.push(includeExtra);
        list.sort(function (a, b) { return a - b; });
        list.forEach(function (v) {
          var s = String(v).padStart(2, '0');
          minSel.appendChild(el('option', { value: s }, s));
        });
      }
      rebuildMinutes(null);

      function set(hhmm) {
        var parts = HHMM_RE.test(hhmm) ? hhmm.split(':') : ['22', '00'];
        hourSel.value = parts[0];
        var mv = Number(parts[1]);
        rebuildMinutes(mv % MINUTE_STEP === 0 ? null : mv);
        minSel.value = String(mv).padStart(2, '0');
      }
      set(initialHHmm);

      function get() { return hourSel.value + ':' + minSel.value; }
      function fire() { listeners.forEach(function (fn) { fn(get()); }); }
      hourSel.onchange = fire;
      minSel.onchange = fire;

      var root = el('span', { class: 'dev__time' },
        el('span', { class: 'dev__time-lbl' }, labelText),
        hourSel,
        el('span', { class: 'dev__time-colon' }, ':'),
        minSel);

      return {
        root: root,
        get: get,
        set: set,
        onChange: function (fn) { listeners.push(fn); }
      };
    }
    var MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
    function normalizeMac(raw) {
      var s = String(raw || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
      if (s.length !== 12) return null;
      return s.match(/.{2}/g).join(':');
    }

    /** 画 24h 禁网 ribbon */
    function paintRibbon(track, win, now) {
      clear(track);
      if (!win) {
        track.appendChild(el('div', { class: 'dev__ribbon-empty' }, '未设置禁网时段'));
        return;
      }
      var s = hhmmToMin(win.blockStartHHmm), e = hhmmToMin(win.blockEndHHmm), full = 1440;
      var segs = s < e ? [[s, e]] : [[s, full], [0, e]];
      segs.forEach(function (seg) {
        var left = seg[0] / full * 100, width = (seg[1] - seg[0]) / full * 100;
        if (width <= 0) return;
        track.appendChild(el('div', {
          class: 'dev__ribbon-fill',
          style: { left: left + '%', width: width + '%' }
        }));
      });
      var nowMin = now.getHours() * 60 + now.getMinutes();
      track.appendChild(el('div', {
        class: 'dev__ribbon-now',
        style: { left: 'calc(' + (nowMin / full * 100) + '% - 1px)' }
      }));
    }

    // ---------- 顶部视图 ----------
    function summaryText(view) {
      var cfg = view.config;
      if (!view.routerConfigured) return '路由器未配置账号或密码';
      if (view.lastStatus === 'failed') return '最近执行失败：' + (view.lastError || '未知错误');
      if (!cfg.enabled) return '时间管理已停用（保存的时段不再自动生效，但仍可手动禁/放）';
      var states = view.deviceStates || [];
      var blocked = states.filter(function (s) { return s.currentPolicy === 'block'; }).length;
      var allowed = states.filter(function (s) { return s.currentPolicy === 'allow'; }).length;
      return '路由器已连通 · ' + blocked + ' 台禁网中 · ' + allowed + ' 台允许';
    }

    function statusPill(state, hasWindow) {
      if (state && state.lastStatus === 'failed') return { cls: 'dev__status--error', text: '控制失败' };
      if (state && state.currentPolicy === 'block') return { cls: 'dev__status--night', text: '禁网中' };
      if (state && state.currentPolicy === 'allow') return { cls: 'dev__status--awake', text: '允许联网' };
      return { cls: 'dev__status--idle', text: hasWindow ? '待生效' : '仅手动' };
    }

    // ---------- 主渲染 ----------
    function render(view) {
      clear(box);
      var cfg = view.config;
      var defaultWin = (cfg && cfg.defaultWindow) || { blockStartHHmm: '22:00', blockEndHHmm: '09:00' };
      var errBox = el('div');

      // 本地可变副本
      var enabled = !!cfg.enabled;
      var devices = cfg.devices.map(function (d) {
        return {
          name: d.name,
          mac: d.mac.toUpperCase(),
          windows: (d.windows || []).map(function (w) {
            return { blockStartHHmm: w.blockStartHHmm, blockEndHHmm: w.blockEndHHmm };
          })
        };
      });
      var statesByMac = {};
      (view.deviceStates || []).forEach(function (s) { statesByMac[s.mac.toUpperCase()] = s; });

      // ---- 顶部条 ----
      var enabledToggle = el('input', { type: 'checkbox' });
      enabledToggle.checked = enabled;
      var enabledLabel = el('label', { class: 'dev-top__toggle' },
        enabledToggle, el('span', null, '时间管理总开关'));

      var summaryLine = el('p', { class: 'dev-pane__sub' }, summaryText(view));
      var nextBadge = null;
      if (view.nextActionAt) {
        var actZh = view.nextAction === 'block' ? '禁网' : '恢复联网';
        nextBadge = el('div', { class: 'dev-pane__next' },
          el('span', { class: 'dev-pane__next-dot' }),
          document.createTextNode('下一步 '),
          el('b', null, shortTime(view.nextActionAt) + ' ' + actZh),
          document.createTextNode(' · '
            + (view.nextActionDeviceName ? view.nextActionDeviceName + ' · ' : '')
            + humanETA(view.nextActionAt)));
      }

      var batchBlock = el('button', { class: 'btn stop sm', type: 'button' }, '全部禁网');
      var batchAllow = el('button', { class: 'btn go sm', type: 'button' }, '全部恢复');
      var refreshGwBtn = el('button', { class: 'btn ghost sm', type: 'button' }, '刷新网关在线状态');
      batchBlock.disabled = batchAllow.disabled = !view.routerConfigured || devices.length === 0;
      batchBlock.onclick = function () { batchAction('block'); };
      batchAllow.onclick = function () { batchAction('allow'); };
      refreshGwBtn.onclick = function () {
        refreshGwBtn.disabled = true; refreshGwBtn.textContent = '读取中…';
        fetchGateway(true).then(function () {
          refreshGwBtn.disabled = false; refreshGwBtn.textContent = '刷新网关在线状态';
          renderList();
        }).catch(function (e) {
          refreshGwBtn.disabled = false; refreshGwBtn.textContent = '刷新网关在线状态';
          toast('网关读取失败：' + e.message);
        });
      };

      var topHead = el('div', { class: 'dev-pane__head' },
        el('div', { class: 'dev-top__row' },
          el('h2', { class: 'dev-pane__title' }, '设备网络管理'),
          enabledLabel),
        summaryLine);
      if (nextBadge) topHead.appendChild(nextBadge);
      topHead.appendChild(el('div', { class: 'dev-top__batch' }, batchBlock, batchAllow, refreshGwBtn));

      enabledToggle.onchange = function () {
        var was = enabled;
        enabled = enabledToggle.checked;
        saveConfig().catch(function () { enabled = was; enabledToggle.checked = was; });
      };

      // ---- 已管理设备列表 ----
      var listErr = el('div');
      var list = el('div', { class: 'dev-list' });

      function renderList() {
        clear(list);
        if (devices.length === 0) {
          list.appendChild(el('div', { class: 'dev-empty' },
            '还没有设备。点下方"从网关添加"或"手动 MAC"加入第一台。'));
          return;
        }
        devices.forEach(function (device, idx) {
          list.appendChild(renderCard(device, idx));
        });
      }

      // ---- 单张设备卡 ----
      function renderCard(device, idx) {
        var state = statesByMac[device.mac];
        var win = device.windows[0] || null;
        var hasWin = !!win;
        var effective = win || defaultWin;
        var pill = statusPill(state, hasWin);

        // 元信息：网关缓存决定在线/离线，未拉到则显示"网关状态加载中"
        var gw = gatewayCache && gatewayCache.onlineByMac[device.mac];
        var online = gatewayCache ? !!gw : null;
        var metaBits = [device.mac];
        if (gw && gw.ip) metaBits.push(gw.ip);
        if (gw && gw.type) metaBits.push(gw.type);
        if (gw && gw.connection) metaBits.push(gw.connection);
        metaBits.push(online === true ? '网关在线'
          : online === false ? '不在网关在线列表'
          : '网关状态加载中');

        var nameEl = el('span', { class: 'dev__name' }, device.name || device.mac);
        var pillEl = el('span', { class: 'dev__status ' + pill.cls }, pill.text);
        var metaEl = el('div', { class: 'dev__meta' }, metaBits.join(' · '));

        var startPill = timePill('禁网', effective.blockStartHHmm);
        var endPill = timePill('恢复', effective.blockEndHHmm);
        var setBtn = el('button', { class: 'btn ghost sm', type: 'button' }, hasWin ? '更新时段' : '设置时段');
        var clearBtn = el('button', { class: 'dev__clear', type: 'button' }, '清空时段（仅手动）');
        clearBtn.style.visibility = hasWin ? 'visible' : 'hidden';

        startPill.onChange(function (v) { effective.blockStartHHmm = v; });
        endPill.onChange(function (v) { effective.blockEndHHmm = v; });

        setBtn.onclick = function () {
          var s = startPill.get(), e = endPill.get();
          if (!HHMM_RE.test(s) || !HHMM_RE.test(e) || s === e) {
            toast('时间无效或首尾相同'); return;
          }
          device.windows = [{ blockStartHHmm: s, blockEndHHmm: e }];
          saveConfig();
        };
        clearBtn.onclick = function () {
          device.windows = [];
          saveConfig();
        };

        var ribbonTrack = el('div', { class: 'dev__ribbon-track' });
        var ribbonWrap = el('div', { class: 'dev__ribbon' + (hasWin ? '' : ' dev__ribbon--empty') },
          ribbonTrack,
          el('div', { class: 'dev__ribbon-ticks' },
            el('span', null, '00'), el('span', null, '06'),
            el('span', null, '12'), el('span', null, '18'), el('span', null, '24')));
        paintRibbon(ribbonTrack, win, new Date());

        // 单台立即操作 + 移除
        var blockBtn = el('button', { class: 'btn stop sm', type: 'button' }, '立即禁网');
        var allowBtn = el('button', { class: 'btn go sm', type: 'button' }, '立即恢复');
        var removeBtn = el('button', { class: 'btn ghost sm', type: 'button' }, '移除');
        blockBtn.disabled = allowBtn.disabled = !view.routerConfigured;
        blockBtn.onclick = function () { deviceAction('block', device, blockBtn); };
        allowBtn.onclick = function () { deviceAction('allow', device, allowBtn); };
        removeBtn.onclick = function () {
          if (!confirm('移除 ' + (device.name || device.mac) + ' ？\n（不会自动"恢复联网"，如需请先点立即恢复）')) return;
          devices.splice(idx, 1);
          saveConfig();
        };

        // 下一步动作（该设备自己的）
        var nextEl = el('div', { class: 'dev__next' });
        if (state && state.nextAction && state.nextActionAt) {
          nextEl.appendChild(document.createTextNode('下一步 '));
          nextEl.appendChild(el('b', null, shortTime(state.nextActionAt)));
          nextEl.appendChild(document.createTextNode(
            ' ' + (state.nextAction === 'block' ? '禁网' : '恢复') + ' · ' + humanETA(state.nextActionAt)));
        }

        var head = el('div', { class: 'dev__head' }, nameEl, pillEl);
        var winRow = el('div', { class: 'dev__ctrls' },
          startPill.root,
          el('span', { class: 'arr' }, '→'),
          endPill.root,
          setBtn, clearBtn, nextEl);
        var actRow = el('div', { class: 'dev__actrow' }, blockBtn, allowBtn, removeBtn);

        var main = el('div', { class: 'dev__main' }, head, metaEl, ribbonWrap, winRow, actRow);
        var tile = el('div', { class: 'dev dev--selected'
          + (online === false ? ' dev--offline' : '')
          + (state && state.currentPolicy === 'block' ? ' dev--night-active' : '') });
        tile.appendChild(main);
        return tile;
      }

      // ---- 添加设备（从网关 / 手动） ----
      var addFromGw = el('button', { class: 'btn ghost', type: 'button' }, '+ 从网关添加设备');
      var addManual = el('button', { class: 'btn ghost', type: 'button' }, '+ 手动输入 MAC');
      addFromGw.onclick = openGatewayPicker;
      addManual.onclick = openManualInput;

      // ---- 保存（乐观锁） ----
      function currentPayload() {
        return {
          enabled: enabled,
          defaultWindow: { blockStartHHmm: defaultWin.blockStartHHmm, blockEndHHmm: defaultWin.blockEndHHmm },
          devices: devices.map(function (d) {
            return {
              name: d.name,
              mac: d.mac,
              windows: d.windows.map(function (w) {
                return { blockStartHHmm: w.blockStartHHmm, blockEndHHmm: w.blockEndHHmm };
              })
            };
          })
        };
      }
      function saveConfig() {
        clear(errBox);
        return api('/ipad-access', {
          method: 'PUT',
          body: { config: currentPayload(), expectedRevision: view.revision }
        }).then(function (updated) {
          toast(updated.lastStatus === 'failed' ? '已保存，路由器执行有报错' : '已保存');
          render(updated);
        }).catch(function (e) {
          errBox.appendChild(el('div', { class: 'err' }, e.message));
          // 冲突时刷新
          if (/修订/.test(e.message) || /revision/i.test(e.message)) {
            api('/ipad-access').then(render).catch(function () {});
          }
          throw e;
        });
      }

      // ---- 立即操作（单台） ----
      function deviceAction(action, device, btn) {
        var oldText = btn.textContent;
        btn.disabled = true; btn.textContent = '处理中…';
        api('/ipad-access/action', {
          method: 'POST',
          body: { action: action, expectedRevision: view.revision, targetMacs: [device.mac] }
        }).then(function (r) {
          toast((action === 'block' ? '已禁网 ' : '已恢复 ') + (device.name || device.mac));
          render(r.status);
        }).catch(function (e) {
          clear(errBox);
          errBox.appendChild(el('div', { class: 'err' }, e.message));
          api('/ipad-access').then(render).catch(function () {
            btn.disabled = false; btn.textContent = oldText;
          });
        });
      }
      function batchAction(action) {
        if (devices.length === 0) return;
        if (!confirm((action === 'block' ? '立即禁止 ' : '立即恢复 ') + devices.length + ' 台设备联网？')) return;
        batchBlock.disabled = batchAllow.disabled = true;
        api('/ipad-access/action', {
          method: 'POST',
          body: {
            action: action,
            expectedRevision: view.revision,
            targetMacs: devices.map(function (d) { return d.mac; })
          }
        }).then(function (r) {
          toast(action === 'block' ? '已请求全部禁网' : '已请求全部恢复');
          render(r.status);
        }).catch(function (e) {
          clear(errBox);
          errBox.appendChild(el('div', { class: 'err' }, e.message));
          api('/ipad-access').then(render).catch(function () {});
        });
      }

      // ---- 弹窗：从网关添加 ----
      function openGatewayPicker() {
        var mask = el('div', { class: 'modal-mask' });
        function close() { mask.remove(); }
        mask.onclick = function (e) { if (e.target === mask) close(); };

        var body = el('div', { class: 'gw-picker__body' },
          el('p', { class: 'muted' }, '读取中…'));
        var refreshBtn = el('button', { class: 'btn ghost sm', type: 'button' }, '刷新');
        var addBtn = el('button', { class: 'btn', type: 'button' }, '添加所选');
        addBtn.disabled = true;
        var picked = {}; // mac -> {name, mac}

        function load(force) {
          clear(body);
          body.appendChild(el('p', { class: 'muted' }, '读取网关设备…'));
          refreshBtn.disabled = true;
          api('/network-devices' + (force ? '?refresh=1' : ''))
            .then(function (result) {
              refreshBtn.disabled = false;
              clear(body);
              var managedMacs = {};
              devices.forEach(function (d) { managedMacs[d.mac] = true; });
              var candidates = (result.devices || []).map(function (d) {
                return {
                  mac: String(d.mac || '').toUpperCase(),
                  name: d.name || d.model || d.mac,
                  ip: d.ip || '',
                  type: d.type || d.model || '',
                  connection: d.connectionType || ''
                };
              }).filter(function (d) { return MAC_RE.test(d.mac); });
              candidates.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-CN'); });
              if (!candidates.length) {
                body.appendChild(el('div', { class: 'dev-empty' },
                  '网关没有返回设备（可能它只能看到在线设备）。点上方"刷新"重试，或用"手动输入 MAC"。'));
                return;
              }
              candidates.forEach(function (c) {
                var alreadyManaged = !!managedMacs[c.mac];
                var cb = el('input', { type: 'checkbox' });
                cb.disabled = alreadyManaged;
                cb.onchange = function () {
                  if (cb.checked) picked[c.mac] = { name: c.name, mac: c.mac };
                  else delete picked[c.mac];
                  addBtn.disabled = Object.keys(picked).length === 0;
                };
                var right = el('div', { class: 'gw-row__right' },
                  el('div', { class: 'gw-row__name' }, c.name),
                  el('div', { class: 'gw-row__meta' },
                    c.mac + (c.ip ? ' · ' + c.ip : '')
                    + (c.type ? ' · ' + c.type : '')
                    + (c.connection ? ' · ' + c.connection : '')
                    + (alreadyManaged ? ' · 已在管理' : '')));
                body.appendChild(el('label', { class: 'gw-row' }, cb, right));
              });
            })
            .catch(function (e) {
              refreshBtn.disabled = false;
              clear(body);
              body.appendChild(el('div', { class: 'err' }, e.message));
            });
        }
        refreshBtn.onclick = function () { load(true); };
        addBtn.onclick = function () {
          Object.keys(picked).forEach(function (mac) {
            if (devices.some(function (d) { return d.mac === mac; })) return;
            devices.push({
              name: picked[mac].name,
              mac: mac,
              windows: [{ blockStartHHmm: defaultWin.blockStartHHmm, blockEndHHmm: defaultWin.blockEndHHmm }]
            });
          });
          close();
          saveConfig();
        };

        var card = el('div', { class: 'card stack modal-card modal-card--wide' },
          el('div', { class: 'modal-head' },
            el('h3', {}, '从网关添加设备'),
            refreshBtn,
            el('button', { class: 'x', onclick: close }, '×')),
          el('p', { class: 'muted', style: { margin: '0 0 6px', fontSize: '12px' } },
            '网关通常只能看到当前在线的设备；离线设备用下方"手动 MAC"添加。'),
          body,
          addBtn);
        mask.appendChild(card);
        document.body.appendChild(mask);
        load(false);
      }

      // ---- 弹窗：手动 MAC ----
      function openManualInput() {
        var mask = el('div', { class: 'modal-mask' });
        function close() { mask.remove(); }
        mask.onclick = function (e) { if (e.target === mask) close(); };

        var errIn = el('div');
        var nameIn = el('input', { placeholder: '备注名，如：孩子 iPad' });
        var macIn = el('input', { placeholder: 'AA:BB:CC:DD:EE:FF', autocapitalize: 'characters' });
        var addBtn = el('button', { class: 'btn', type: 'button' }, '添加');
        addBtn.onclick = function () {
          clear(errIn);
          var name = String(nameIn.value || '').trim();
          var mac = normalizeMac(macIn.value);
          if (!name) { errIn.appendChild(el('div', { class: 'err' }, '请填备注名')); return; }
          if (!mac) { errIn.appendChild(el('div', { class: 'err' }, 'MAC 格式不正确')); return; }
          if (devices.some(function (d) { return d.mac === mac; })) {
            errIn.appendChild(el('div', { class: 'err' }, '该 MAC 已在管理列表')); return;
          }
          devices.push({
            name: name,
            mac: mac,
            windows: [{ blockStartHHmm: defaultWin.blockStartHHmm, blockEndHHmm: defaultWin.blockEndHHmm }]
          });
          close();
          saveConfig();
        };

        var card = el('div', { class: 'card stack modal-card' },
          el('div', { class: 'modal-head' }, el('h3', {}, '手动输入 MAC'),
            el('button', { class: 'x', onclick: close }, '×')),
          errIn,
          el('label', { class: 'field' }, '备注名', nameIn),
          el('label', { class: 'field' }, 'MAC 地址', macIn),
          el('p', { class: 'muted', style: { margin: 0, fontSize: '12px' } },
            '离线设备也能添加：只要 MAC 正确，路由器控制它就有效。'),
          addBtn);
        mask.appendChild(card);
        document.body.appendChild(mask);
        nameIn.focus();
      }

      // ---- 组装 ----
      var pane = el('div', { class: 'dev-pane' },
        topHead,
        errBox,
        listErr,
        list,
        el('div', { class: 'dev-pane__add' }, addFromGw, addManual));
      var card = el('div', { class: 'card' });
      card.appendChild(pane);
      box.appendChild(card);
      renderList();

      // 首次进入或缓存超过 60s 才自动拉一次网关；刷新按钮永远走强制拉。
      if (!gatewayCache || (Date.now() - gatewayCache.at.getTime()) > 60_000) {
        fetchGateway(false).then(renderList).catch(function () { /* 静默：主流程不依赖它 */ });
      }
    }

    api('/ipad-access').then(render).catch(function (e) {
      clear(box); box.appendChild(el('div', { class: 'err' }, e.message));
    });
  }
})();
