/* Property search, filter, sort, map. Sections 11 and 19.
   Cards are server-rendered by build.py so the listing set is in the HTML for
   crawlers. This module filters and reorders those existing nodes rather than
   re-rendering, and mirrors all filter state into the URL so a search is shareable. */
(function () {
  'use strict';
  var KS = window.KS = window.KS || {};

  var root = document.querySelector('[data-plisting]');
  if (!root) return;

  var dataEl = document.getElementById('ks-properties-data');
  var DATA = [];
  try { DATA = JSON.parse(dataEl.textContent); } catch (e) { DATA = []; }
  var BY_ID = {};
  DATA.forEach(function (p) { BY_ID[p.id] = p; });

  var gridEl    = root.querySelector('[data-pgrid]');
  var cards     = KS.$$('[data-prop-id]', gridEl);
  var countEl   = root.querySelector('[data-result-count]');
  var emptyEl   = root.querySelector('[data-empty]');
  var chipsEl   = root.querySelector('[data-active-chips]');
  var mapEl     = root.querySelector('[data-map]');
  var mapPinsEl = root.querySelector('[data-map-pins]');
  var forms     = KS.$$('[data-filter-form]');
  var sortSel   = root.querySelector('[data-sort]');
  var viewBtns  = KS.$$('[data-view]', root);
  var gridWrap  = root.querySelector('[data-view-grid]');
  var mapWrap   = root.querySelector('[data-view-map]');

  /* Which filters exist, and how each reads from a form control */
  var FIELDS = ['q','listing_type','status','type','min_price','max_price','beds','baths',
                'min_sqft','max_sqft','parking','neighbourhood','open_house','max_dom','sort','view'];

  var LABELS = {
    q:'Search', listing_type:'Type', status:'Status', type:'Property type',
    min_price:'Min price', max_price:'Max price', beds:'Beds', baths:'Baths',
    min_sqft:'Min sq ft', max_sqft:'Max sq ft', parking:'Parking',
    neighbourhood:'Neighbourhood', open_house:'Open house', max_dom:'Days on market'
  };

  /* ------------------------------------------------------------- state */
  function readURL() {
    var p = new URLSearchParams(location.search), s = {};
    FIELDS.forEach(function (f) { if (p.get(f)) s[f] = p.get(f); });
    return s;
  }
  var state = readURL();

  function writeURL(replace) {
    var p = new URLSearchParams();
    FIELDS.forEach(function (f) { if (state[f]) p.set(f, state[f]); });
    var qs = p.toString();
    var url = location.pathname + (qs ? '?' + qs : '');
    if (replace) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
  }

  function syncFormsFromState() {
    forms.forEach(function (form) {
      FIELDS.forEach(function (f) {
        var el = form.elements[f];
        if (!el) return;
        if (el.type === 'checkbox') el.checked = state[f] === '1' || state[f] === 'true';
        else el.value = state[f] || '';
      });
    });
    if (sortSel) sortSel.value = state.sort || 'newest';
  }

  function readStateFromForm(form) {
    FIELDS.forEach(function (f) {
      var el = form.elements[f];
      if (!el) return;
      var v;
      if (el.type === 'checkbox') v = el.checked ? '1' : '';
      else v = (el.value || '').trim();
      if (v) state[f] = v; else delete state[f];
    });
  }

  /* ------------------------------------------------------------ matching */
  function haystack(p) {
    var a = p.address;
    return [a.unit, a.street_number, a.street_name, a.city, a.postal_prefix,
            p.mls_number, p.neighbourhood_name, p.property_type, p.style]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function matches(p) {
    var s = state;
    if (s.q && haystack(p).indexOf(s.q.toLowerCase().trim()) === -1) return false;
    if (s.listing_type && p.listing_type !== s.listing_type) return false;
    if (s.status && p.status !== s.status) return false;
    if (s.type && p.property_type !== s.type) return false;
    if (s.neighbourhood && p.neighbourhood_slug !== s.neighbourhood) return false;
    if (s.min_price && p.price < +s.min_price) return false;
    if (s.max_price && p.price > +s.max_price) return false;
    if (s.beds  && p.bedrooms  < +s.beds)  return false;
    if (s.baths && p.bathrooms < +s.baths) return false;
    if (s.min_sqft && p.square_footage < +s.min_sqft) return false;
    if (s.max_sqft && p.square_footage > +s.max_sqft) return false;
    if (s.parking && p.parking_total < +s.parking) return false;
    if (s.max_dom && p.days_on_market > +s.max_dom) return false;
    if ((s.open_house === '1' || s.open_house === 'true') && !(p.open_houses && p.open_houses.length)) return false;
    return true;
  }

  var SORTS = {
    newest:      function (a, b) { return a.days_on_market - b.days_on_market; },
    oldest:      function (a, b) { return b.days_on_market - a.days_on_market; },
    price_desc:  function (a, b) { return b.price - a.price; },
    price_asc:   function (a, b) { return a.price - b.price; },
    sqft_desc:   function (a, b) { return b.square_footage - a.square_footage; }
  };

  /* -------------------------------------------------------------- chips */
  function renderChips(n) {
    if (!chipsEl) return;
    var html = '';
    FIELDS.forEach(function (f) {
      if (f === 'sort' || f === 'view' || !state[f]) return;
      var v = state[f];
      if (f === 'open_house') v = 'Open house only';
      else if (f === 'min_price' || f === 'max_price') v = KS.money(+v);
      else if (f === 'neighbourhood') {
        var m = DATA.filter(function (p) { return p.neighbourhood_slug === v; })[0];
        v = m ? m.neighbourhood_name : v;
      } else if (f === 'beds')  v = v + '+ beds';
      else if (f === 'baths')   v = v + '+ baths';
      else if (f === 'parking') v = v + '+ parking';
      else if (f === 'max_dom') v = 'Under ' + v + ' days';
      html += '<button type="button" class="chip is-on" data-clear="' + f + '">' +
              KS.esc(LABELS[f] || f) + ': ' + KS.esc(v) +
              '<span class="chip__x" aria-hidden="true">&times;</span>' +
              '<span class="visually-hidden">Remove this filter</span></button>';
    });
    if (html) {
      html += '<button type="button" class="chip" data-clear-all>Clear all</button>';
    }
    chipsEl.innerHTML = html;
    chipsEl.hidden = !html;
  }

  /* -------------------------------------------------------------- apply */
  function apply(opts) {
    opts = opts || {};
    var visible = DATA.filter(matches);
    var sorter = SORTS[state.sort || 'newest'] || SORTS.newest;
    visible.sort(sorter);

    var visIds = {};
    visible.forEach(function (p, idx) { visIds[p.id] = idx; });

    cards.forEach(function (c) {
      var on = visIds.hasOwnProperty(c.dataset.propId);
      c.hidden = !on;
      if (on) c.style.order = visIds[c.dataset.propId];
    });

    if (countEl) {
      countEl.innerHTML = '<strong>' + visible.length + '</strong> ' +
        (visible.length === 1 ? 'property' : 'properties');
    }
    if (emptyEl) emptyEl.hidden = visible.length !== 0;
    if (gridEl)  gridEl.hidden = visible.length === 0;

    renderChips(visible.length);
    renderMap(visible);

    if (!opts.silent) {
      KS.track('property_search', {
        results: visible.length,
        filters: Object.keys(state).filter(function (k) { return k !== 'view'; }).join(',') || 'none'
      });
    }
    return visible;
  }

  /* ---------------------------------------------------------------- map */
  function renderMap(list) {
    if (!mapPinsEl) return;
    if (!list.length) { mapPinsEl.innerHTML = ''; return; }
    var lats = list.map(function (p) { return p.coordinates.lat; });
    var lngs = list.map(function (p) { return p.coordinates.lng; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var padLat = Math.max((maxLat - minLat) * 0.12, 0.004);
    var padLng = Math.max((maxLng - minLng) * 0.12, 0.005);
    minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
    var spanLat = (maxLat - minLat) || 1, spanLng = (maxLng - minLng) || 1;

    mapPinsEl.innerHTML = list.map(function (p) {
      var x = ((p.coordinates.lng - minLng) / spanLng) * 100;
      var y = (1 - (p.coordinates.lat - minLat) / spanLat) * 100;
      var price = p.listing_type === 'lease'
        ? KS.money(p.price) + '/mo'
        : (p.price >= 1000000 ? '$' + (p.price / 1000000).toFixed(2).replace(/0$/, '') + 'M'
                              : '$' + Math.round(p.price / 1000) + 'K');
      return '<a class="mappin" style="left:' + x.toFixed(3) + '%;top:' + y.toFixed(3) + '%" ' +
        'href="' + KS.esc(p.url) + '" data-prop-pin="' + KS.esc(p.id) + '">' +
        '<span class="mappin__label">' + KS.esc(price) + '</span>' +
        '<span class="mappin__stem"></span>' +
        '<span class="visually-hidden">' + KS.esc(p.address_line) + '</span></a>';
    }).join('');
  }

  /* --------------------------------------------------------------- view */
  function setView(v, push) {
    state.view = v === 'map' ? 'map' : '';
    if (!state.view) delete state.view;
    if (gridWrap) gridWrap.hidden = v === 'map';
    if (mapWrap)  mapWrap.hidden  = v !== 'map';
    viewBtns.forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.view === v ? 'true' : 'false');
    });
    if (push) writeURL(true);
  }

  /* ------------------------------------------------------------- events */
  forms.forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      readStateFromForm(form);
      writeURL();
      syncFormsFromState();
      apply();
      document.body.classList.remove('filters-open');
      document.body.style.overflow = '';
      root.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    form.addEventListener('reset', function () {
      setTimeout(function () {
        var view = state.view, sort = state.sort;
        state = {};
        if (view) state.view = view;
        if (sort) state.sort = sort;
        writeURL(); syncFormsFromState(); apply();
      }, 0);
    });
    /* Live filtering on desktop select changes keeps it responsive */
    form.addEventListener('change', function (e) {
      if (!form.dataset.live) return;
      if (e.target.matches('select, input[type=checkbox]')) {
        readStateFromForm(form); writeURL(true); syncFormsFromState(); apply();
      }
    });
    var qIn = form.elements['q'];
    if (qIn && form.dataset.live) {
      qIn.addEventListener('input', KS.debounce(function () {
        readStateFromForm(form); writeURL(true); apply({ silent: true });
      }, 260));
    }
  });

  if (sortSel) sortSel.addEventListener('change', function () {
    state.sort = sortSel.value;
    if (state.sort === 'newest') delete state.sort;
    writeURL(true); apply({ silent: true });
  });

  viewBtns.forEach(function (b) {
    b.addEventListener('click', function () { setView(b.dataset.view, true); });
  });

  if (chipsEl) chipsEl.addEventListener('click', function (e) {
    var one = e.target.closest('[data-clear]');
    var all = e.target.closest('[data-clear-all]');
    if (one) { delete state[one.dataset.clear]; }
    else if (all) {
      var view = state.view, sort = state.sort;
      state = {}; if (view) state.view = view; if (sort) state.sort = sort;
    } else return;
    writeURL(); syncFormsFromState(); apply();
  });

  /* Mobile filter drawer */
  var openBtn = root.querySelector('[data-open-filters]');
  var fdrawer = root.querySelector('.fdrawer');
  if (openBtn && fdrawer) {
    var closeBtns = KS.$$('[data-close-filters]', fdrawer);
    function openF() {
      document.body.classList.add('filters-open');
      document.body.style.overflow = 'hidden';
      openBtn.setAttribute('aria-expanded', 'true');
      fdrawer.removeAttribute('aria-hidden');
      var f = fdrawer.querySelector('input, select, button');
      if (f) f.focus();
    }
    function closeF() {
      document.body.classList.remove('filters-open');
      document.body.style.overflow = '';
      openBtn.setAttribute('aria-expanded', 'false');
      fdrawer.setAttribute('aria-hidden', 'true');
      openBtn.focus();
    }
    openBtn.addEventListener('click', openF);
    closeBtns.forEach(function (b) { b.addEventListener('click', closeF); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('filters-open')) closeF();
    });
  }

  window.addEventListener('popstate', function () {
    state = readURL(); syncFormsFromState();
    setView(state.view === 'map' ? 'map' : 'grid', false);
    apply({ silent: true });
  });

  /* --------------------------------------------------------------- init */
  syncFormsFromState();
  setView(state.view === 'map' ? 'map' : 'grid', false);
  apply({ silent: true });
})();
