/* ---------------------------------------------------------------------------
   PROGRESSIVE INQUIRY FORM  (CRM phase 2, sections 3-5)

   Enhancement, not a dependency. Without JavaScript every fieldset is visible
   and the form posts as one long page. This file turns it into four steps,
   shows only the branch the visitor picked, and enforces required fields for
   that branch alone.
   --------------------------------------------------------------------------- */
(function () {
  var KS = window.KS || {};
  var form = document.querySelector('form[data-inquiry]');
  if (!form || !document.documentElement.classList.contains('js')) return;

  var steps   = Array.prototype.slice.call(form.querySelectorAll('.inq__step'));
  var prog    = Array.prototype.slice.call(form.querySelectorAll('.inq__prog-i'));
  var back    = form.querySelector('[data-inq-back]');
  var next    = form.querySelector('[data-inq-next]');
  var send    = form.querySelector('[data-inq-send]');
  var paths   = Array.prototype.slice.call(form.querySelectorAll('input[name="path"]'));
  var branch  = '';
  var index   = 0;

  /* Required attributes are removed up front and restored per branch, so a
     hidden fieldset can never block submission with an invisible error. */
  var required = [];
  steps.forEach(function (s) {
    Array.prototype.forEach.call(s.querySelectorAll('[required]'), function (el) {
      if (el.name === 'path') return;
      required.push(el);
      el.removeAttribute('required');
      el.dataset.wasRequired = '1';
    });
  });

  function visibleSteps() {
    return steps.filter(function (s) {
      var b = s.dataset.branch;
      return !b || b === branch;
    });
  }

  /* Only the step on screen carries required. A required field inside a hidden
     fieldset is still submitted against, and the browser refuses with "an
     invalid form control is not focusable" pointing at something nobody can
     see. Each step is validated as it is left instead. */
  function applyRequired() {
    var current = visibleSteps()[index];
    required.forEach(function (el) {
      var group = el.closest('.inq__when');
      var on = current && current.contains(el) && (!group || !group.hidden);
      if (on) el.setAttribute('required', '');
      else el.removeAttribute('required');
    });
  }

  /* data-show-when="re_intent:sell,buy_and_sell" reveals a group only for
     those answers, which is how the seller questions stay out of a buyer's way. */
  function applyConditionals() {
    Array.prototype.forEach.call(form.querySelectorAll('.inq__when'), function (g) {
      var spec = (g.dataset.showWhen || '').split(':');
      var field = form.querySelector('[name="' + spec[0] + '"]');
      var allowed = (spec[1] || '').split(',');
      g.hidden = !(field && allowed.indexOf(field.value) !== -1);
    });
    applyRequired();
  }

  function render() {
    var vis = visibleSteps();
    if (index >= vis.length) index = vis.length - 1;
    steps.forEach(function (s) { s.hidden = true; });
    if (vis[index]) vis[index].hidden = false;
    prog.forEach(function (p, i) {
      if (i < vis.length) { p.hidden = false; p.toggleAttribute('data-on', i <= index); }
      else p.hidden = true;
    });
    back.hidden = index === 0;
    var last = index === vis.length - 1;
    next.hidden = last;
    send.hidden = !last;
    applyRequired();
    var h = vis[index] && vis[index].querySelector('legend');
    if (h) h.setAttribute('tabindex', '-1'), h.focus({ preventScroll: true });
  }

  function stepValid() {
    var vis = visibleSteps()[index];
    if (!vis) return true;
    if (KS.validateScope) return KS.validateScope(vis);
    return vis.querySelectorAll(':invalid').length === 0;
  }

  paths.forEach(function (r) {
    r.addEventListener('change', function () {
      branch = r.dataset.branch || '';
      form.dataset.branch = branch;
      applyConditionals();
    });
  });

  form.addEventListener('change', function (e) {
    if (e.target && e.target.name === 're_intent') applyConditionals();
  });

  next.addEventListener('click', function () {
    if (!stepValid()) return;
    index++; render();
    form.scrollIntoView({ block: 'nearest' });
  });
  back.addEventListener('click', function () {
    index--; render();
    form.scrollIntoView({ block: 'nearest' });
  });

  /* A deep link such as /contact/#consulting preselects that path, so every
     existing link into this page still lands somewhere meaningful. */
  var target = null;
  if (location.hash && location.hash.length > 1) {
    /* A hash can be anything, including something that is not a valid selector,
       so this is guarded rather than trusted. */
    try { target = document.querySelector('span.anchor' + location.hash); }
    catch (err) { target = null; }
  }
  if (target && target.dataset.preselect) {
    var pre = paths.filter(function (p) { return p.value === target.dataset.preselect; })[0];
    if (pre) { pre.checked = true; branch = pre.dataset.branch || ''; form.dataset.branch = branch; }
  }

  applyConditionals();
  render();
})();
