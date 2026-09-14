/* Kaylin Smith Real Estate - core runtime
   No framework, no build step. Progressive enhancement throughout:
   every navigation and form works without JS where the platform allows. */
(function () {
  'use strict';

  var KS = window.KS = window.KS || {};
  var CFG = window.KS_CONFIG || {};
  KS.config = CFG;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------------------------------------------------------- utils */
  KS.$  = function (s, r) { return (r || document).querySelector(s); };
  KS.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  KS.money = function (n, opts) {
    if (n === null || n === undefined || isNaN(n)) return '';
    opts = opts || {};
    return new Intl.NumberFormat('en-CA', {
      style: 'currency', currency: 'CAD',
      minimumFractionDigits: opts.cents ? 2 : 0,
      maximumFractionDigits: opts.cents ? 2 : 0
    }).format(n);
  };
  KS.num = function (n) {
    if (n === null || n === undefined || isNaN(n)) return '';
    return new Intl.NumberFormat('en-CA').format(n);
  };
  KS.debounce = function (fn, ms) {
    var t; return function () {
      var a = arguments, c = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms || 180);
    };
  };
  KS.esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ------------------------------------------------------------ analytics */
  /* Section 41. Events fire regardless of whether GA4 is configured, so the
     event map is verifiable in development without a live property. */
  window.dataLayer = window.dataLayer || [];
  KS.EVENTS = ['property_view','property_search','property_favourite','showing_request',
    'home_evaluation_started','home_evaluation_completed','consultation_request',
    'phone_click','email_click','guide_download','newsletter_signup',
    'neighbourhood_view','listing_alert_signup','contact_request','valuation_request',
    'referral_request','calculator_used','business_enquiry',
    'chat_opened','faq_question','lead_flow_started','lead_submitted','human_escalation'];

  KS.track = function (event, params) {
    params = params || {};
    var payload = {}; for (var k in params) if (params.hasOwnProperty(k)) payload[k] = params[k];
    payload.event = event;
    payload.page_path = location.pathname;
    window.dataLayer.push(payload);
    if (typeof window.gtag === 'function') { window.gtag('event', event, params); }
    if (CFG.dev) {
      if (KS.EVENTS.indexOf(event) === -1) console.warn('[KS analytics] undeclared event:', event);
      console.debug('[KS analytics]', event, params);
    }
  };

  /* Auto-track outbound contact intents */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('tel:') === 0)    KS.track('phone_click', { location: a.dataset.loc || 'link' });
    if (href.indexOf('mailto:') === 0) KS.track('email_click', { location: a.dataset.loc || 'link' });
  });

  /* ---------------------------------------------------------- dev notice */
  /* The dev bar is fixed above the nav. Its height varies with text wrap, so
     measure it and expose it as a custom property the nav offsets against. */
  function initDevBar() {
    var bar = KS.$('.devbar');
    if (!bar) return;
    function measure() {
      document.documentElement.style.setProperty('--devbar-h', bar.offsetHeight + 'px');
    }
    measure();
    window.addEventListener('resize', KS.debounce(measure, 120));
    if (window.ResizeObserver) new ResizeObserver(measure).observe(bar);
  }

  /* ------------------------------------------------------------ navigation */
  function initNav() {
    var nav = KS.$('.nav');
    if (!nav) return;
    var threshold = parseInt(nav.dataset.solidAfter || '40', 10);
    var ticking = false;
    function apply() {
      nav.classList.toggle('nav--solid', window.scrollY > threshold);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(apply); }
    }, { passive: true });
    apply();
  }

  function initDrawer() {
    var burger = KS.$('.nav__burger');
    var drawer = KS.$('.drawer');
    if (!burger || !drawer) return;
    var lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      document.body.classList.add('menu-open');
      document.body.style.overflow = 'hidden';
      burger.setAttribute('aria-expanded', 'true');
      drawer.removeAttribute('aria-hidden');
      var first = drawer.querySelector('a, button');
      if (first) first.focus();
    }
    function close() {
      document.body.classList.remove('menu-open');
      document.body.style.overflow = '';
      burger.setAttribute('aria-expanded', 'false');
      drawer.setAttribute('aria-hidden', 'true');
      if (lastFocus) lastFocus.focus();
    }
    KS.closeDrawer = close;
    burger.addEventListener('click', function () {
      document.body.classList.contains('menu-open') ? close() : open();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) close();
    });
    /* Focus trap */
    drawer.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = KS.$$('a[href], button:not([disabled]), input, select, textarea', drawer)
        .filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    /* Accordion groups */
    KS.$$('.drawer__toggle', drawer).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', on ? 'false' : 'true');
      });
    });
  }

  /* --------------------------------------------------------------- reveal */
  function initReveal() {
    var targets = KS.$$('[data-reveal], [data-reveal-mask], [data-stagger]');
    if (!targets.length) return;
    if (reduceMotion.matches || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var d = parseFloat(el.dataset.revealDelay || '0');
        if (d) setTimeout(function () { el.classList.add('is-in'); }, d * 1000);
        else el.classList.add('is-in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach(function (el) { io.observe(el); });

    /* Failsafe: if anything is still hidden after load and settle (an observer
       that never fired, a page restored while backgrounded), show it. Content
       must never be permanently invisible because an animation did not run. */
    function sweep() {
      targets.forEach(function (el) {
        if (el.classList.contains('is-in')) return;
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in');
      });
    }
    window.addEventListener('load', function () { setTimeout(sweep, 400); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) setTimeout(sweep, 120);
    });
  }

  /* ---------------------------------------------------------- hero rotator */
  function initHero() {
    var rot = KS.$('.hero__rotator');
    if (!rot) return;
    var lines = KS.$$('.hero__line', rot);
    var dots  = KS.$$('.hero__dot');
    if (lines.length < 2) return;
    var i = 0, timer = null;

    function show(n) {
      i = (n + lines.length) % lines.length;
      lines.forEach(function (l, x) { l.classList.toggle('is-active', x === i); });
      dots.forEach(function (d, x) { d.setAttribute('aria-selected', x === i ? 'true' : 'false'); });
    }
    function start() { if (!reduceMotion.matches) timer = setInterval(function () { show(i + 1); }, 4600); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    dots.forEach(function (d, x) {
      d.addEventListener('click', function () { stop(); show(x); start(); });
    });
    document.addEventListener('visibilitychange', function () {
      document.hidden ? stop() : start();
    });
    show(0);
    start();
  }

  /* ------------------------------------------------------- animated stats */
  function initCounters() {
    var els = KS.$$('[data-count]');
    if (!els.length) return;
    if (reduceMotion.matches || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.textContent = el.dataset.countPrefix + KS.num(+el.dataset.count) + el.dataset.countSuffix; });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target, to = +el.dataset.count;
        var pre = el.dataset.countPrefix || '', suf = el.dataset.countSuffix || '';
        var start = null, dur = 1500;
        function step(ts) {
          if (!start) start = ts;
          var p = Math.min((ts - start) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = pre + KS.num(Math.round(to * eased)) + suf;
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
        io.unobserve(el);
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------------------------------------------------- floating contact */
  function initFloatContact() {
    var root = KS.$('.floatc');
    if (!root) return;
    var btn = KS.$('.floatc__btn', root);
    var panel = KS.$('.floatc__panel', root);
    if (!btn || !panel) return;
    function close() { root.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var on = root.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) { var f = panel.querySelector('a, button'); if (f) f.focus(); }
    });
    document.addEventListener('click', function (e) { if (!root.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /* ------------------------------------------------------ page transition */
  function initPageTransition() {
    if (reduceMotion.matches) return;
    var veil = document.createElement('div');
    veil.className = 'veil';
    document.body.appendChild(veil);
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || a.target === '_blank' ||
          /^(mailto:|tel:|sms:|javascript:)/.test(href)) return;
      if (a.origin && a.origin !== location.origin) return;
      if (a.hasAttribute('download')) return;
      /* A link to an anchor on the page we are already on is not a navigation.
         Nothing unloads, so the veil would fade the page to solid navy and stay
         there. Let the browser scroll to it instead. Affects the About nav's
         Giving Back link and the footer's #speaking, #mentorship and #contact
         links whenever they are clicked from their own page. */
      if (a.pathname === location.pathname && a.hash) return;
      e.preventDefault();
      veil.classList.add('is-out');
      setTimeout(function () { location.href = href; }, 240);
    });
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) veil.classList.remove('is-out');
    });
  }

  /* --------------------------------------------------------- favourites */
  var FAV_KEY = 'ks_favourites_v1';
  KS.favourites = {
    all: function () {
      try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; }
    },
    has: function (id) { return this.all().indexOf(id) !== -1; },
    toggle: function (id) {
      var list = this.all(), i = list.indexOf(id), on;
      if (i === -1) { list.push(id); on = true; } else { list.splice(i, 1); on = false; }
      try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) {}
      KS.track('property_favourite', { property_id: id, action: on ? 'add' : 'remove' });
      document.dispatchEvent(new CustomEvent('ks:favourites', { detail: { id: id, on: on, count: list.length } }));
      return on;
    }
  };
  function initFavourites() {
    function sync() {
      KS.$$('.fav[data-id]').forEach(function (b) {
        var on = KS.favourites.has(b.dataset.id);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        var lbl = b.querySelector('.visually-hidden');
        if (lbl) lbl.textContent = (on ? 'Remove ' : 'Save ') + (b.dataset.addr || 'property') +
          (on ? ' from saved properties' : ' to saved properties');
      });
      var c = KS.$$('[data-fav-count]');
      var n = KS.favourites.all().length;
      c.forEach(function (el) { el.textContent = n ? '(' + n + ')' : ''; });
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.fav[data-id]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      KS.favourites.toggle(b.dataset.id);
      sync();
    });
    document.addEventListener('ks:favourites', sync);
    sync();
  }

  /* ------------------------------------------------------------- share */
  function initShare() {
    KS.$$('[data-share]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var url = btn.dataset.shareUrl || location.href;
        var title = btn.dataset.shareTitle || document.title;
        if (navigator.share) {
          navigator.share({ title: title, url: url }).catch(function () {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            var old = btn.dataset.label || btn.textContent;
            btn.dataset.label = old;
            btn.textContent = 'Link copied';
            setTimeout(function () { btn.textContent = old; }, 1900);
          });
        } else {
          window.prompt('Copy this link', url);
        }
      });
    });
  }


  /* ---------------------------------------------------------------- tabs */
  function initTabs() {
    KS.$$('[role="tablist"]').forEach(function (list) {
      var tabs = KS.$$('[role="tab"]', list);
      if (!tabs.length || !tabs[0].getAttribute('aria-controls')) return;
      function select(idx, focus) {
        tabs.forEach(function (t, i) {
          var on = i === idx;
          t.setAttribute('aria-selected', on ? 'true' : 'false');
          t.tabIndex = on ? 0 : -1;
          var panel = document.getElementById(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !on;
        });
        if (focus) tabs[idx].focus();
      }
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { select(i); });
        t.addEventListener('keydown', function (e) {
          var n = null;
          if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
          if (e.key === 'ArrowLeft')  n = (i - 1 + tabs.length) % tabs.length;
          if (e.key === 'Home')       n = 0;
          if (e.key === 'End')        n = tabs.length - 1;
          if (n === null) return;
          e.preventDefault(); select(n, true);
        });
      });
      var start = tabs.findIndex ? tabs.findIndex(function (t) {
        return t.getAttribute('aria-selected') === 'true'; }) : 0;
      select(start < 0 ? 0 : start);
    });
  }

  /* -------------------------------------------------------------- boot */
  function boot() {
    initDevBar(); initNav(); initDrawer(); initReveal(); initHero(); initCounters();
    initFloatContact(); initFavourites(); initShare(); initTabs(); initPageTransition();
    document.documentElement.classList.add('js-ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
