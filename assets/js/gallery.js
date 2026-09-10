/* Property gallery. Keyboard accessible, swipeable, no library. */
(function () {
  'use strict';
  var KS = window.KS = window.KS || {};
  var g = document.querySelector('[data-gallery]');
  if (!g) return;

  var slides = KS.$$('.gallery__slide', g);
  var thumbs = KS.$$('.gallery__thumb', g);
  var prev   = g.querySelector('[data-gprev]');
  var next   = g.querySelector('[data-gnext]');
  var counter= g.querySelector('[data-gcount]');
  var main   = g.querySelector('.gallery__main');
  if (slides.length < 1) return;
  var i = 0;

  function show(n) {
    i = (n + slides.length) % slides.length;
    slides.forEach(function (s, x) {
      s.classList.toggle('is-active', x === i);
      s.setAttribute('aria-hidden', x === i ? 'false' : 'true');
    });
    thumbs.forEach(function (t, x) {
      t.setAttribute('aria-selected', x === i ? 'true' : 'false');
      if (x === i && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    if (counter) counter.textContent = (i + 1) + ' / ' + slides.length;
  }

  if (prev) prev.addEventListener('click', function () { show(i - 1); });
  if (next) next.addEventListener('click', function () { show(i + 1); });
  thumbs.forEach(function (t, x) { t.addEventListener('click', function () { show(x); }); });

  g.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); show(i - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); }
  });

  /* Touch swipe */
  if (main) {
    var x0 = null, y0 = null;
    main.addEventListener('touchstart', function (e) {
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    main.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      var dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) show(dx < 0 ? i + 1 : i - 1);
      x0 = y0 = null;
    }, { passive: true });
  }

  show(0);
})();
