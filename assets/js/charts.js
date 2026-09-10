/* Minimal editorial bar rendering for market pages. Animates on entry only. */
(function () {
  'use strict';
  var KS = window.KS = window.KS || {};
  var bars = KS.$$('.chartbar span[data-pct]');
  if (!bars.length) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fill(el) { el.style.width = Math.max(0, Math.min(100, +el.dataset.pct)) + '%'; }
  if (reduce || !('IntersectionObserver' in window)) { bars.forEach(fill); return; }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { fill(e.target); io.unobserve(e.target); } });
  }, { threshold: 0.3 });
  bars.forEach(function (b) { io.observe(b); });
})();
