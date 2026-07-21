// 倒计时语音提醒（管理员与玩家共用）
(function () {
  'use strict';
  var App = window.App = window.App || {};

  // _curSessionKey: 当前会话标识；_spokenPoints: 本次会话中已播报过的提醒点集合（去重）
  var _curSessionKey = null;
  var _spokenPoints = {};
  var _voiceRemindPoints = [];
  var _lastAnnounce = null;

  function setVoiceRemindPoints(points) {
    _voiceRemindPoints = Array.isArray(points) ? points.filter(function (n) { return Number(n) > 0; }).sort(function (a, b) { return a - b; }) : [];
    if (_voiceRemindPoints.length === 0) _voiceRemindPoints = [600, 300, 180, 60, 30];
  }

  function speakRemain(remainSec, label, activity) {
    if (!('speechSynthesis' in window)) return;
    if (remainSec < 0 || _voiceRemindPoints.length === 0) return;
    var sessionKey = label + ':' + activity;
    if (_curSessionKey !== sessionKey) { _curSessionKey = sessionKey; _spokenPoints = {}; }
    var minutes = Math.ceil(remainSec / 60);
    for (var i = 0; i < _voiceRemindPoints.length; i++) {
      var point = _voiceRemindPoints[i];
      if (remainSec <= point && remainSec > point - 60) {
        if (_spokenPoints[point]) break;
        _spokenPoints[point] = true;
        var text = label + '，' + (minutes <= 1 ? '时间到了' : '还剩 ' + minutes + ' 分钟') + '，请保存进度准备结束。';
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.rate = 1.0;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        break;
      }
    }
  }

  function clearSpoken() { _curSessionKey = null; _spokenPoints = {}; _lastAnnounce = null; }

  /** 直接播报一段文本（用于后端下发的启动/到期等消息）。相同内容只播一次，避免轮询重复触发。 */
  function speakText(text) {
    if (!('speechSynthesis' in window) || !text) return;
    if (text === _lastAnnounce) return;
    _lastAnnounce = text;
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  App.setVoiceRemindPoints = setVoiceRemindPoints;
  App.speakRemain = speakRemain;
  App.speakText = speakText;
  App.clearSpoken = clearSpoken;
})();
