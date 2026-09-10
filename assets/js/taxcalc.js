/* Land transfer tax and buying cost calculators. Sections 51, 54, 55.
   All rates come from data/tax-rates.json via KS_RATES. Nothing fiscal is
   hard-coded here, so a rate change is a data edit, not a code change. */
(function () {
  'use strict';
  var KS = window.KS = window.KS || {};
  var R  = window.KS_RATES;
  if (!R) return;

  /* Marginal brackets: each rate applies only to the slice inside its band. */
  function bracketTax(price, brackets) {
    var tax = 0, lower = 0, i, b, upper, slice;
    for (i = 0; i < brackets.length; i++) {
      b = brackets[i];
      upper = b.up_to === null ? Infinity : b.up_to;
      if (price <= lower) break;
      slice = Math.min(price, upper) - lower;
      if (slice > 0) tax += slice * b.rate;
      lower = upper;
    }
    return tax;
  }

  KS.landTransferTax = function (price, inToronto, firstTime) {
    var on = R.land_transfer_tax.ontario;
    var to = R.land_transfer_tax.toronto;
    var out = {
      price: price,
      ontario: bracketTax(price, on.brackets),
      toronto: inToronto ? bracketTax(price, to.brackets) : 0,
      ontarioRebate: 0, torontoRebate: 0
    };
    if (firstTime) {
      out.ontarioRebate = Math.min(out.ontario, on.first_time_buyer_rebate.max);
      if (inToronto) out.torontoRebate = Math.min(out.toronto, to.first_time_buyer_rebate.max);
    }
    out.grossTotal = out.ontario + out.toronto;
    out.rebateTotal = out.ontarioRebate + out.torontoRebate;
    out.total = Math.max(0, out.grossTotal - out.rebateTotal);
    return out;
  };

  KS.minimumDownPayment = function (price) {
    var m = R.mortgage.minimum_down_payment;
    if (price <= m.tier_1_limit) return price * m.tier_1_rate;
    if (price < m.tier_2_limit) {
      return m.tier_1_limit * m.tier_1_rate + (price - m.tier_1_limit) * m.tier_2_rate;
    }
    return price * m.tier_3_rate;
  };

  function num(form, name) {
    var el = form.elements[name];
    if (!el) return 0;
    var v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ''));
    return isNaN(v) ? 0 : v;
  }
  function checked(form, name) {
    var el = form.elements[name];
    if (!el) return false;
    if (el.length) {
      for (var i = 0; i < el.length; i++) if (el[i].checked) return el[i].value === 'yes' || el[i].value === 'toronto';
      return false;
    }
    return el.checked;
  }
  function radioValue(form, name) {
    var el = form.elements[name];
    if (!el) return '';
    if (el.length) { for (var i = 0; i < el.length; i++) if (el[i].checked) return el[i].value; return ''; }
    return el.value;
  }

  function setOut(root, key, value) {
    var el = root.querySelector('[data-out="' + key + '"]');
    if (el) el.textContent = value;
  }
  function showRow(root, key, on) {
    var el = root.querySelector('[data-row="' + key + '"]');
    if (el) el.hidden = !on;
  }

  /* ---------------------------------------------- land transfer tax page */
  var lttForm = document.querySelector('[data-ltt]');
  if (lttForm) {
    var lttRoot = lttForm.closest('.calc') || document;
    var run = function () {
      var price = num(lttForm, 'price');
      var loc = radioValue(lttForm, 'location');
      var ft = radioValue(lttForm, 'first_time') === 'yes';
      if (price <= 0) {
        ['ontario','toronto','rebate','total','price'].forEach(function (k) { setOut(lttRoot, k, ''); });
        return;
      }
      var r = KS.landTransferTax(price, loc === 'toronto', ft);
      setOut(lttRoot, 'price', KS.money(r.price));
      setOut(lttRoot, 'ontario', KS.money(r.ontario));
      setOut(lttRoot, 'toronto', KS.money(r.toronto));
      setOut(lttRoot, 'rebate', r.rebateTotal > 0 ? '- ' + KS.money(r.rebateTotal) : KS.money(0));
      setOut(lttRoot, 'total', KS.money(r.total));
      showRow(lttRoot, 'toronto', loc === 'toronto');
      showRow(lttRoot, 'rebate', r.rebateTotal > 0);
      var note = lttRoot.querySelector('[data-ltt-note]');
      if (note) {
        var bits = [];
        if (loc === 'toronto') bits.push('Toronto purchasers pay the municipal tax in addition to the provincial one.');
        if (ft && r.rebateTotal > 0) bits.push('First-time buyer rebates of ' + KS.money(r.rebateTotal) + ' have been applied.');
        if (ft && r.rebateTotal === 0) bits.push('No rebate applies at this price.');
        note.innerHTML = bits.map(function (t) { return '<p>' + KS.esc(t) + '</p>'; }).join('');
        note.hidden = !bits.length;
      }
      KS.track('calculator_used', { calculator: 'land_transfer_tax', price: price });
    };
    lttForm.addEventListener('input', run);
    lttForm.addEventListener('change', run);
    lttForm.addEventListener('submit', function (e) { e.preventDefault(); run(); });

    /* Section 55: accept a price and location handed over from a listing. */
    var q = new URLSearchParams(location.search);
    if (q.get('purchase_price')) lttForm.elements['price'].value = q.get('purchase_price');
    if (q.get('location')) {
      var loc = q.get('location');
      var radios = lttForm.elements['location'];
      for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === loc;
    }
    run();
  }

  /* ------------------------------------------------- affordability page */
  /* Canadian lenders apply two debt service ratios and qualify at a stress-test
     rate rather than the contract rate. Both are applied here; the lower answer
     is the binding one, which is what a lender would actually offer. */
  var GDS = 0.39, TDS = 0.44, STRESS_FLOOR = 5.25, STRESS_MARGIN = 2.0;

  var affForm = document.querySelector('[data-affordability]');
  if (affForm) {
    var affRoot = affForm.closest('.calc') || document;
    var runAff = function () {
      var income = num(affForm, 'income');
      var debts  = num(affForm, 'debts');
      var down   = num(affForm, 'down');
      var rate   = num(affForm, 'rate');
      var tax    = num(affForm, 'tax');
      var condo  = num(affForm, 'condo');
      if (income <= 0) return;

      var qualRate = Math.max(STRESS_FLOOR, rate + STRESS_MARGIN) / 100;
      var monthlyIncome = income / 12;

      /* Half of a condo fee counts toward housing costs, plus a heat allowance. */
      var heat = 100;
      var housingOther = tax + (condo / 2) + heat;

      var gdsRoom = monthlyIncome * GDS - housingOther;
      var tdsRoom = monthlyIncome * TDS - housingOther - debts;
      var payRoom = Math.min(gdsRoom, tdsRoom);
      var binding = (gdsRoom <= tdsRoom) ? 'Gross Debt Service' : 'Total Debt Service';

      var maxPrice = 0, maxMortgage = 0;
      if (payRoom > 0) {
        var per = Math.pow(1 + qualRate / 2, 2 / 12) - 1;   /* semi-annual */
        var n = 25 * 12;
        maxMortgage = per > 0 ? payRoom * (1 - Math.pow(1 + per, -n)) / per : payRoom * n;
        maxPrice = maxMortgage + down;

        /* A price above the tiered minimum needs a bigger down payment, which
           lowers the price the same down payment can actually reach. */
        for (var i = 0; i < 30; i++) {
          var need = KS.minimumDownPayment(maxPrice);
          if (down >= need) break;
          maxPrice = Math.max(0, maxPrice - (need - down));
          maxMortgage = Math.max(0, maxPrice - down);
        }
      }

      setOut(affRoot, 'max_price', KS.money(Math.max(0, maxPrice)));
      setOut(affRoot, 'max_mortgage', KS.money(Math.max(0, maxMortgage)));
      setOut(affRoot, 'aff_payment', payRoom > 0 ? KS.money(payRoom, { cents: true }) : KS.money(0));
      setOut(affRoot, 'binding', payRoom > 0 ? binding : 'Income does not cover housing costs');
      setOut(affRoot, 'min_down', KS.money(KS.minimumDownPayment(Math.max(0, maxPrice))));

      var w = affRoot.querySelector('[data-aff-warning]');
      if (w) {
        var msgs = [];
        msgs.push('Qualified at ' + (qualRate * 100).toFixed(2) +
                  '%, the greater of the benchmark rate and your rate plus two percent.');
        if (payRoom <= 0) {
          msgs.push('At this income, property tax and existing debt, no mortgage payment fits ' +
                    'inside the lending ratios.');
        }
        if (down > 0 && maxPrice > 0 && down / maxPrice < 0.20) {
          msgs.push('Under twenty percent down, mortgage default insurance applies and is added ' +
                    'to the mortgage.');
        }
        w.innerHTML = msgs.map(function (t) { return '<p>' + KS.esc(t) + '</p>'; }).join('');
        w.hidden = !msgs.length;
      }
      KS.track('calculator_used', { calculator: 'affordability' });
    };
    affForm.addEventListener('input', runAff);
    affForm.addEventListener('change', runAff);
    affForm.addEventListener('submit', function (e) { e.preventDefault(); runAff(); });
    runAff();
  }

  /* -------------------------------------------------- buying costs page */
  var bcForm = document.querySelector('[data-buying-costs]');
  if (bcForm) {
    var bcRoot = bcForm.closest('.calc') || document;
    var runBC = function () {
      var price = num(bcForm, 'price');
      var down = num(bcForm, 'down');
      var loc = radioValue(bcForm, 'location');
      var ft = radioValue(bcForm, 'first_time') === 'yes';
      if (price <= 0) return;

      var ltt = KS.landTransferTax(price, loc === 'toronto', ft);
      var legal = num(bcForm, 'legal');
      var inspection = num(bcForm, 'inspection');
      var other = num(bcForm, 'other');
      var total = down + ltt.total + legal + inspection + other;

      setOut(bcRoot, 'down', KS.money(down));
      setOut(bcRoot, 'ltt', KS.money(ltt.total));
      setOut(bcRoot, 'legal', KS.money(legal));
      setOut(bcRoot, 'inspection', KS.money(inspection));
      setOut(bcRoot, 'other', KS.money(other));
      setOut(bcRoot, 'total', KS.money(total));
      setOut(bcRoot, 'mortgage', KS.money(Math.max(0, price - down)));

      var minDown = KS.minimumDownPayment(price);
      var warn = bcRoot.querySelector('[data-bc-warning]');
      if (warn) {
        var msgs = [];
        if (down < minDown) {
          msgs.push('The minimum down payment for a ' + KS.money(price) + ' purchase is about ' +
                    KS.money(minDown) + '. The figures below use the amount you entered.');
        }
        if (down > 0 && price > 0 && down / price < 0.20) {
          msgs.push('Below twenty percent down, mortgage default insurance applies. It is added to ' +
                    'the mortgage rather than paid in cash, so it is not counted in the cash total below.');
        }
        warn.innerHTML = msgs.map(function (t) { return '<p>' + KS.esc(t) + '</p>'; }).join('');
        warn.hidden = !msgs.length;
      }
      KS.track('calculator_used', { calculator: 'buying_costs', price: price });
    };
    bcForm.addEventListener('input', runBC);
    bcForm.addEventListener('change', runBC);
    bcForm.addEventListener('submit', function (e) { e.preventDefault(); runBC(); });

    var q2 = new URLSearchParams(location.search);
    if (q2.get('purchase_price')) {
      var incoming = +q2.get('purchase_price');
      bcForm.elements['price'].value = incoming;
      /* The down payment field ships with a default tied to the default price.
         When a price arrives from a listing that default is stale, so reset it
         to twenty percent of the incoming price, which also avoids a spurious
         default-insurance warning. */
      var dp = bcForm.elements['down'];
      if (dp) dp.value = Math.round(incoming * 0.20);
    }
    if (q2.get('location')) {
      var rr = bcForm.elements['location'];
      for (var j = 0; j < rr.length; j++) rr[j].checked = rr[j].value === q2.get('location');
    }
    runBC();
  }
})();
