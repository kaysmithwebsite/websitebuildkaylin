/* Mortgage calculator. Section 20. Estimates only, never advice.
   Canadian convention: semi-annual compounding, not in advance. */
(function () {
  'use strict';
  var KS = window.KS = window.KS || {};
  var form = document.querySelector('[data-mortgage]');
  if (!form) return;

  /* Outputs live in the results panel, which is a SIBLING of the form, not a
     descendant. Scope lookups to the shared wrapper, never to the form. */
  var root = form.closest('.calc') || document;
  function el(name) { return root.querySelector('[data-out=' + name + ']'); }
  var out = {
    principal: el('principal'), payment:   el('payment'),
    monthly:   el('monthly'),   interest:  el('interest'),
    total:     el('total'),     insurance: el('insurance'),
    downPct:   el('down_pct'),  freqLabel: el('freq_label')
  };
  var warn = root.querySelector('[data-calc-warning]');

  var FREQ = {
    monthly:      { n: 12, label: 'Monthly payment' },
    semimonthly:  { n: 24, label: 'Semi-monthly payment' },
    biweekly:     { n: 26, label: 'Bi-weekly payment' },
    weekly:       { n: 52, label: 'Weekly payment' },
    accelerated_biweekly: { n: 26, label: 'Accelerated bi-weekly payment', accel: true },
    accelerated_weekly:   { n: 52, label: 'Accelerated weekly payment',    accel: true }
  };

  function val(name) {
    var el = form.elements[name];
    if (!el) return 0;
    var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  /* CMHC premium tiers on the insurable portion. Estimate only. */
  function premiumRate(ltvPct) {
    if (ltvPct <= 80) return 0;
    if (ltvPct <= 85) return 0.028;
    if (ltvPct <= 90) return 0.031;
    return 0.04;
  }

  function minDown(price) {
    if (price <= 500000) return price * 0.05;
    if (price < 1500000) return 25000 + (price - 500000) * 0.10;
    return price * 0.20;
  }

  function calc() {
    var price = val('price');
    var down  = val('down');
    var rate  = val('rate') / 100;
    var years = val('amortization') || 25;
    var fkey  = (form.elements['frequency'] || {}).value || 'monthly';
    var f     = FREQ[fkey] || FREQ.monthly;

    var msgs = [];
    if (price <= 0) { reset(); return; }
    if (down > price) { down = price; msgs.push('Down payment cannot exceed the purchase price.'); }

    var required = minDown(price);
    if (down < required) {
      msgs.push('The minimum down payment for a ' + KS.money(price) + ' purchase is about ' +
        KS.money(required) + '. Results below use the amount you entered.');
    }

    var base = Math.max(price - down, 0);
    var ltv = price > 0 ? (base / price) * 100 : 0;
    var prem = 0;
    if (price < 1500000 && ltv > 80) prem = base * premiumRate(ltv);
    if (ltv > 80 && years > 25) msgs.push('Insured mortgages are generally limited to a 25 year amortization.');

    var principal = base + prem;

    /* Canadian rates compound semi-annually. Convert to the payment period. */
    var periodic = rate > 0 ? Math.pow(1 + rate / 2, 2 / f.n) - 1 : 0;
    var nPay = years * f.n;

    var pay;
    if (f.accel) {
      var mPeriodic = rate > 0 ? Math.pow(1 + rate / 2, 2 / 12) - 1 : 0;
      var nMonthly = years * 12;
      var monthlyPay = mPeriodic > 0
        ? principal * mPeriodic / (1 - Math.pow(1 + mPeriodic, -nMonthly))
        : principal / nMonthly;
      pay = f.n === 26 ? monthlyPay / 2 : monthlyPay / 4;
    } else {
      pay = periodic > 0
        ? principal * periodic / (1 - Math.pow(1 + periodic, -nPay))
        : principal / nPay;
    }

    /* Amortize to get true interest and term for accelerated schedules */
    var bal = principal, interest = 0, count = 0, cap = f.n * 60;
    while (bal > 0.01 && count < cap) {
      var ip = bal * periodic;
      var pp = pay - ip;
      if (pp <= 0) { interest = NaN; break; }
      interest += ip;
      bal -= pp;
      count++;
    }
    var monthlyEquiv = pay * f.n / 12;

    if (out.principal) out.principal.textContent = KS.money(principal);
    if (out.payment)   out.payment.textContent   = KS.money(pay, { cents: true });
    if (out.monthly)   out.monthly.textContent   = KS.money(monthlyEquiv, { cents: true });
    if (out.interest)  out.interest.textContent  = isNaN(interest) ? 'Not payable at this rate' : KS.money(interest);
    if (out.total)     out.total.textContent     = isNaN(interest) ? '' : KS.money(principal + interest);
    if (out.insurance) out.insurance.textContent = prem > 0 ? KS.money(prem) : 'Not applicable';
    if (out.downPct)   out.downPct.textContent   = price > 0 ? (down / price * 100).toFixed(1) + '%' : '';
    if (out.freqLabel) out.freqLabel.textContent = f.label;

    if (warn) {
      warn.innerHTML = msgs.map(function (m) { return '<p>' + KS.esc(m) + '</p>'; }).join('');
      warn.hidden = !msgs.length;
    }
  }

  function reset() {
    Object.keys(out).forEach(function (k) { if (out[k]) out[k].textContent = ''; });
    if (warn) warn.hidden = true;
  }

  /* Keep paired range + number inputs in step */
  KS.$$('[data-sync]', form).forEach(function (el) {
    el.addEventListener('input', function () {
      var partner = form.querySelector('[data-sync="' + el.dataset.sync + '"]:not([id="' + el.id + '"])');
      KS.$$('[data-sync="' + el.dataset.sync + '"]', form).forEach(function (o) {
        if (o !== el) o.value = el.value;
      });
      calc();
    });
  });

  form.addEventListener('input', calc);
  form.addEventListener('change', calc);
  form.addEventListener('submit', function (e) { e.preventDefault(); calc(); });
  calc();
})();
