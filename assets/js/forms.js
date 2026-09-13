/* Lead capture. Sections 15, 25, 27, 42.
   Every form validates fully client-side, captures its source/page/UTM context,
   and submits through one adapter. If Supabase is not configured the submission
   is queued locally and the UI SAYS SO. It never claims delivery it did not make. */
(function () {
  'use strict';
  var KS = window.KS = window.KS || {};
  var CFG = window.KS_CONFIG || {};
  var SB  = CFG.supabase || {};
  var QUEUE_KEY = 'ks_lead_queue_v1';

  var configured = !!(SB.url && SB.anonKey);
  KS.leadsConfigured = configured;

  /* ------------------------------------------------------------ context */
  function utm() {
    var p = new URLSearchParams(location.search), o = {};
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid']
      .forEach(function (k) { if (p.get(k)) o[k] = p.get(k); });
    return o;
  }
  function context(form) {
    return {
      source: form.dataset.source || 'unknown',
      page_path: location.pathname,
      page_title: document.title,
      referrer: document.referrer || null,
      utm: utm(),
      submitted_at: new Date().toISOString(),
      user_agent: navigator.userAgent
    };
  }

  /* --------------------------------------------------------- validation */
  var RULES = {
    email: {
      test: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()); },
      msg: 'Enter a valid email address.'
    },
    tel: {
      test: function (v) { return v.replace(/[^\d]/g, '').length >= 10; },
      msg: 'Enter a phone number with at least 10 digits.'
    },
    postal: {
      test: function (v) { return /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(v.trim()); },
      msg: 'Enter a valid Canadian postal code.'
    }
  };

  function fieldOf(el) { return el.closest('.field') || el.closest('.optgrid') || el.parentElement; }

  function setError(el, msg) {
    var f = fieldOf(el);
    if (!f) return;
    f.classList.add('is-invalid');
    var e = f.querySelector('.field__error');
    if (!e) {
      e = document.createElement('p');
      e.className = 'field__error';
      e.id = (el.id || el.name || 'f') + '-error';
      f.appendChild(e);
    }
    e.textContent = msg;
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', e.id);
  }
  function clearError(el) {
    var f = fieldOf(el);
    if (!f) return;
    f.classList.remove('is-invalid');
    var e = f.querySelector('.field__error');
    if (e) e.textContent = '';
    el.removeAttribute('aria-invalid');
  }

  function validateField(el) {
    if (el.disabled) return true;
    var v = (el.value || '').trim();
    var required = el.hasAttribute('required');

    if (el.type === 'radio') {
      var group = el.form ? el.form.querySelectorAll('input[name="' + el.name + '"]') : [];
      var any = Array.prototype.some.call(group, function (r) { return r.checked; });
      if (required && !any) { setError(el, el.dataset.error || 'Select an option.'); return false; }
      clearError(el); return true;
    }
    if (el.type === 'checkbox') {
      if (required && !el.checked) { setError(el, el.dataset.error || 'This is required to continue.'); return false; }
      clearError(el); return true;
    }
    if (required && !v) {
      setError(el, el.dataset.error || 'This field is required.');
      return false;
    }
    if (!v) { clearError(el); return true; }

    var rule = el.dataset.rule || (el.type === 'email' ? 'email' : (el.type === 'tel' ? 'tel' : null));
    if (rule && RULES[rule] && !RULES[rule].test(v)) { setError(el, RULES[rule].msg); return false; }
    if (el.minLength > 0 && v.length < el.minLength) {
      setError(el, 'Please enter at least ' + el.minLength + ' characters.'); return false;
    }
    clearError(el); return true;
  }

  function validateScope(scope) {
    var els = Array.prototype.slice.call(
      scope.querySelectorAll('input:not([type=hidden]), select, textarea'));
    var seenRadio = {};
    var ok = true, firstBad = null;
    els.forEach(function (el) {
      if (el.type === 'radio') {
        if (seenRadio[el.name]) return;
        seenRadio[el.name] = true;
      }
      if (!validateField(el)) { ok = false; if (!firstBad) firstBad = el; }
    });
    if (firstBad) {
      firstBad.focus();
      firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return ok;
  }
  KS.validateScope = validateScope;

  /* ------------------------------------------------------------- adapter */
  function queueLocally(table, record) {
    var q = [];
    try { q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) {}
    q.push({ table: table, record: record, queued_at: new Date().toISOString() });
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {}
    return q.length;
  }
  KS.leadQueue = function () {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; }
  };

  /* ------------------------------------------------------- netlify forms */
  var NF = CFG.netlifyForms || {};

  /** Maps whichever internal record shape a visible form produces (the
      progressive inquiry form, the short real-estate form, or the
      consulting form) onto the ten approved Netlify form names and the
      canonical field set the CRM ingestion function reads (see
      lib/validation.ts:RawFormData and NETLIFY_FORMS.md). This is the only
      place that decides "which Netlify form does this submission become" —
      explicit form data decides, nothing here guesses at a person's intent.
      Returns null for a form this mapping does not (yet) cover, in which
      case only the existing Supabase/local-queue path runs, unchanged. */
  function mapToLeadPayload(form, record) {
    var table = form.dataset.table;
    var ctx = record.context || {};
    var utm = ctx.utm || {};
    var nameParts = (record.name || '').trim().split(/\s+/);

    var out = {
      first_name: record.first_name || nameParts[0] || '',
      last_name: record.last_name || nameParts.slice(1).join(' ') || '',
      email: record.email || '',
      phone: record.phone || '',
      message: record.message || record.other_detail || '',
      consent: (record.consent_marketing || record.consent_contact) ? 'true' : '',
      landing_page: ctx.page_path || '',
      page_url: ctx.page_path || '',
      referrer: ctx.referrer || '',
      utm_source: utm.utm_source || '',
      utm_medium: utm.utm_medium || '',
      utm_campaign: utm.utm_campaign || '',
      utm_content: utm.utm_content || '',
      utm_term: utm.utm_term || '',
      submission_timestamp: ctx.submitted_at || new Date().toISOString(),
      site_name: (CFG.contact && CFG.contact.siteName) || ''
    };

    var route = null;

    if (table === 'crm_inquiries') {
      // The progressive form's step-1 "path" choice IS the routing decision.
      var byPath = {
        buy:        { formName: 'real-estate-buyer',     leadType: 'buyer' },
        sell:       { formName: 'real-estate-seller',     leadType: 'seller' },
        invest:     { formName: 'real-estate-investor',   leadType: 'investor' },
        consulting: { formName: 'business-consultation',  leadType: 'consultation' },
        // "Something else": genuinely undetermined. Routed to general-contact
        // with no lead_type on purpose, so it lands in manual review rather
        // than being guessed into a bucket.
        other:      { formName: 'general-contact',        leadType: '' }
      };
      route = byPath[record.path] || byPath.other;
      out.timeline = record.re_timeline || '';
      out.budget = record.re_budget || '';
      out.mortgage_pre_approved = record.re_pre_approved === 'yes' ? 'yes' : 'no';
      out.has_realtor = record.re_has_realtor || '';
      out.property_address = record.re_seller_address || '';
      out.company_name = record.biz_name || '';
      out.company_website = record.biz_website || '';
      out.support_needed_by = record.biz_urgency || '';
      out.challenge = record.biz_challenge || '';
      out.established_company =
        (record.biz_stage === 'established' || record.biz_stage === 'scaling') ? 'yes' : 'no';
    } else if (table === 'leads') {
      // The short real-estate form: "I'm [Buying/Selling/Investing/Not sure yet]".
      var byInterest = {
        Buying:    { formName: 'real-estate-buyer',   leadType: 'buyer' },
        Selling:   { formName: 'real-estate-seller',  leadType: 'seller' },
        Investing: { formName: 'real-estate-investor', leadType: 'investor' }
      };
      route = byInterest[record.interest] ||
        { formName: 'real-estate-consultation', leadType: 'consultation' };
      out.timeline = record.timeline || '';
    } else if (table === 'business_enquiries') {
      // Always the general consulting inbox: this form is a single page, not
      // a set of dedicated strategy/operations/crm-automation pages, so
      // "business-consultation" is the deterministic route for it.
      route = { formName: 'business-consultation', leadType: 'consultation' };
      out.company_name = record.organisation || '';
      out.challenge = record.enquiry_type || '';
      out.timeline = record.timeline || '';
    } else {
      return null;
    }

    out.lead_type = route.leadType;
    return { formName: route.formName, fields: out };
  }

  /** Netlify Forms takes a url-encoded POST to any path on the site, keyed by
      form-name. No credentials, so this works whether or not Supabase exists. */
  function submitToNetlify(formName, fields) {
    var body = new URLSearchParams();
    body.append('form-name', formName);
    Object.keys(fields).forEach(function (k) {
      var v = fields[k];
      if (v === null || v === undefined) return;
      body.append(k, String(v));
    });
    return fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { ok: true, via: 'netlify' };
    }).catch(function (err) {
      return { ok: false, via: 'netlify', error: err.message };
    });
  }

  /** Attempts the Netlify Forms submission for whichever form this is, if
      NF.enabled and mapToLeadPayload recognizes its data-table. Always
      returns an array (possibly empty) suitable for spreading into
      Promise.all alongside the Supabase attempt. */
  function netlifyAttempts(form, record) {
    if (!NF.enabled) return [];
    var mapped = mapToLeadPayload(form, record);
    if (!mapped) return [];
    return [submitToNetlify(mapped.formName, mapped.fields)];
  }

  function submitRecord(table, record) {
    if (!configured) {
      var n = queueLocally(table, record);
      return Promise.resolve({ ok: false, queued: true, count: n });
    }
    return fetch(SB.url.replace(/\/+$/, '') + '/rest/v1/' + table, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB.anonKey,
        'Authorization': 'Bearer ' + SB.anonKey,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(record)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
      return { ok: true };
    }).catch(function (err) {
      queueLocally(table, record);
      return { ok: false, error: err.message, queued: true };
    });
  }
  KS.submitRecord = submitRecord;

  /* ------------------------------------------------------------ messages */
  function statusEl(form) {
    var s = form.querySelector('.formstatus');
    if (!s) {
      s = document.createElement('div');
      s.className = 'formstatus';
      s.setAttribute('role', 'status');
      s.setAttribute('aria-live', 'polite');
      form.appendChild(s);
    }
    return s;
  }
  function say(form, kind, html) {
    var s = statusEl(form);
    s.dataset.kind = kind;
    s.innerHTML = html;
    s.hidden = false;
    s.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function successCopy(form) {
    return form.dataset.success ||
      'Thank you. Your enquiry has been received and Kaylin will be in touch.';
  }
  function notConfiguredCopy(form) {
    var email = (CFG.contact && CFG.contact.email) || '';
    /* Only reached when EVERY delivery path failed. With Netlify Forms enabled
       that means the network call itself did not get through. */
    var msg = '<strong>That did not go through.</strong> Your details passed validation and have been ' +
      'saved in this browser only. They have <em>not</em> reached Kaylin.';
    if (email) {
      msg += ' To reach her now, email <a href="mailto:' + KS.esc(email) + '">' + KS.esc(email) + '</a>.';
    } else {
      msg += ' Add Supabase credentials in <code>data/site.json</code> to enable delivery.';
    }
    return msg;
  }

  /* --------------------------------------------------------- collection */
  function collect(form) {
    var data = {};
    var fd = new FormData(form);
    fd.forEach(function (v, k) {
      if (k.slice(-2) === '[]') {
        var key = k.slice(0, -2);
        (data[key] = data[key] || []).push(v);
      } else if (data.hasOwnProperty(k)) {
        if (!Array.isArray(data[k])) data[k] = [data[k]];
        data[k].push(v);
      } else { data[k] = v; }
    });
    /* Unchecked checkboxes must be recorded as explicit false, not omitted.
       Consent state has to be provable either way. Section 42. */
    Array.prototype.forEach.call(form.querySelectorAll('input[type=checkbox]'), function (c) {
      if (!c.name) return;
      var key = c.name.slice(-2) === '[]' ? c.name.slice(0, -2) : c.name;
      if (c.dataset.consent) data[key] = c.checked;
      else if (!data.hasOwnProperty(key)) data[key] = false;
    });
    return data;
  }

  /* -------------------------------------------------------- single-step */
  function initSimpleForms() {
    KS.$$('form[data-lead]').forEach(function (form) {
      if (form.dataset.multistep === 'true') return;
      form.setAttribute('novalidate', '');

      form.addEventListener('input', function (e) {
        if (e.target.matches('input, select, textarea') && fieldOf(e.target) &&
            fieldOf(e.target).classList.contains('is-invalid')) validateField(e.target);
      });
      form.addEventListener('blur', function (e) {
        if (e.target.matches('input, select, textarea')) validateField(e.target);
      }, true);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!validateScope(form)) {
          say(form, 'err', 'Please correct the highlighted fields and try again.');
          return;
        }
        var btn = form.querySelector('[type=submit]');
        var label = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = 'Sending'; }

        var record = collect(form);
        record.context = context(form);
        var table = form.dataset.table || 'leads';
        var ev = form.dataset.event;

        /* Netlify Forms is the first-party capture path and always works;
           Supabase, if ever configured, is a secondary attempt only. A
           submission counts as delivered if either succeeds. */
        var attempts = netlifyAttempts(form, record);
        attempts.push(submitRecord(table, record));

        Promise.all(attempts).then(function (results) {
          var res = {
            ok: results.some(function (r) { return r.ok; }),
            via: results.filter(function (r) { return r.ok; })
                        .map(function (r) { return r.via || 'supabase'; }).join('+'),
            queued: results.some(function (r) { return r.queued; })
          };
          if (btn) { btn.disabled = false; btn.innerHTML = label; }
          if (ev) KS.track(ev, { source: record.context.source,
                                 delivered: !!res.ok, via: res.via });
          if (res.ok) {
            var file = form.dataset.deliver;
            if (file) {
              say(form, 'ok', successCopy(form) +
                ' <a href="' + KS.esc(file) + '" download style="text-decoration:underline">' +
                'Download it now</a> while you wait.');
            } else {
              say(form, 'ok', successCopy(form));
            }
            form.reset();
            KS.$$('.field.is-invalid', form).forEach(function (f) { f.classList.remove('is-invalid'); });
          } else {
            var f2 = form.dataset.deliver;
            say(form, 'warn', notConfiguredCopy(form) +
              (f2 ? ' The guide itself is ready: <a href="' + KS.esc(f2) + '" download ' +
                    'style="text-decoration:underline">download it directly</a>.' : ''));
          }
        });
      });
    });
  }

  /* ---------------------------------------------------------- multi-step */
  function initMultiStep() {
    KS.$$('form[data-multistep="true"]').forEach(function (form) {
      form.setAttribute('novalidate', '');
      var steps = KS.$$('[data-step]', form);
      if (!steps.length) return;
      var segs  = KS.$$('.progress__seg', form);
      var readout = form.querySelector('[data-step-readout]');
      var backBtn = form.querySelector('[data-back]');
      var nextBtn = form.querySelector('[data-next]');
      var submitBtn = form.querySelector('[type=submit]');
      var i = 0, started = false;

      function render() {
        steps.forEach(function (s, x) { s.hidden = x !== i; });
        segs.forEach(function (s, x) {
          s.classList.toggle('is-done', x < i);
          s.classList.toggle('is-current', x === i);
        });
        if (readout) readout.textContent = 'Step ' + (i + 1) + ' of ' + steps.length;
        if (backBtn) backBtn.hidden = i === 0;
        var last = i === steps.length - 1;
        if (nextBtn) nextBtn.hidden = last;
        if (submitBtn) submitBtn.hidden = !last;
        var h = steps[i].querySelector('h2, h3, [data-step-title]');
        if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
        form.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }

      form.addEventListener('input', function (e) {
        if (!started) {
          started = true;
          if (form.dataset.startEvent) KS.track(form.dataset.startEvent, { source: form.dataset.source });
        }
        if (e.target.matches('input, select, textarea') && fieldOf(e.target) &&
            fieldOf(e.target).classList.contains('is-invalid')) validateField(e.target);
      });

      /* Selecting a radio card advances, which is what makes this feel fast */
      steps.forEach(function (step) {
        if (step.dataset.autoAdvance !== 'true') return;
        step.addEventListener('change', function (e) {
          if (e.target.type !== 'radio') return;
          setTimeout(function () { if (validateScope(steps[i])) { i = Math.min(i + 1, steps.length - 1); render(); } }, 240);
        });
      });

      if (nextBtn) nextBtn.addEventListener('click', function () {
        if (!validateScope(steps[i])) return;
        i = Math.min(i + 1, steps.length - 1); render();
      });
      if (backBtn) backBtn.addEventListener('click', function () {
        i = Math.max(i - 1, 0); render();
      });

      form.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && i < steps.length - 1) {
          e.preventDefault();
          if (validateScope(steps[i])) { i++; render(); }
        }
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var allOk = true;
        for (var x = 0; x < steps.length; x++) {
          if (!validateScope(steps[x])) { i = x; render(); allOk = false; break; }
        }
        if (!allOk) { say(form, 'err', 'Please correct the highlighted fields.'); return; }

        var label = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = 'Sending'; }

        var record = collect(form);
        record.context = context(form);

        submitRecord(form.dataset.table || 'valuation_requests', record).then(function (res) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = label; }
          if (form.dataset.event) KS.track(form.dataset.event, { source: form.dataset.source, delivered: !!res.ok });
          var done = form.querySelector('[data-done]');
          if (res.ok && done) {
            steps.forEach(function (s) { s.hidden = true; });
            if (nextBtn) nextBtn.hidden = true;
            if (backBtn) backBtn.hidden = true;
            if (submitBtn) submitBtn.hidden = true;
            var pr = form.querySelector('.progress'); if (pr) pr.hidden = true;
            done.hidden = false;
            done.setAttribute('tabindex', '-1'); done.focus({ preventScroll: true });
            done.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } else if (res.ok) {
            say(form, 'ok', successCopy(form));
          } else {
            say(form, 'warn', notConfiguredCopy(form));
          }
        });
      });

      render();
    });
  }

  /* ------------------------------------------------------ guide download */
  function initGuideForms() {
    KS.$$('form[data-guide]').forEach(function (form) {
      form.addEventListener('ks:submitted', function () {});
    });
  }

  function boot() { initSimpleForms(); initMultiStep(); initGuideForms(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
