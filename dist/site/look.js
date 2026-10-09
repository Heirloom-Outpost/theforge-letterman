// The student's chosen look (Settings, Appearance), on the pages outside the app: the privacy page and the download
// page. It reads the same record the app keeps, writes nothing, and only sets the theme, the text size and the
// browser bar's colour (the page's --bg token). Without it, or without JavaScript, the page follows the system.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('letterman:v1') || 'null'), l = (s && s.look) || {}, r = document.documentElement;
    if (l.theme === 'light' || l.theme === 'dark') r.setAttribute('data-theme', l.theme);
    if (l.text === 'large') r.setAttribute('data-text', 'large');
  } catch (e) { /* storage blocked: the system's look */ }
  var set = function () {
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    var v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); if (v) m.content = v;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', set); else set();
})();
