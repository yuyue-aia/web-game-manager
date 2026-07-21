// 内置头像 logo（与后端 AVATARS 顺序一致）+ 头像选择器
(function () {
  'use strict';
  var App = window.App = window.App || {};

  var AVATARS = ['fox', 'panda', 'dino', 'rocket', 'unicorn', 'tiger', 'octopus', 'star'];
  var AVATAR_META = {
    fox:     { emoji: '🦊', color: '#FF7A59' },
    panda:   { emoji: '🐼', color: '#5B6472' },
    dino:    { emoji: '🦕', color: '#2FBF71' },
    rocket:  { emoji: '🚀', color: '#4C8DFF' },
    unicorn: { emoji: '🦄', color: '#B06BE0' },
    tiger:   { emoji: '🐯', color: '#F2A93B' },
    octopus: { emoji: '🐙', color: '#E0559B' },
    star:    { emoji: '🌟', color: '#EAB308' }
  };
  function avEmoji(id) { return (AVATAR_META[id] || AVATAR_META.star).emoji; }
  function avColor(id) { return (AVATAR_META[id] || AVATAR_META.star).color; }

  function makeAvatarPicker(selectedId) {
    var el = App.el;
    var current = AVATARS.indexOf(selectedId) >= 0 ? selectedId : 'star';
    var grid = el('div', { class: 'av-picker' });
    AVATARS.forEach(function (id) {
      var opt = el('button', { type: 'button', class: 'av-opt' + (id === current ? ' sel' : '') }, avEmoji(id));
      opt.onclick = function () {
        current = id;
        Array.prototype.forEach.call(grid.children, function (c, i) {
          c.className = 'av-opt' + (AVATARS[i] === current ? ' sel' : '');
        });
      };
      grid.appendChild(opt);
    });
    return { node: grid, get: function () { return current; } };
  }

  App.AVATARS = AVATARS;
  App.avEmoji = avEmoji;
  App.avColor = avColor;
  App.makeAvatarPicker = makeAvatarPicker;
})();
