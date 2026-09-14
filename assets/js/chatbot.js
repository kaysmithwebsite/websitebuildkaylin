/* Website chatbot widget. See CHATBOT.md.
   Opens from the existing "Let's Talk" floating menu (a [data-chat-open]
   row inside .floatc__panel, added in build.py:floatc_html) rather than a
   second floating bubble. Talks only to /api/chat (netlify/functions/chat.mts)
   — the Anthropic API key never reaches this file or the network tab. */
(function () {
  'use strict';
  var KS = window.KS = window.KS || {};

  var WELCOME =
    'Hi! I’m Kaylin’s website assistant. I can help with real estate services, ' +
    'business consulting, service areas, government programs, pricing questions and getting started. ' +
    'What can I help you with?';

  var QUICK_ACTIONS = [
    { label: 'Start services', prompt: 'I’d like to get started.' },
    { label: 'Real estate services', prompt: 'What real estate services do you offer?' },
    { label: 'Business consulting', prompt: 'What does Kay Smith Consulting Group do?' },
    { label: 'Areas served', prompt: 'What areas do you serve?' },
    { label: 'Government programs', prompt: 'Tell me about government programs for buyers.' },
    { label: 'Pricing', prompt: 'What are your rates?' },
    { label: 'Book a consultation', prompt: 'I’d like to book a consultation.' },
    { label: 'Something else', prompt: 'I have a different question.' }
  ];

  var LEAD_TYPE_OPTIONS = [
    { value: 'buyer', label: 'Buying a home', line: 'real_estate' },
    { value: 'seller', label: 'Selling a home', line: 'real_estate' },
    { value: 'investor', label: 'Investing in property', line: 'real_estate' },
    { value: 'home_valuation', label: 'Home valuation', line: 'real_estate' },
    { value: 'real_estate_consultation', label: 'Real estate — general question', line: 'real_estate' },
    { value: 'business_consultation', label: 'Business consulting', line: 'business_consulting' }
  ];

  var MAX_HISTORY_TURNS = 10; // sent to the server; well under the endpoint's own cap

  function init() {
    var root = KS.$('.chatw');
    var openBtn = KS.$('[data-chat-open]');
    if (!root || !openBtn) return;

    var panel = KS.$('.chatw__panel', root);
    var closeBtn = KS.$('.chatw__close', root);
    var body = KS.$('#chatw-body', root);
    var quick = KS.$('#chatw-quick', root);
    var leadWrap = KS.$('#chatw-lead', root);
    var form = KS.$('#chatw-form', root);
    var input = KS.$('#chatw-input', root);

    var history = [];      // [{role, content}], capped, sent to the server
    var transcript = [];   // every visitor message, for the lead form's summary
    var opened = false;
    var leadOffered = false;

    /* -------------------------------------------------------------- utm */
    function utm() {
      var p = new URLSearchParams(location.search), o = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
        .forEach(function (k) { if (p.get(k)) o[k] = p.get(k); });
      return o;
    }

    /* ----------------------------------------------------------- panel */
    function openChat() {
      root.hidden = false;
      // rAF so the hidden->visible change paints before the transition runs
      requestAnimationFrame(function () { root.classList.add('is-open'); });
      var floatc = document.querySelector('.floatc');
      if (floatc) floatc.classList.remove('is-open');
      if (!opened) {
        opened = true;
        addMessage('assistant', WELCOME);
        renderQuickActions();
        KS.track('chat_opened', {});
      }
      setTimeout(function () { input.focus(); }, 50);
    }
    function closeChat() {
      root.classList.remove('is-open');
      setTimeout(function () { root.hidden = true; }, 200);
      openBtn.focus();
    }
    openBtn.addEventListener('click', function (e) { e.stopPropagation(); openChat(); });
    closeBtn.addEventListener('click', closeChat);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.classList.contains('is-open')) closeChat();
    });
    // Don't let a click inside the panel bubble to app.js's
    // "click outside .floatc closes it" handler and re-open confusion.
    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    /* --------------------------------------------------------- messages */
    function addMessage(role, text, kind) {
      var div = document.createElement('div');
      div.className = 'chatw__msg chatw__msg--' + (kind || role);
      div.textContent = text;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
      return div;
    }
    function addTyping() {
      var div = addMessage('assistant', 'Thinking…', 'typing');
      div.setAttribute('aria-hidden', 'true');
      return div;
    }

    function renderQuickActions() {
      quick.innerHTML = '';
      QUICK_ACTIONS.forEach(function (qa) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = qa.label;
        btn.addEventListener('click', function () { sendMessage(qa.prompt); });
        quick.appendChild(btn);
      });
    }
    function clearQuickActions() { quick.innerHTML = ''; }

    function offerLeadCapture() {
      if (leadOffered) return;
      leadOffered = true;
      var wrap = document.createElement('div');
      wrap.className = 'chatw__msg chatw__msg--assistant';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Share your contact info →';
      btn.style.cssText = 'font-weight:600;text-decoration:underline;';
      btn.addEventListener('click', function () { showLeadForm(); wrap.remove(); });
      wrap.appendChild(document.createTextNode('Want the team to follow up? '));
      wrap.appendChild(btn);
      body.appendChild(wrap);
      body.scrollTop = body.scrollHeight;
    }

    /* ------------------------------------------------------------ send */
    function sendMessage(text) {
      text = (text || '').trim();
      if (!text) return;
      clearQuickActions();
      addMessage('user', text);
      transcript.push(text);
      history.push({ role: 'user', content: text });
      if (history.length > MAX_HISTORY_TURNS * 2) history = history.slice(-MAX_HISTORY_TURNS * 2);

      var typingEl = addTyping();
      form.querySelector('button').disabled = true;

      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: history.slice(0, -1), // server gets prior turns + this message separately
          pageUrl: location.pathname
        })
      }).then(function (r) {
        if (!r.ok && r.status !== 429) throw new Error('http ' + r.status);
        return r.json();
      }).then(function (data) {
        typingEl.remove();
        form.querySelector('button').disabled = false;
        if (!data || typeof data.reply !== 'string') throw new Error('bad response shape');
        addMessage('assistant', data.reply);
        history.push({ role: 'assistant', content: data.reply });
        if (data.escalate) {
          KS.track('human_escalation', {});
          offerLeadCapture();
        } else {
          KS.track('faq_question', {});
        }
        if (data.suggestLead) offerLeadCapture();
      }).catch(function () {
        typingEl.remove();
        form.querySelector('button').disabled = false;
        addMessage('assistant',
          'Sorry, I’m having trouble answering right now. I can still help you send a message to our team.',
          'error');
        KS.track('human_escalation', { reason: 'ai_failure' });
        offerLeadCapture();
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      sendMessage(input.value);
      input.value = '';
      input.style.height = 'auto';
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 88) + 'px';
    });

    /* ------------------------------------------------------- lead form */
    function fieldOptionsHtml() {
      return LEAD_TYPE_OPTIONS.map(function (o) {
        return '<option value="' + o.value + '">' + KS.esc(o.label) + '</option>';
      }).join('');
    }

    function showLeadForm() {
      KS.track('lead_flow_started', {});
      var summary = transcript.slice(-6).join(' / ');
      leadWrap.innerHTML =
        '<h3>Get in touch</h3>' +
        '<div class="fgrid">' +
          '<div><label for="cw-fn">First name</label><input id="cw-fn" name="first_name" required autocomplete="given-name"></div>' +
          '<div><label for="cw-ln">Last name</label><input id="cw-ln" name="last_name" autocomplete="family-name"></div>' +
        '</div>' +
        '<div class="fgrid">' +
          '<div><label for="cw-em">Email</label><input id="cw-em" name="email" type="email" required autocomplete="email"></div>' +
          '<div><label for="cw-ph">Phone</label><input id="cw-ph" name="phone" type="tel" autocomplete="tel"></div>' +
        '</div>' +
        '<div class="fgrid">' +
          '<div><label for="cw-loc">Location / area</label><input id="cw-loc" name="location"></div>' +
          '<div><label for="cw-int">What you’re interested in</label>' +
            '<select id="cw-int" name="lead_type">' + fieldOptionsHtml() + '</select></div>' +
        '</div>' +
        '<div><label for="cw-msg">Your question</label><textarea id="cw-msg" name="message">' +
          KS.esc(summary) + '</textarea></div>' +
        '<label class="consent"><input type="checkbox" name="consent" value="true" required>' +
          '<span>Kaylin’s team may contact me about this enquiry.</span></label>' +
        '<div class="chatw__lead-status" aria-live="polite"></div>' +
        '<div class="actions">' +
          '<button type="button" class="cancel">Cancel</button>' +
          '<button type="button" class="submit">Send</button>' +
        '</div>';
      leadWrap.hidden = false;
      leadWrap.querySelector('.cancel').addEventListener('click', function () {
        leadWrap.hidden = true; leadWrap.innerHTML = '';
      });
      leadWrap.querySelector('.submit').addEventListener('click', submitLead);
      body.scrollTop = body.scrollHeight;
    }

    function submitLead() {
      var statusEl = leadWrap.querySelector('.chatw__lead-status');
      var submitBtn = leadWrap.querySelector('.submit');
      var get = function (name) { var el = leadWrap.querySelector('[name="' + name + '"]'); return el ? el.value : ''; };
      var firstName = get('first_name').trim();
      var email = get('email').trim();
      var consent = leadWrap.querySelector('[name="consent"]').checked;
      if (!firstName || !email || !consent) {
        statusEl.textContent = 'First name, email and consent are required.';
        return;
      }
      var leadType = get('lead_type');
      var line = (LEAD_TYPE_OPTIONS.filter(function (o) { return o.value === leadType; })[0] || {}).line || '';

      var body_ = new URLSearchParams();
      body_.append('form-name', 'chatbot-intake');
      body_.append('lead_source', 'website_chatbot');
      body_.append('business_line', line);
      body_.append('lead_type', leadType);
      body_.append('first_name', firstName);
      body_.append('last_name', get('last_name').trim());
      body_.append('email', email);
      body_.append('phone', get('phone').trim());
      body_.append('location', get('location').trim());
      body_.append('message', get('message').trim());
      body_.append('conversation_summary', transcript.join(' / ').slice(0, 1500));
      body_.append('consent', 'true');
      body_.append('page_url', location.pathname);
      body_.append('referrer', document.referrer || '');
      body_.append('submission_timestamp', new Date().toISOString());
      var u = utm();
      Object.keys(u).forEach(function (k) { body_.append(k, u[k]); });

      submitBtn.disabled = true;
      statusEl.textContent = 'Sending…';

      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body_.toString()
      }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        leadWrap.hidden = true;
        leadWrap.innerHTML = '';
        addMessage('assistant',
          'Thanks — that’s been sent to the team. Kaylin (or the right person on the team) will be in touch.');
        KS.track('lead_submitted', { lead_type: leadType });
      }).catch(function () {
        submitBtn.disabled = false;
        statusEl.textContent =
          'That didn’t go through. You can also reach the team directly at info@kaylinsmith.com.';
      });
    }

    window.addEventListener('pageshow', function () {
      // Nothing persisted across page loads by design — a fresh page is a
      // fresh conversation. This just guards against a bfcache restore
      // leaving the panel visually open with stale state.
      if (root.classList.contains('is-open')) closeChat();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
