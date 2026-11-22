(function () {
  'use strict';

  var TOKEN_KEY = 'mers_token';
  var STATUS = {
    active: { label: 'فعال', tone: 'ok' },
    end_of_time: { label: 'منقضی', tone: 'bad' },
    end_of_volume: { label: 'پایان حجم', tone: 'warn' },
    sendedwarn: { label: 'هشدار', tone: 'warn' },
    send_on_hold: { label: 'در انتظار', tone: 'info' },
    on_hold: { label: 'متصل نشده', tone: 'warn' },
    disabled: { label: 'غیرفعال', tone: 'muted' },
    Unknown: { label: 'نامشخص', tone: 'muted' },
    Unsuccessful: { label: 'نامشخص', tone: 'muted' }
  };
  var ROOTS = ['home', 'services', 'shop', 'account'];

  var state = { me: null, info: null, invoices: [], meta: null, config: null };
  var initData = '';
  var content = null;
  var toastTimer = null;
  var servicesState = null;
  var shop = null;
  var wallet = null;
  var testFlow = null;
  var serviceConfigPages = [];
  var support = null;
  var supportTimer = null;
  var extendFlow = null;
  var orderWatch = null;
  var orderTimer = null;
  var ORDER_KEY = 'mersPendingOrder';

  var nf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function fmt(value) {
    var number = Number(value);
    return Number.isFinite(number) ? nf.format(number) : esc(value);
  }

  function toman(value) {
    return fmt(value) + ' <small>تومان</small>';
  }

  function validCustomUsername(value) {
    var name = String(value || '').trim();
    return /^[a-z][a-z\d_]{2,32}$/i.test(name) && name.charAt(name.length - 1) !== '_';
  }

  function chip(status) {
    var info = STATUS[status] || { label: status || 'نامشخص', tone: 'muted' };
    return '<span class="chip ' + info.tone + '">' + esc(info.label) + '</span>';
  }

  function tg() {
    return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  }

  function currentTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    try {
      var saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (error) {}
    return 'dark';
  }

  function applyTheme(theme, persist) {
    var mode = theme === 'light' ? 'light' : 'dark';
    var color = mode === 'light' ? '#f3f7ff' : '#050b17';
    document.documentElement.setAttribute('data-theme', mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', color);
    var btn = qs('#theme-toggle');
    if (btn) btn.setAttribute('aria-pressed', mode === 'light' ? 'true' : 'false');
    var app = tg();
    if (app) {
      try {
        app.setHeaderColor(color);
        app.setBackgroundColor(color);
      } catch (error) {}
    }
    if (persist) {
      try { localStorage.setItem('theme', mode); } catch (error) {}
    }
  }

  function haptic(type) {
    try {
      var h = tg() && tg().HapticFeedback;
      if (!h) return;
      if (type === 'success' || type === 'error') h.notificationOccurred(type);
      else h.impactOccurred(type || 'light');
    } catch (error) {}
  }

  function openLink(url) {
    if (!url) return;
    try {
      if (tg() && tg().openLink) tg().openLink(url);
      else window.open(url, '_blank', 'noopener');
    } catch (error) {
      window.location.href = url;
    }
  }

  function copyText(text) {
    if (!text) return Promise.resolve(false);
    var fallback = function () { return Promise.resolve(legacyCopy(text)); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return Promise.race([
        navigator.clipboard.writeText(text).then(function () { return true; }, fallback),
        new Promise(function (resolve) {
          window.setTimeout(function () { resolve(legacyCopy(text)); }, 700);
        })
      ]);
    }
    return fallback();
  }

  function legacyCopy(text) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.top = '0';
      area.style.left = '0';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.focus();
      area.select();
      area.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  function toast(message) {
    var node = qs('.toast');
    if (!node) {
      node = document.createElement('div');
      node.className = 'toast';
      document.body.appendChild(node);
    }
    node.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { node.remove(); }, 1900);
  }

  function token() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  async function parse(response) {
    var data = null;
    try {
      data = await response.json();
    } catch (error) {}
    if (!response.ok || !data || data.status === false) {
      var problem = new Error((data && data.msg) || 'خطا در ارتباط با سرور');
      problem.status = response.status;
      throw problem;
    }
    return data;
  }

  async function verify(data) {
    var response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: data })
    });
    var payload = await parse(response);
    sessionStorage.setItem(TOKEN_KEY, payload.token);
    return payload;
  }

  async function refreshSession() {
    if (initData) await verify(initData);
  }

  async function apiGet(action, params, retry) {
    var query = new URLSearchParams({ actions: action });
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    var response = await fetch('/api/miniapp?' + query.toString(), {
      headers: { Authorization: 'Bearer ' + token() }
    });
    try {
      return await parse(response);
    } catch (error) {
      if (retry !== false && (error.status === 401 || error.status === 403)) {
        await refreshSession();
        return apiGet(action, params, false);
      }
      throw error;
    }
  }

  async function apiPost(action, body, retry) {
    var response = await fetch('/api/miniapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify(Object.assign({ actions: action }, body || {}))
    });
    try {
      return await parse(response);
    } catch (error) {
      if (retry !== false && (error.status === 401 || error.status === 403)) {
        await refreshSession();
        return apiPost(action, body, false);
      }
      throw error;
    }
  }

  function go(path) {
    window.location.hash = path;
  }

  function parseRoute() {
    var parts = (window.location.hash || '').replace(/^#/, '').split('/').filter(Boolean);
    if (!parts.length) return { name: 'home' };
    if (parts[0] === 'service' && parts[1]) return { name: 'service', username: decodeURIComponent(parts[1]) };
    if (ROOTS.indexOf(parts[0]) !== -1) return { name: parts[0] };
    return { name: 'home' };
  }

  function spinner(label) {
    return '<div class="center-box"><span class="spinner"></span><p class="mut">' + esc(label || 'در حال بارگذاری…') + '</p></div>';
  }

  function errorBox(message) {
    return '<div class="center-box"><div class="error-ic">×</div><b>تایید ناموفق</b><p class="mut">' +
      esc(message) + '</p><button class="btn primary" data-reload>تلاش مجدد</button></div>';
  }

  function emptyBox(title, sub, extra) {
    return '<div class="empty"><div class="empty-ic">✦</div><b>' + esc(title) + '</b>' +
      (sub ? '<p class="mut">' + esc(sub) + '</p>' : '') + (extra || '') + '</div>';
  }

  function sectionTitle(title, sub, action) {
    return '<div class="section-title"><div><h2>' + esc(title) + '</h2>' +
      (sub ? '<p class="mut">' + esc(sub) + '</p>' : '') + '</div>' + (action || '') + '</div>';
  }

  function shell() {
    var app = qs('#app');
    app.innerHTML =
      '<div class="app">' +
        '<div class="orbs" aria-hidden="true"><span class="orb o1"></span><span class="orb o2"></span></div>' +
        '<header class="app-header">' +
          '<a class="brand" href="#/" aria-label="MersConnect">' +
            '<svg viewBox="0 0 64 64" class="logo-mark" aria-hidden="true">' +
              '<defs><linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">' +
                '<stop offset="0" stop-color="#6cc4ff"></stop><stop offset="1" stop-color="#1565d8"></stop>' +
              '</linearGradient></defs>' +
              '<circle cx="32" cy="32" r="22" fill="none" stroke="url(#logo-gradient)" stroke-width="1.8"></circle>' +
              '<ellipse cx="32" cy="32" rx="29" ry="10" transform="rotate(-24 32 32)" fill="none" stroke="url(#logo-gradient)" stroke-width="1.3" opacity=".8"></ellipse>' +
              '<path d="M21 42V23l11 13 11-13v19" fill="none" stroke="url(#logo-gradient)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
              '<circle cx="55" cy="22" r="2.4" fill="#6cc4ff"></circle>' +
            '</svg>' +
            '<span>Mers<span class="brand-accent">Connect</span></span>' +
          '</a>' +
          '<div class="header-side">' +
            '<div class="balance-pill" id="balance-pill"></div>' +
            '<button type="button" class="theme-toggle" id="theme-toggle" aria-label="تغییر حالت روشن و تیره" title="حالت روشن / تیره" aria-pressed="false">' +
              '<svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
              '<svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' +
            '</button>' +
          '</div>' +
        '</header>' +
        '<main class="wrap" id="content"></main>' +
        '<nav class="bottom-nav" aria-label="ناوبری اصلی">' +
          navItem('home', 'خانه', 'M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z') +
          navItem('shop', 'خرید', 'M4 6h2l1.5 9.5a2 2 0 0 0 2 1.7h6.8a2 2 0 0 0 2-1.6L20 9H7M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2m8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2') +
          navItem('services', 'سرویس‌ها', 'M4 5h16v5H4zM4 14h7v5H4zM14 14h6v5h-6z') +
          '<button type="button" class="nav-item" data-support="1" aria-label="پشتیبانی">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13a8 8 0 0 1 16 0M5 14v3a2 2 0 0 0 2 2h1v-7H6a1 1 0 0 0-1 1zM19 14v3a2 2 0 0 1-2 2h-1v-7h2a1 1 0 0 1 1 1z"></path></svg>' +
            '<span>پشتیبانی</span></button>' +
          navItem('account', 'حساب', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-8 9a8 8 0 0 1 16 0') +
        '</nav>' +
      '</div>';
    content = qs('#content');
    updateBalancePill();
  }

  function navItem(key, label, path) {
    return '<button type="button" class="nav-item" data-nav="' + key + '" data-key="' + key + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"></path></svg>' +
      '<span>' + label + '</span></button>';
  }

  function updateBalancePill() {
    var pill = qs('#balance-pill');
    if (!pill) return;
    if (!state.info) {
      pill.innerHTML = '';
      return;
    }
    pill.innerHTML = '<small>موجودی</small><b>' + fmt(state.info.balance) + '</b><span>تومان</span>';
  }

  function highlightNav(route) {
    var current = route.name === 'service' ? 'services' : route.name;
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.classList.toggle('on', item.getAttribute('data-key') === current);
    });
  }

  async function loadCore() {
    var results = await Promise.all([
      apiGet('user_info'),
      apiGet('invoices', { page: 1, limit: 10 }),
      apiGet('app_config').catch(function () { return null; })
    ]);
    state.info = results[0].obj || null;
    state.invoices = Array.isArray(results[1].obj) ? results[1].obj : [];
    state.meta = results[1].meta || null;
    state.config = results[2] ? results[2].obj || null : null;
    updateBalancePill();
  }

  async function refreshData() {
    try {
      var results = await Promise.all([
        apiGet('user_info'),
        apiGet('invoices', { page: 1, limit: 10 })
      ]);
      state.info = results[0].obj || null;
      state.invoices = Array.isArray(results[1].obj) ? results[1].obj : [];
      state.meta = results[1].meta || null;
      updateBalancePill();
    } catch (error) {}
  }

  function renderFatal(message) {
    var app = qs('#app');
    app.innerHTML = '<div class="app"><main class="wrap" style="padding-top:60px">' + errorBox(message) + '</main></div>';
    var retry = qs('[data-reload]');
    if (retry) retry.addEventListener('click', function () { window.location.reload(); });
  }

  function renderRoute() {
    var route = parseRoute();
    highlightNav(route);
    window.scrollTo(0, 0);
    closeSheet();
    var back = tg() && tg().BackButton;
    if (back) {
      if (ROOTS.indexOf(route.name) !== -1) back.hide();
      else back.show();
    }
    if (route.name === 'services') renderServices();
    else if (route.name === 'service') renderServiceDetail(route.username);
    else if (route.name === 'shop') renderShop();
    else if (route.name === 'account') renderAccount();
    else renderHome();
  }

  /* ---------- Home ---------- */

  function renderHome() {
    var info = state.info || {};
    var me = state.me || {};
    var firstName = me.first_name || me.username || 'دوست عزیز';
    var activeCount = state.invoices.filter(function (item) { return item.status === 'active'; }).length;
    var preview = state.invoices.slice(0, 3);

    var listHtml = preview.length
      ? preview.map(function (item) {
          return '<div class="card service-row" data-nav="service/' + encodeURIComponent(item.username) + '">' +
            '<div class="service-main"><b>' + esc(item.username) + '</b><span class="mut">' + esc(item.note || 'بدون یادداشت') + '</span></div>' +
            '<div class="service-side">' + chip(item.status) + '<small class="mut">تا ' + esc(item.expire) + '</small></div>' +
          '</div>';
        }).join('')
      : emptyBox('هنوز سرویسی ندارید', 'اولین سرویس خود را از فروشگاه تهیه کنید.',
          '<button class="btn primary" data-nav="shop">شروع خرید</button>');

    content.innerHTML =
      '<div class="page">' +
        '<section class="hero"><span class="eyebrow">CONNECT ANYWHERE</span>' +
          '<div class="hero-banner">' +
            '<span class="hb-orb hb-o1" aria-hidden="true"></span><span class="hb-orb hb-o2" aria-hidden="true"></span>' +
            '<div class="hb-row">' +
              '<svg viewBox="0 0 64 64" class="hb-logo" aria-hidden="true">' +
                '<defs><linearGradient id="hb-gradient" x1="0" y1="0" x2="1" y2="1">' +
                  '<stop offset="0" stop-color="#9ad4ff"></stop><stop offset="1" stop-color="#ffffff"></stop>' +
                '</linearGradient></defs>' +
                '<circle cx="32" cy="32" r="22" fill="none" stroke="url(#hb-gradient)" stroke-width="2.2"></circle>' +
                '<ellipse cx="32" cy="32" rx="29" ry="10" transform="rotate(-24 32 32)" fill="none" stroke="url(#hb-gradient)" stroke-width="1.6" opacity=".85"></ellipse>' +
                '<path d="M21 42V23l11 13 11-13v19" fill="none" stroke="url(#hb-gradient)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>' +
                '<circle cx="55" cy="22" r="2.6" fill="#ffffff"></circle>' +
              '</svg>' +
              '<div class="hb-text"><b>MersConnect</b><span>اتصال سریع، امن و بدون قطعی از داخل تلگرام</span></div>' +
              '<span class="hb-badge"><i class="hb-dot"></i>پایدار</span>' +
            '</div>' +
            '<span class="hb-shine" aria-hidden="true"></span>' +
          '</div>' +
          '<h1>سلام ' + esc(firstName) + '</h1>' +
        '</section>' +
        '<button type="button" class="trial-cta" data-nav="shop">' +
          '<span class="trial-ic">🚀</span>' +
          '<span class="trial-text"><b>خرید سرویس جدید</b><small>پلن‌های متنوع با تحویل فوری</small></span>' +
          '<span class="trial-arrow">←</span>' +
        '</button>' +
        '<div class="card balance-card"><div><span class="mut">موجودی کیف پول</span><b class="balance-value">' + fmt(info.balance || 0) + ' <small>تومان</small></b></div>' +
          '<div class="balance-chips">' +
            '<span class="stat-chip"><b>' + fmt(info.count_order || 0) + '</b><small>سرویس</small></span>' +
            '<span class="stat-chip"><b>' + fmt(activeCount) + '</b><small>فعال</small></span>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="trial-strip" data-test="1">' +
          '<span class="trial-strip-ic">⚡</span>' +
          '<span class="trial-strip-text"><b>اکانت تست رایگان</b><small>قبل از خرید، کیفیت سرویس را امتحان کنید</small></span>' +
          '<span class="trial-strip-btn">دریافت</span>' +
        '</button>' +
        '<div class="quick-grid">' +
          '<button type="button" class="quick" data-nav="shop"><span class="quick-ic">🧾</span><b>خرید سرویس</b></button>' +
          '<button type="button" class="quick" data-nav="services"><span class="quick-ic">🛰️</span><b>سرویس‌های من</b></button>' +
          '<button type="button" class="quick" data-invite="1"><span class="quick-ic">🎁</span><b>کد دعوت</b></button>' +
          '<button type="button" class="quick" data-wallet="1"><span class="quick-ic">💳</span><b>شارژ کیف پول</b></button>' +
        '</div>' +
        sectionTitle('سرویس‌های من', 'آخرین سرویس‌های شما', '<button type="button" class="link" data-nav="services">همه</button>') +
        '<div class="list">' + listHtml + '</div>' +
      '</div>';
  }

  /* ---------- Services ---------- */

  function renderServices() {
    servicesState = { page: 1, q: '', loading: true, items: [], meta: null, error: '', timer: null };
    content.innerHTML =
      '<div class="page">' +
        sectionTitle('سرویس‌های من', 'مدیریت و مشاهده وضعیت سرویس‌ها') +
        '<div class="search-box"><span class="search-ic">🔍</span><input id="svc-q" placeholder="جستجوی نام کاربری سرویس" inputmode="search" autocomplete="off"></div>' +
        '<div id="svc-list"></div>' +
        '<div id="svc-pager"></div>' +
      '</div>';
    var input = qs('#svc-q');
    input.addEventListener('input', function () {
      clearTimeout(servicesState.timer);
      servicesState.timer = window.setTimeout(function () {
        servicesState.q = input.value.trim();
        servicesState.page = 1;
        loadServices();
      }, 400);
    });
    loadServices();
  }

  async function loadServices() {
    var list = qs('#svc-list');
    var pager = qs('#svc-pager');
    if (!list) return;
    list.innerHTML = spinner();
    pager.innerHTML = '';
    try {
      var res = await apiGet('invoices', { page: servicesState.page, limit: 10, q: servicesState.q });
      servicesState.items = Array.isArray(res.obj) ? res.obj : [];
      servicesState.meta = res.meta || null;
      servicesState.error = '';
    } catch (error) {
      servicesState.items = [];
      servicesState.error = error.message;
    }
    paintServices();
  }

  function paintServices() {
    var list = qs('#svc-list');
    var pager = qs('#svc-pager');
    if (!list) return;

    if (servicesState.error) {
      list.innerHTML = errorBox(servicesState.error);
      var retry = qs('[data-reload]', list);
      if (retry) retry.addEventListener('click', loadServices);
      pager.innerHTML = '';
      return;
    }

    if (!servicesState.items.length) {
      list.innerHTML = emptyBox('سرویسی پیدا نشد', 'با تغییر عبارت جستجو دوباره تلاش کنید.');
      pager.innerHTML = '';
      return;
    }

    list.innerHTML = '<div class="list">' + servicesState.items.map(function (item) {
      return '<div class="card service-row" data-nav="service/' + encodeURIComponent(item.username) + '">' +
        '<div class="service-main"><b>' + esc(item.username) + '</b><span class="mut">' + esc(item.note || 'بدون یادداشت') + '</span></div>' +
        '<div class="service-side">' + chip(item.status) + '<small class="mut">تا ' + esc(item.expire) + '</small>' +
          '<button type="button" class="btn ghost renew-mini" data-renew="' + esc(item.username) + '">تمدید</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';

    var totalPages = (servicesState.meta && servicesState.meta.totalPages) || 1;
    if (totalPages > 1) {
      pager.innerHTML = '<div class="pager">' +
        '<button type="button" id="pg-prev"' + (servicesState.page <= 1 ? ' disabled' : '') + '>قبلی</button>' +
        '<span class="mut">' + fmt(servicesState.page) + ' از ' + fmt(totalPages) + '</span>' +
        '<button type="button" id="pg-next"' + (servicesState.page >= totalPages ? ' disabled' : '') + '>بعدی</button>' +
      '</div>';
      qs('#pg-prev').addEventListener('click', function () {
        servicesState.page -= 1;
        loadServices();
      });
      qs('#pg-next').addEventListener('click', function () {
        servicesState.page += 1;
        loadServices();
      });
    } else {
      pager.innerHTML = '';
    }
  }

  /* ---------- Service detail ---------- */

  function firstLink(outputs) {
    var found = (outputs || []).filter(function (entry) { return entry.type === 'link'; })[0];
    if (!found) return '';
    return Array.isArray(found.value) ? String(found.value[0] || '') : String(found.value || '');
  }

  function outputText(item) {
    return Array.isArray(item.value) ? item.value.join('\n') : String(item.value == null ? '' : item.value);
  }

  async function renderServiceDetail(username) {
    content.innerHTML = '<div class="page">' + spinner() + '</div>';
    var data;
    try {
      var res = await apiGet('service', { username: username });
      data = res.obj;
    } catch (error) {
      content.innerHTML = '<div class="page">' + errorBox(error.message) +
        '<button class="btn ghost" data-nav="services">بازگشت به لیست</button></div>';
      qs('[data-reload]').addEventListener('click', function () { renderServiceDetail(username); });
      return;
    }
    if (!data) {
      content.innerHTML = '<div class="page">' + emptyBox('سرویس پیدا نشد') + '</div>';
      return;
    }

    var total = Number(data.total_traffic_gb) || 0;
    var used = Number(data.used_traffic_gb) || 0;
    var remaining = Number(data.remaining_traffic_gb) || 0;
    var percent = total > 0 ? Math.min((used / total) * 100, 100) : 0;
    var pages = configListPages(data);
    var linkPage = null;
    var configPages = [];
    pages.forEach(function (page) {
      if (page.kind === 'link' && !linkPage) linkPage = page;
      else if (page.kind !== 'link') configPages.push(page);
    });
    serviceConfigPages = configPages;
    var hasConfigs = configPages.length > 0;

    content.innerHTML = '<div class="page">' +
      '<div class="card detail-head"><div class="detail-top"><div><span class="mut">نام کاربری سرویس</span><b class="detail-username">' +
        esc(data.username) + '</b></div>' + chip(data.status) + '</div>' +
        '<div class="detail-meta">' +
          '<span><small class="mut">پلن</small><b>' + esc(data.product_name || '—') + '</b></span>' +
          '<span><small class="mut">انقضا</small><b>' + esc(data.expiration_time || '—') + '</b></span>' +
          '<span><small class="mut">آخرین اتصال</small><b>' + esc(data.online_at || '—') + '</b></span>' +
        '</div>' +
        (linkPage ? '<div class="qr-box" id="link-qr">' + spinner() + '</div>' +
          '<p class="cfg-value" dir="ltr">' + esc(linkPage.value) + '</p>' : '') +
        '<div class="detail-actions">' +
          (linkPage ? '<button class="btn d-pill d-wide d-pill-copy" data-copy="' + esc(linkPage.value) + '" data-label="لینک اشتراک"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>کپی اشتراک</button>' : '') +
          (hasConfigs ? '<button class="btn d-pill d-pill-primary" data-configs="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>دریافت کانفیگ</button>' : '') +
          '<button class="btn d-pill d-pill-renew" data-renew="' + esc(data.username) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>تمدید</button></div></div>' +
      '<div class="card ring-card">' +
        '<div class="traffic-head"><span class="mut">مصرف ترافیک</span><b>' +
          (total > 0 ? fmt(used) + ' از ' + fmt(total) + ' گیگ' : 'نامحدود') + '</b></div>' +
        trafficRing(percent, total > 0) +
        '<div class="ring-legend">' +
          '<span class="rl-item"><i class="rl-dot used"></i>مصرف شده <b>' + (total > 0 ? fmt(used) + ' گیگ' : '—') + '</b></span>' +
          '<span class="rl-item"><i class="rl-dot left"></i>باقی‌مانده <b>' + (total > 0 ? fmt(remaining) + ' گیگ' : 'نامحدود') + '</b></span>' +
        '</div>' +
        (data.last_subscription_update ? '<p class="mut tiny">آخرین به‌روزرسانی اشتراک: ' + esc(data.last_subscription_update) + '</p>' : '') +
      '</div>' +
      '</div>';
    if (linkPage) attachQr(qs('#link-qr'), linkPage.value);
  }

  function configListPages(data) {
    var pages = [];
    var outputs = Array.isArray(data.service_output) ? data.service_output : [];
    if (outputs.length) {
      outputs.forEach(function (item) {
        if (item.type === 'config') {
          var list = Array.isArray(item.value) ? item.value : [item.value];
          list.forEach(function (value) {
            if (value) pages.push({ kind: 'config', label: 'کانفیگ اتصال', value: String(value) });
          });
        } else if (item.type === 'link') {
          var links = Array.isArray(item.value) ? item.value : [item.value];
          links.forEach(function (value) {
            if (value) pages.push({ kind: 'link', label: 'لینک اشتراک', value: String(value) });
          });
        } else if (item.type === 'file') {
          pages.push({ kind: 'file', label: item.filename || 'فایل کانفیگ', value: String(item.value || '') });
        } else if (item.type === 'password') {
          pages.push({ kind: 'password', label: 'رمز اتصال', value: String(item.value || '') });
        }
      });
      return sortConfigPages(pages);
    }
    if (data.subscription_url) {
      if (data.type === 'WGDashboard') pages.push({ kind: 'file', label: 'فایل کانفیگ', value: String(data.subscription_url) });
      else if (data.type !== 'ibsng' && data.type !== 'mikrotik') pages.push({ kind: 'link', label: 'لینک اشتراک', value: String(data.subscription_url) });
    }
    if (Array.isArray(data.configs)) {
      data.configs.forEach(function (value) {
        if (value) pages.push({ kind: 'config', label: 'کانفیگ اتصال', value: String(value) });
      });
    }
    if (data.password) pages.push({ kind: 'password', label: 'رمز اتصال', value: String(data.password) });
    return sortConfigPages(pages);
  }

  function sortConfigPages(pages) {
    var order = { config: 0, link: 1, file: 2, password: 3 };
    return pages.sort(function (a, b) {
      return (order[a.kind] == null ? 9 : order[a.kind]) - (order[b.kind] == null ? 9 : order[b.kind]);
    });
  }

  function trafficRing(percent, limited) {
    var radius = 54;
    var circ = 2 * Math.PI * radius;
    var p = limited ? Math.max(0, Math.min(percent, 100)) : 100;
    var offset = circ * (1 - p / 100);
    return '<div class="ring-wrap"><svg viewBox="0 0 140 140" role="img" aria-label="نمودار مصرف ترافیک">' +
      '<defs><linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#22c55e"></stop><stop offset="1" stop-color="#2ea0ff"></stop>' +
      '</linearGradient></defs>' +
      '<circle class="ring-track" cx="70" cy="70" r="' + radius + '" fill="none" stroke-width="11"></circle>' +
      '<circle class="ring-val" cx="70" cy="70" r="' + radius + '" fill="none" stroke="url(#ring-grad)" stroke-width="11" stroke-linecap="round" transform="rotate(-90 70 70)" style="--ring-c:' + circ.toFixed(2) + ';--ring-o:' + offset.toFixed(2) + '"></circle>' +
      '<text class="ring-pct" x="70" y="68" text-anchor="middle">' + (limited ? fmt(percent) + '٪' : '∞') + '</text>' +
      '<text class="ring-sub" x="70" y="88" text-anchor="middle">' + (limited ? 'مصرف شده' : 'حجم نامحدود') + '</text>' +
      '</svg></div>';
  }

  function attachQr(box, text) {
    if (!box || !text) return;
    try {
      var qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      var img = document.createElement('img');
      img.className = 'qr';
      img.alt = 'QR';
      img.src = qr.createDataURL(6, 8);
      box.innerHTML = '';
      box.appendChild(img);
    } catch (error) {
      box.innerHTML = '<p class="mut tiny">نمایش QR ممکن نشد؛ از متن استفاده کنید.</p>';
    }
  }

  function paintConfigBox(box, pages, index, rerender) {
    if (!box) return;
    var page = pages[index];
    var html = '<div class="card cfg-card">' +
      '<div class="cfg-head"><b>' + esc(page.label) + '</b>' +
      (pages.length > 1 ? '<span class="mut tiny">' + fmt(index + 1) + ' از ' + fmt(pages.length) + '</span>' : '') +
      '</div>';
    if (page.kind === 'config') {
      html += '<div class="qr-box" id="cfg-qr">' + spinner() + '</div>' +
        '<p class="cfg-value" dir="ltr">' + esc(page.value) + '</p>' +
        '<div class="qr-actions"><button class="btn primary" data-copy="' + esc(page.value) + '" data-label="کانفیگ">کپی کانفیگ</button></div>';
    } else if (page.kind === 'link') {
      html += '<div class="qr-box" id="cfg-qr">' + spinner() + '</div>' +
        '<div class="qr-actions"><button class="btn primary" data-copy="' + esc(page.value) + '" data-label="لینک اشتراک">کپی لینک</button>' +
        '<button class="btn ghost" data-open="' + esc(page.value) + '">باز کردن</button></div>';
    } else if (page.kind === 'file') {
      html += '<div class="qr-actions">' +
        (page.value ? '<button class="btn primary" data-open="' + esc(page.value) + '">دریافت فایل</button>' : '') +
        (page.value ? '<button class="btn ghost" data-copy="' + esc(page.value) + '" data-label="لینک فایل">کپی لینک</button>' : '') + '</div>';
    } else {
      html += '<p class="cfg-value" dir="ltr">' + esc(page.value) + '</p>' +
        '<div class="qr-actions"><button class="btn ghost" data-copy="' + esc(page.value) + '" data-label="رمز">کپی</button></div>';
    }
    if (pages.length > 1) {
      html += '<div class="pager"><button type="button" id="cfg-prev"' + (index <= 0 ? ' disabled' : '') + '>قبلی</button>' +
        '<span class="mut">' + fmt(index + 1) + ' از ' + fmt(pages.length) + '</span>' +
        '<button type="button" id="cfg-next"' + (index >= pages.length - 1 ? ' disabled' : '') + '>بعدی</button></div>';
    }
    html += '</div>';
    box.innerHTML = html;
    if (page.kind === 'config' || page.kind === 'link') attachQr(qs('#cfg-qr', box), page.value);
    var prev = qs('#cfg-prev', box);
    var next = qs('#cfg-next', box);
    if (prev) prev.addEventListener('click', function () { if (index > 0) rerender(index - 1); });
    if (next) next.addEventListener('click', function () { if (index < pages.length - 1) rerender(index + 1); });
  }

  function openConfigSheet(pages, title) {
    if (!pages || !pages.length) return;
    closeSheet();
    var configPages = pages.slice();
    var overlay = document.createElement('div');
    overlay.className = 'sheet-back';
    overlay.id = 'sheet-back';
    overlay.innerHTML = '<div class="sheet" id="sheet"><div class="sheet-grip"></div>' +
      '<div class="sheet-head"><b class="sheet-title">' + esc(title || 'دریافت کانفیگ') + '</b>' +
      '<span class="mut tiny">' + fmt(configPages.length) + ' مورد</span></div>' +
      '<div id="cfg-sheet-box"></div>' +
      '<div class="sheet-actions"><button class="btn ghost" id="cfg-sheet-close">بستن</button></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeSheet();
    });
    qs('#cfg-sheet-close').addEventListener('click', closeSheet);
    var rerender = function (index) {
      paintConfigBox(qs('#cfg-sheet-box'), configPages, index, rerender);
    };
    rerender(0);
  }

  /* ---------- Shop ---------- */

  function renderShop() {
    shop = {
      countries: [], loadingCountries: true, error: '',
      panel: null, categories: [], ranges: [], categoryId: 0, timeDay: 0,
      plans: [], loadingPlans: false, planError: '',
      mode: 'plans', traffic: '', days: '', customInfo: null, customLoading: false,
      sheet: null, buying: false, buyError: '', done: null, customUsername: '', customNote: '',
      pay: null
    };
    paintShop();
    loadCountries();
  }

  async function loadCountries() {
    try {
      var res = await apiGet('countries');
      shop.countries = Array.isArray(res.obj) ? res.obj : [];
    } catch (error) {
      shop.error = error.message;
    }
    shop.loadingCountries = false;
    if (shop) paintShop();
  }

  function paintShop() {
    if (!shop) return;

    if (shop.done) {
      var donePages = configListPages(shop.done);
      var doneLink = null;
      var doneConfigPages = [];
      donePages.forEach(function (page) {
        if (page.kind === 'link' && !doneLink) doneLink = page;
        else if (page.kind !== 'link') doneConfigPages.push(page);
      });
      content.innerHTML = '<div class="page"><div class="success-box"><div class="success-ic">✓</div>' +
        '<b>سرویس با موفقیت ساخته شد</b><p class="mut">' + esc(shop.done.username) + '</p>' +
        (doneLink ? '<button class="btn d-pill d-wide d-pill-copy" data-copy="' + esc(doneLink.value) + '" data-label="لینک اشتراک"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>کپی اشتراک</button>' : '') +
        (doneConfigPages.length ? '<button class="btn d-pill d-wide d-pill-primary" id="done-configs"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>دریافت کانفیگ</button>' : '') +
        '<button class="btn ghost" data-nav="service/' + encodeURIComponent(shop.done.username) + '">مشاهده سرویس</button>' +
        '<button class="btn ghost" id="shop-again">خرید مجدد</button></div></div>';
      qs('#shop-again').addEventListener('click', function () { renderShop(); });
      var doneConfigs = qs('#done-configs');
      if (doneConfigs) doneConfigs.addEventListener('click', function () { openConfigSheet(doneConfigPages, 'کانفیگ سرویس جدید'); });
      return;
    }

    if (shop.loadingCountries) {
      content.innerHTML = '<div class="page">' + spinner() + '</div>';
      return;
    }

    if (shop.error) {
      content.innerHTML = '<div class="page">' + errorBox(shop.error) + '</div>';
      qs('[data-reload]').addEventListener('click', renderShop);
      return;
    }

    if (!shop.panel) {
      var countriesHtml = shop.countries.length
        ? '<div class="list">' + shop.countries.map(function (item, index) {
            return '<div class="card country-row" data-country="' + index + '"><span class="country-ic">🌍</span><b>' +
              esc(item.name) + '</b><span class="chev">←</span></div>';
          }).join('') + '</div>'
        : emptyBox('پنلی در دسترس نیست', 'در حال حاضر امکان خرید آنلاین وجود ندارد.');

      content.innerHTML = '<div class="page">' +
        sectionTitle('فروشگاه', 'کشور و پنل مورد نظر را انتخاب کنید') + countriesHtml + '</div>';

      content.querySelectorAll('[data-country]').forEach(function (row) {
        row.addEventListener('click', function () { selectPanel(shop.countries[Number(row.getAttribute('data-country'))]); });
      });
      return;
    }

    var panel = shop.panel;
    var categoriesHtml = shop.categories.length
      ? '<div class="chips"><button type="button" class="chip-btn' + (shop.categoryId === 0 ? ' on' : '') + '" data-cat="0">همه</button>' +
        shop.categories.map(function (item) {
          return '<button type="button" class="chip-btn' + (String(shop.categoryId) === String(item.id) ? ' on' : '') +
            '" data-cat="' + esc(item.id) + '">' + esc(item.name) + '</button>';
        }).join('') + '</div>'
      : '';

    var rangesHtml = shop.ranges.length
      ? '<div class="chips"><button type="button" class="chip-btn' + (shop.timeDay === 0 ? ' on' : '') + '" data-day="0">همه</button>' +
        shop.ranges.map(function (item, index) {
          return '<button type="button" class="chip-btn' + (String(shop.timeDay) === String(item.day) ? ' on' : '') +
            '" data-day="' + esc(item.day) + '">' + esc(item.name) + '</button>';
        }).join('') + '</div>'
      : '';

    var plansHtml = '';
    if (shop.loadingPlans) plansHtml = spinner('در حال دریافت پلن‌ها…');
    else if (shop.planError) plansHtml = errorBox(shop.planError);
    else if (!shop.plans.length) plansHtml = emptyBox('پلنی موجود نیست', 'فیلترها را تغییر دهید یا بعداً دوباره تلاش کنید.');
    else {
      plansHtml = '<div class="list">' + shop.plans.map(function (plan, index) {
        return '<div class="card plan-card" data-plan="' + index + '"><div class="plan-main"><b>' + esc(plan.name) + '</b>' +
          (plan.description ? '<span class="mut tiny">' + esc(plan.description) + '</span>' : '') +
          '<div class="plan-tags"><span class="tag">' + (Number(plan.traffic_gb) === 0 ? 'حجم نامحدود' : fmt(plan.traffic_gb) + ' گیگ') + '</span>' +
          '<span class="tag">' + (Number(plan.time_days) === 0 ? 'زمان نامحدود' : fmt(plan.time_days) + ' روز') + '</span></div></div>' +
          '<div class="plan-price">' + toman(plan.price) + '</div></div>';
      }).join('') + '</div>';
    }

    var customHtml = '';
    if (shop.mode === 'custom') {
      var info = shop.customInfo;
      customHtml =
        '<div class="card custom-box">' +
          '<label class="field"><span>حجم (گیگابایت)</span>' +
            '<input type="number" inputmode="numeric" id="custom-traffic" value="' + esc(shop.traffic) + '" placeholder="' +
              (info ? esc(info.traffic_min) + ' تا ' + esc(info.traffic_max) : '') + '"></label>' +
          '<label class="field"><span>مدت (روز)</span>' +
            '<input type="number" inputmode="numeric" id="custom-days" value="' + esc(shop.days) + '" placeholder="' +
              (info ? esc(info.time_min) + ' تا ' + esc(info.time_max) : '') + '"></label>' +
          '<p class="mut tiny" id="custom-meta">' + customMeta() + '</p>' +
          '<div class="custom-foot"><span class="mut">قیمت</span><b id="custom-price">' + customPriceHtml() + '</b></div>' +
          '<button class="btn primary" id="custom-buy"' + (canBuyCustom() ? '' : ' disabled') + '>ادامه خرید</button>' +
        '</div>';
    }

    content.innerHTML = '<div class="page">' +
      '<div class="shop-head"><button type="button" class="link" id="shop-back">تغییر کشور</button><b>' + esc(panel.name) + '</b></div>' +
      (panel.is_custom
        ? '<div class="seg"><button type="button" class="' + (shop.mode === 'plans' ? 'on' : '') + '" data-mode="plans">پلن‌های آماده</button>' +
          '<button type="button" class="' + (shop.mode === 'custom' ? 'on' : '') + '" data-mode="custom">حجم دلخواه</button></div>'
        : '') +
      (shop.mode === 'plans' ? categoriesHtml + rangesHtml + plansHtml : customHtml) +
      '</div>';

    qs('#shop-back').addEventListener('click', function () {
      shop.panel = null;
      shop.plans = [];
      shop.sheet = null;
      closeSheet();
      paintShop();
    });

    content.querySelectorAll('[data-mode]').forEach(function (button) {
      button.addEventListener('click', function () {
        shop.mode = button.getAttribute('data-mode');
        paintShop();
      });
    });

    content.querySelectorAll('[data-cat]').forEach(function (button) {
      button.addEventListener('click', function () {
        shop.categoryId = Number(button.getAttribute('data-cat'));
        paintShop();
        loadPlans();
      });
    });

    content.querySelectorAll('[data-day]').forEach(function (button) {
      button.addEventListener('click', function () {
        shop.timeDay = Number(button.getAttribute('data-day'));
        paintShop();
        loadPlans();
      });
    });

    content.querySelectorAll('[data-plan]').forEach(function (card) {
      card.addEventListener('click', function () {
        var plan = shop.plans[Number(card.getAttribute('data-plan'))];
        haptic('light');
        openSheet({ type: 'plan', plan: plan, price: Number(plan.price) });
      });
    });

    if (shop.mode === 'custom') {
      var trafficInput = qs('#custom-traffic');
      var daysInput = qs('#custom-days');
      trafficInput.addEventListener('input', function () { shop.traffic = trafficInput.value; });
      daysInput.addEventListener('input', function () { shop.days = daysInput.value; });
      trafficInput.addEventListener('change', function () { shop.traffic = trafficInput.value; loadCustomPrice(); });
      daysInput.addEventListener('change', function () { shop.days = daysInput.value; loadCustomPrice(); });
      var buy = qs('#custom-buy');
      if (buy) buy.addEventListener('click', function () { openCustomSheet(); });
    }
  }

  function customMeta() {
    var info = shop.customInfo;
    if (!info) return 'حجم و مدت دلخواه را وارد کنید.';
    return 'محدوده مجاز حجم: ' + fmt(info.traffic_min) + ' تا ' + fmt(info.traffic_max) + ' گیگ — مدت: ' +
      fmt(info.time_min) + ' تا ' + fmt(info.time_max) + ' روز';
  }

  function customPriceHtml() {
    var info = shop.customInfo;
    if (!info || info.price === false) return '—';
    return toman(info.price);
  }

  function canBuyCustom() {
    var info = shop.customInfo;
    if (!info || info.price === false) return false;
    var traffic = Number(shop.traffic);
    var days = Number(shop.days);
    return traffic >= Number(info.traffic_min) && traffic <= Number(info.traffic_max) &&
      days >= Number(info.time_min) && days <= Number(info.time_max) && traffic > 0 && days > 0;
  }

  async function selectPanel(item) {
    if (!item) return;
    shop.panel = item;
    shop.categories = [];
    shop.ranges = [];
    shop.categoryId = 0;
    shop.timeDay = 0;
    shop.mode = 'plans';
    shop.plans = [];
    shop.traffic = '';
    shop.days = '';
    shop.customInfo = null;
    paintShop();
    try {
      var results = await Promise.all([
        apiGet('categories', { country_id: item.id }).catch(function () { return { obj: [] }; }),
        apiGet('time_ranges', { country_id: item.id }).catch(function () { return { obj: [] }; })
      ]);
      if (!shop || shop.panel !== item) return;
      shop.categories = Array.isArray(results[0].obj) ? results[0].obj : [];
      shop.ranges = Array.isArray(results[1].obj) ? results[1].obj : [];
    } catch (error) {}
    paintShop();
    loadPlans();
  }

  async function loadPlans() {
    if (!shop || !shop.panel || shop.mode !== 'plans') return;
    var panel = shop.panel;
    shop.loadingPlans = true;
    shop.planError = '';
    paintShop();
    try {
      var res = await apiGet('services', {
        country_id: panel.id,
        category_id: shop.categoryId || '',
        time_range_day: shop.timeDay
      });
      if (!shop || shop.panel !== panel) return;
      shop.plans = Array.isArray(res.obj) ? res.obj : [];
    } catch (error) {
      if (!shop || shop.panel !== panel) return;
      shop.plans = [];
      shop.planError = error.message;
    }
    shop.loadingPlans = false;
    paintShop();
  }

  async function loadCustomPrice() {
    if (!shop || !shop.panel) return;
    var traffic = Number(shop.traffic);
    var days = Number(shop.days);
    if (!traffic || !days) {
      shop.customInfo = null;
      updateCustomUi();
      return;
    }
    var panel = shop.panel;
    try {
      var res = await apiGet('custom_price', { country_id: panel.id, traffic_gb: traffic, time_days: days });
      if (!shop || shop.panel !== panel) return;
      shop.customInfo = res.obj || null;
    } catch (error) {
      if (!shop || shop.panel !== panel) return;
      shop.customInfo = null;
    }
    updateCustomUi();
  }

  function updateCustomUi() {
    var price = qs('#custom-price');
    var meta = qs('#custom-meta');
    var buy = qs('#custom-buy');
    if (price) price.innerHTML = customPriceHtml();
    if (meta) meta.textContent = customMeta();
    if (buy) buy.disabled = !canBuyCustom();
  }

  function openCustomSheet() {
    if (!canBuyCustom()) return;
    haptic('light');
    openSheet({
      type: 'custom',
      price: Number(shop.customInfo.price),
      traffic_gb: Number(shop.traffic),
      time_days: Number(shop.days)
    });
  }

  function openSheet(order) {
    shop.sheet = order;
    shop.buyError = '';
    shop.customUsername = '';
    shop.customNote = '';
    paintSheet();
  }

  function paintSheet() {
    closeSheet();
    if (!shop || !shop.sheet) return;

    var panel = shop.panel;
    var order = shop.sheet;
    var usernameRequired = !!panel.is_username;
    var usernameOk = !usernameRequired || validCustomUsername(shop.customUsername);
    var overlay = document.createElement('div');
    overlay.className = 'sheet-back';
    overlay.id = 'sheet-back';
    overlay.innerHTML = '<div class="sheet" id="sheet">' +
      '<div class="sheet-grip"></div><b class="sheet-title">تایید سفارش</b>' +
      '<div class="sheet-row"><span class="mut">پنل</span><span>' + esc(panel.name) + '</span></div>' +
      '<div class="sheet-row"><span class="mut">پلن</span><span>' +
        (order.type === 'plan' ? esc(order.plan.name) : fmt(order.traffic_gb) + ' گیگ / ' + fmt(order.time_days) + ' روز') +
      '</span></div>' +
      '<div class="sheet-row"><span class="mut">مبلغ</span><b>' + toman(order.price) + '</b></div>' +
      '<div class="sheet-row"><span class="mut">موجودی کیف پول</span><span>' + toman(state.info ? state.info.balance : 0) + '</span></div>' +
      (usernameRequired
        ? '<label class="field"><span>نام کاربری دلخواه (اجباری)</span><input id="sheet-username" dir="ltr" value="' +
          esc(shop.customUsername) + '" placeholder="مثلاً mers_ali"></label>' +
          '<p class="mut tiny" id="sheet-username-hint">' +
            (usernameOk ? '' : (String(shop.customUsername).trim() === ''
              ? 'این پنل نام دلخواه می‌خواهد؛ بدون وارد کردن نام، خرید انجام نمی‌شود.'
              : 'فقط حروف انگلیسی، عدد و _؛ شروع با حرف و بین ۳ تا ۳۳ کاراکتر.')) + '</p>'
        : '') +
      (panel.is_note
        ? '<label class="field"><span>یادداشت (اختیاری)</span><input id="sheet-note" value="' +
          esc(shop.customNote) + '" placeholder="مثلاً سرویس شخصی"></label>'
        : '') +
      (shop.buyError ? '<p class="buy-error">' + esc(shop.buyError) + '</p>' : '') +
      '<div class="sheet-actions"><button class="btn ghost" id="sheet-cancel"' + (shop.buying ? ' disabled' : '') + '>انصراف</button>' +
      '<button class="btn primary" id="sheet-pay"' + (shop.buying || !usernameOk ? ' disabled' : '') + '>' +
        (shop.buying ? 'در حال خرید…' : 'پرداخت') + '</button></div>' +
    '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeSheet();
    });

    var usernameInput = qs('#sheet-username');
    var noteInput = qs('#sheet-note');
    if (usernameInput) usernameInput.addEventListener('input', function () {
      shop.customUsername = usernameInput.value;
      var ok = validCustomUsername(shop.customUsername);
      var pay = qs('#sheet-pay');
      if (pay && !shop.buying) pay.disabled = !ok;
      var hint = qs('#sheet-username-hint');
      if (hint) hint.textContent = ok ? '' : (String(shop.customUsername).trim() === ''
        ? 'این پنل نام دلخواه می‌خواهد؛ بدون وارد کردن نام، خرید انجام نمی‌شود.'
        : 'فقط حروف انگلیسی، عدد و _؛ شروع با حرف و بین ۳ تا ۳۳ کاراکتر.');
    });
    if (noteInput) noteInput.addEventListener('input', function () { shop.customNote = noteInput.value; });

    qs('#sheet-cancel').addEventListener('click', closeSheet);
    qs('#sheet-pay').addEventListener('click', submitPurchase);
  }

  function closeSheet() {
    var existing = qs('#sheet-back');
    if (existing) existing.remove();
    clearInterval(supportTimer);
    supportTimer = null;
  }

  function watchOrder(order) {
    if (!order || !order.order_id) return;
    orderWatch = order;
    try { sessionStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (error) {}
    if (orderTimer) clearInterval(orderTimer);
    orderTimer = setInterval(checkOrderStatus, 6000);
    setTimeout(checkOrderStatus, 1500);
  }

  function unwatchOrder() {
    if (orderTimer) clearInterval(orderTimer);
    orderTimer = null;
    orderWatch = null;
    try { sessionStorage.removeItem(ORDER_KEY); } catch (error) {}
  }

  async function checkOrderStatus() {
    if (!orderWatch) return;
    var current = orderWatch;
    try {
      var res = await apiGet('payment_status', { order_id: current.order_id });
      var obj = (res && res.obj) || {};
      if (!orderWatch || orderWatch.order_id !== current.order_id) return;
      if (obj.done) {
        unwatchOrder();
        extendFlow = null;
        if (shop) shop.pay = null;
        closeSheet();
        haptic('success');
        if (current.kind === 'topup') {
          toast('موجودی کیف پول افزایش یافت.');
          refreshData();
          return;
        }
        toast(current.kind === 'extend' ? 'تمدید با موفقیت انجام شد.' : 'سرویس شما با موفقیت فعال شد.');
        refreshData();
        var username = obj.username || current.username;
        var target = 'service/' + encodeURIComponent(username);
        if ((window.location.hash || '').replace(/^#/, '') === target) renderRoute();
        else go(target);
        return;
      }
      if (obj.failed) {
        unwatchOrder();
        haptic('error');
        toast('پرداخت تایید نشد؛ در صورت واریز با پشتیبانی در ارتباط باشید.');
      }
    } catch (error) {
      if (!orderWatch || orderWatch.order_id !== current.order_id) return;
      current.fails = (current.fails || 0) + 1;
      if (current.fails === 3) toast('وضعیت پرداخت هنوز قابل بررسی نیست؛ به‌صورت خودکار دوباره تلاش می‌شود.');
    }
  }

  async function submitPurchase() {
    if (!shop || !shop.sheet || shop.buying) return;
    if (shop.panel && shop.panel.is_username && !validCustomUsername(shop.customUsername)) {
      haptic('error');
      shop.buyError = String(shop.customUsername).trim() === ''
        ? 'این پنل نام دلخواه می‌خواهد؛ لطفاً نام کاربری را وارد کنید.'
        : 'نام کاربری معتبر نیست؛ فقط حروف انگلیسی، عدد و _ و شروع با حرف.';
      paintSheet();
      return;
    }
    shop.buying = true;
    shop.buyError = '';
    paintSheet();

    var panel = shop.panel;
    var order = shop.sheet;
    var body = { country_id: panel.id };
    if (order.type === 'plan') body.service_id = order.plan.id;
    else body.custom_service = { traffic_gb: order.traffic_gb, time_days: order.time_days };
    if (shop.customUsername.trim()) body.custom_username = shop.customUsername.trim();
    if (shop.customNote.trim()) body.custom_note = shop.customNote.trim();

    try {
      var res = await apiPost('purchase', body);
      if (res.requires_payment && res.payment) {
        shop.sheet = null;
        shop.buying = false;
        shop.pay = {
          amount: Number(res.payment.amount || 0),
          price: Number(res.payment.price || 0),
          balance: Number(res.payment.balance || 0),
          username: res.payment.username || res.service.username,
          methods: Array.isArray(res.payment.methods) ? res.payment.methods : [],
          method: '',
          busy: false,
          error: '',
          cart: null,
          receipt: { preview: '', busy: false, sent: false, error: '' }
        };
        if (shop.pay.methods.length) shop.pay.method = shop.pay.methods[0].id;
        closeSheet();
        haptic('light');
        paintPaySheet();
        return;
      }
      haptic('success');
      shop.done = res.service || { username: '' };
      shop.sheet = null;
      shop.buying = false;
      closeSheet();
      paintShop();
      refreshData();
    } catch (error) {
      haptic('error');
      shop.buyError = error.message;
      shop.buying = false;
      paintSheet();
    }
  }

  function paintPaySheet() {
    closeSheet();
    if (!shop || !shop.pay) return;
    var pay = shop.pay;
    var html = '<div class="sheet-grip"></div>' +
      '<div class="sheet-head"><b class="sheet-title">پرداخت سفارش</b><span class="secure-tag">پرداخت امن</span></div>';
    if (pay.cart) {
      var receipt = pay.receipt || {};
      html += '<div class="card-info">' +
        '<div class="ci-row"><span>مبلغ قابل پرداخت</span><b>' + fmt(pay.cart.price) + ' تومان</b></div>' +
        '<div class="ci-row"><span>شماره کارت</span><b class="ci-value">' + esc(pay.cart.card_number) + '</b>' +
        '<button type="button" class="ci-copy" data-copy="' + esc(pay.cart.card_number) + '" data-label="شماره کارت">کپی</button></div>' +
        '<div class="ci-row"><span>به نام</span><b>' + esc(pay.cart.name_card) + '</b></div></div>' +
        '<div class="receipt-box">' +
        '<p class="receipt-hint">پس از واریز، تصویر رسید را همین‌جا ارسال کنید.</p>' +
        '<input type="file" id="pay-receipt-file" accept="image/*" hidden>' +
        (receipt.preview ? '<div class="receipt-preview"><img src="' + receipt.preview + '" alt="رسید"></div>' : '') +
        '<button class="btn receipt-pick" id="pay-receipt-pick"' + (receipt.busy ? ' disabled' : '') + '>' +
        (receipt.preview ? 'تغییر تصویر' : 'انتخاب تصویر رسید') + '</button>' +
        '<button class="btn primary" id="pay-receipt-send"' + (!receipt.preview || receipt.busy || receipt.sent ? ' disabled' : '') + '>' +
        (receipt.sent ? 'رسید ارسال شد' : (receipt.busy ? 'در حال ارسال…' : 'تأیید و ارسال رسید')) + '</button>' +
        (receipt.sent ? '<p class="ok-note">رسید شما ارسال شد؛ پس از تأیید، سرویس فعال می‌شود.</p>' : '') +
        (receipt.error ? '<p class="buy-error">' + esc(receipt.error) + '</p>' : '') +
        '</div>' +
        '<div class="sheet-actions"><button class="btn ghost" id="pay-close">بستن</button>' +
        '<button class="btn ghost" id="pay-bot"' + (pay.cart.bot_username ? '' : ' disabled') + '>ارسال از طریق ربات</button></div>';
    } else {
      html += '<div class="sheet-row"><span class="mut">مبلغ سفارش</span><b>' + toman(pay.price) + '</b></div>' +
        (pay.balance > 0 ? '<div class="sheet-row"><span class="mut">موجودی کیف پول</span><span>' + toman(pay.balance) + '</span></div>' : '') +
        '<div class="sheet-row"><span class="mut">مبلغ قابل پرداخت</span><b>' + toman(pay.amount) + '</b></div>' +
        (pay.balance > 0
          ? '<div class="pay-notice"><p>موجودی کیف پول شما <b>' + toman(pay.balance) + '</b> از مبلغ سفارش کسر می‌شود؛ مابه‌التفاوت <b>' + toman(pay.amount) + '</b> را مستقیم پرداخت می‌کنید.</p></div>'
          : '<p class="pay-direct-note">پرداخت این سفارش به‌صورت مستقیم (درگاه یا کارت‌به‌کارت) انجام می‌شود.</p>') +
        '<div class="chips pay-methods">' + pay.methods.map(function (item) {
          return '<button type="button" class="chip-btn' + (pay.method === item.id ? ' on' : '') + '" data-pay-method="' + esc(item.id) + '">' + esc(item.label) + '</button>';
        }).join('') + '</div>' +
        (pay.error ? '<p class="buy-error">' + esc(pay.error) + '</p>' : '') +
        '<div class="sheet-actions"><button class="btn ghost" id="pay-close">انصراف</button>' +
        '<button class="btn primary" id="pay-submit"' + (pay.busy || !pay.method ? ' disabled' : '') + '>' +
        (pay.busy ? 'در حال اتصال…' : 'پرداخت') + '</button></div>';
    }
    var overlay = document.createElement('div');
    overlay.className = 'sheet-back';
    overlay.id = 'sheet-back';
    overlay.innerHTML = '<div class="sheet" id="sheet">' + html + '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeSheet();
    });
    qs('#pay-close').addEventListener('click', function () { shop.pay = null; closeSheet(); });
    if (pay.cart) {
      var file = qs('#pay-receipt-file');
      var pick = qs('#pay-receipt-pick');
      if (pick) pick.addEventListener('click', function () { file.click(); });
      if (file) file.addEventListener('change', async function () {
        if (!file.files || !file.files[0]) return;
        try {
          pay.receipt.preview = await readReceipt(file.files[0]);
          pay.receipt.error = '';
        } catch (error) {
          pay.receipt.error = 'خواندن تصویر ممکن نشد.';
        }
        paintPaySheet();
      });
      var send = qs('#pay-receipt-send');
      if (send) send.addEventListener('click', submitPayReceipt);
      var botBtn = qs('#pay-bot');
      if (botBtn) botBtn.addEventListener('click', function () {
        if (pay.cart.bot_username) openLink('https://t.me/' + pay.cart.bot_username);
      });
    } else {
      qs('#pay-submit').addEventListener('click', submitPay);
      document.querySelectorAll('[data-pay-method]').forEach(function (button) {
        button.addEventListener('click', function () {
          pay.method = button.getAttribute('data-pay-method');
          pay.error = '';
          paintPaySheet();
        });
      });
    }
  }

  async function submitPay() {
    if (!shop || !shop.pay || shop.pay.busy) return;
    var pay = shop.pay;
    pay.busy = true;
    pay.error = '';
    paintPaySheet();
    try {
      var res = await apiPost('purchase_pay', { username: pay.username, method: pay.method });
      var obj = res.obj || {};
      if (obj.type === 'cart') {
        pay.cart = obj;
        pay.busy = false;
        pay.receipt = { preview: '', busy: false, sent: false, error: '' };
        watchOrder({ order_id: obj.order_id, username: pay.username, kind: 'purchase' });
        paintPaySheet();
        return;
      }
      pay.busy = false;
      haptic('success');
      toast('لینک پرداخت باز شد؛ پس از پرداخت سرویس فعال می‌شود.');
      if (obj.order_id) watchOrder({ order_id: obj.order_id, username: pay.username, kind: 'purchase' });
      if (obj.url) openLink(obj.url);
      closeSheet();
      shop.pay = null;
    } catch (error) {
      pay.busy = false;
      pay.error = error.message;
      haptic('error');
      paintPaySheet();
    }
  }

  async function submitPayReceipt() {
    if (!shop || !shop.pay || !shop.pay.cart) return;
    var pay = shop.pay;
    var receipt = pay.receipt;
    if (!receipt.preview || receipt.busy) return;
    receipt.busy = true;
    receipt.error = '';
    paintPaySheet();
    try {
      await apiPost('wallet_receipt', { order_id: pay.cart.order_id, image: receipt.preview });
      receipt.sent = true;
      receipt.busy = false;
      watchOrder({ order_id: pay.cart.order_id, username: pay.username, kind: 'purchase' });
      haptic('success');
      paintPaySheet();
    } catch (error) {
      receipt.busy = false;
      receipt.error = error.message;
      haptic('error');
      paintPaySheet();
    }
  }

  /* ---------- Account ---------- */

  function renderAccount() {
    var info = state.info || {};
    var me = state.me || {};
    var name = [me.first_name, me.last_name].filter(Boolean).join(' ') || me.username || 'کاربر MersConnect';
    var initial = String(name || 'M').trim().charAt(0).toUpperCase();
    var photo = typeof me.photo_url === 'string' && me.photo_url ? me.photo_url : '';
    var avatar = '<div class="avatar' + (photo ? ' has-photo' : '') + '"><span>' + esc(initial) + '</span>' +
      (photo ? '<img src="' + esc(photo) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '</div>';
    content.innerHTML = '<div class="page">' +
      '<div class="card profile-card">' + avatar +
        '<div class="profile-main"><b>' + esc(name) + '</b><span class="mut">' + esc(info.group_type || 'کاربر') + '</span>' +
        (me.username ? '<span class="mut tiny" dir="ltr">@' + esc(me.username) + '</span>' : '') + '</div></div>' +
      '<div class="card wallet-card"><div><span class="mut">موجودی کیف پول</span><b class="wallet-value">' + toman(info.balance || 0) + '</b></div>' +
        '<button class="btn primary" data-wallet="1">شارژ کیف پول</button></div>' +
      sectionTitle('اطلاعات حساب') +
      '<div class="card info-list">' +
        '<div class="info-row"><span class="mut">آیدی تلگرام</span><span dir="ltr">' + esc(String(me.id || '—')) + '</span></div>' +
        '<div class="info-row"><span class="mut">یوزرنیم تلگرام</span><span dir="ltr">' + (me.username ? '@' + esc(me.username) : '—') + '</span></div>' +
        '<div class="info-row"><span class="mut">شماره تماس</span><span>' + esc(info.phone || '—') + '</span></div>' +
        '<div class="info-row"><span class="mut">تاریخ عضویت</span><span>' + esc(info.time_join || '—') + '</span></div>' +
        '<div class="info-row"><span class="mut">تعداد خرید</span><span>' + fmt(info.count_payment || 0) + '</span></div>' +
        '<div class="info-row"><span class="mut">تعداد زیرمجموعه</span><span>' + fmt(info.affiliatescount || 0) + '</span></div>' +
      '</div>' +
      sectionTitle('کد دعوت', 'دوستان خود را معرفی کنید و پاداش بگیرید') +
      '<div class="card invite-card"><b class="invite-code" dir="ltr">' + esc(info.codeInvitation || '—') + '</b>' +
        '<button class="btn primary" data-invite="1">لینک دعوت</button></div>' +
      '<p class="brand-foot">MersConnect — سریع، امن، پایدار</p>' +
    '</div>';
  }

  /* ---------- Wallet top-up ---------- */

  function mountSheet(html) {
    closeSheet();
    var overlay = document.createElement('div');
    overlay.className = 'sheet-back';
    overlay.id = 'sheet-back';
    overlay.innerHTML = '<div class="sheet" id="sheet">' + html + '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeSheet();
    });
    return overlay;
  }

  function walletMethod() {
    if (!wallet || !wallet.methods) return null;
    for (var i = 0; i < wallet.methods.length; i++) {
      if (wallet.methods[i].id === wallet.method) return wallet.methods[i];
    }
    return null;
  }

  function walletPresets(method) {
    if (!method) return [];
    var base = [50000, 100000, 200000, 500000];
    return base.filter(function (amount) {
      return amount >= method.min && (!method.max || amount <= method.max);
    }).slice(0, 4);
  }

  function readReceipt(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('read')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('image')); };
        img.onload = function () {
          var max = 1600;
          var scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
          canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function openWalletSheet() {
    haptic('light');
    wallet = { loading: true, methods: [], debt: 0, price: '', method: '', error: '', busy: false };
    paintWallet();
    try {
      var res = await apiGet('wallet_info');
      if (!wallet) return;
      wallet.loading = false;
      wallet.methods = res.obj && Array.isArray(res.obj.methods) ? res.obj.methods : [];
      wallet.debt = Number((res.obj && res.obj.debt) || 0);
      if (!wallet.methods.length) {
        wallet.error = 'در حال حاضر روش پرداخت فعالی برای شارژ کیف پول وجود ندارد.';
      } else {
        wallet.method = wallet.methods[0].id;
        wallet.price = String(wallet.methods[0].min + wallet.debt);
      }
    } catch (error) {
      if (!wallet) return;
      wallet.loading = false;
      wallet.error = error.message;
    }
    paintWallet();
  }

  function paintWallet() {
    if (!wallet) return;
    var html = '<div class="sheet-grip"></div>' +
      '<div class="sheet-head"><b class="sheet-title">شارژ کیف پول</b><span class="secure-tag">پرداخت امن</span></div>';
    if (wallet.cart) {
      var cart = wallet.cart;
      var receipt = wallet.receipt || {};
      var botUrl = cart.bot_username ? 'https://t.me/' + cart.bot_username : '';
      html += '<div class="card-info">' +
          '<div class="ci-row"><span>مبلغ</span><b>' + fmt(cart.price) + ' تومان</b></div>' +
          '<div class="ci-row"><span>شماره کارت</span><b class="ci-value">' + esc(cart.card_number) + '</b>' +
            '<button type="button" class="ci-copy" data-copy="' + esc(cart.card_number) + '" data-label="شماره کارت">کپی</button></div>' +
          '<div class="ci-row"><span>به نام</span><b class="ci-value">' + esc(cart.name_card) + '</b></div>' +
        '</div>';
      if (receipt.sent) {
        html += '<p class="ok-note">رسید شما ارسال شد؛ پس از تأیید مدیریت، موجودی کیف پول به‌روز می‌شود.</p>' +
          '<div class="sheet-actions"><button class="btn primary" id="wallet-cancel">متوجه شدم</button></div>';
      } else {
        html += '<div class="receipt-box">' +
          '<p class="receipt-hint">پس از واریز، تصویر رسید را از همین صفحه ارسال کنید.</p>' +
          '<input id="receipt-file" type="file" accept="image/*" hidden>' +
          (receipt.preview ? '<div class="receipt-preview"><img src="' + receipt.preview + '" alt="رسید"></div>' : '') +
          (receipt.error ? '<p class="buy-error">' + esc(receipt.error) + '</p>' : '') +
          (receipt.preview
            ? '<button class="btn primary" id="receipt-send"' + (receipt.busy ? ' disabled' : '') + '>' + (receipt.busy ? 'در حال ارسال…' : 'تأیید و ارسال رسید') + '</button>'
            : '<button class="btn receipt-pick" id="receipt-pick">انتخاب تصویر رسید</button>') +
          '</div>' +
          '<div class="sheet-actions"><button class="btn ghost" id="wallet-cancel"' + (receipt.busy ? ' disabled' : '') + '>بستن</button>' +
          (botUrl ? '<button class="btn ghost" id="wallet-bot">ارسال از طریق ربات</button>' : '');
      }
      mountSheet(html);
      var cartCancel = qs('#wallet-cancel');
      if (cartCancel) cartCancel.addEventListener('click', function () { wallet = null; closeSheet(); });
      var pick = qs('#receipt-pick');
      var file = qs('#receipt-file');
      if (pick && file) {
        pick.addEventListener('click', function () { file.click(); });
        file.addEventListener('change', function () {
          var selected = file.files && file.files[0];
          if (!selected) return;
          wallet.receipt = { preview: '', busy: false, sent: false, error: '' };
          readReceipt(selected).then(function (dataUrl) {
            wallet.receipt.preview = dataUrl;
            paintWallet();
          }).catch(function () {
            wallet.receipt.error = 'این تصویر قابل استفاده نیست؛ یک عکس دیگر انتخاب کنید.';
            paintWallet();
          });
        });
      }
      var sendReceipt = qs('#receipt-send');
      if (sendReceipt) sendReceipt.addEventListener('click', submitReceipt);
      var botBtn = qs('#wallet-bot');
      if (botBtn) botBtn.addEventListener('click', function () { openLink(botUrl); });
      return;
    }
    if (wallet.loading) {
      html += '<div class="center-box small"><span class="spinner"></span><p class="mut">در حال دریافت روش‌های پرداخت…</p></div>';
    } else if (!wallet.methods.length) {
      html += '<p class="mut">' + esc(wallet.error || 'روش پرداخت فعالی پیدا نشد.') + '</p>' +
        '<div class="sheet-actions"><button class="btn ghost" id="wallet-cancel">بستن</button></div>';
    } else {
      var method = walletMethod();
      var presets = walletPresets(method);
      var payLabel = method && method.id === 'cart' ? 'دریافت شماره کارت' : 'پرداخت آنلاین';
      var hint = method ? 'حداقل ' + fmt(method.min) + ' و حداکثر ' + (method.max > 0 ? fmt(method.max) : 'بدون محدودیت') + ' تومان' : '';
      if (wallet.debt > 0) {
        hint += ' — برای تسویه بدهی حداقل ' + fmt(wallet.debt) + ' تومان';
      }
      html += '<div class="amount-presets">' + presets.map(function (amount) {
        return '<button type="button" class="preset' + (String(amount) === String(wallet.price) ? ' on' : '') + '" data-preset="' + amount + '">' + fmt(amount) + '</button>';
      }).join('') + '</div>' +
        '<label class="field"><span>مبلغ (تومان)</span>' +
          '<input id="wallet-amount" type="number" inputmode="numeric" min="0" value="' + esc(wallet.price) + '" placeholder="مثلاً 100000"></label>' +
        '<p class="wallet-hint mut tiny">' + esc(hint) + '</p>' +
        '<div class="method-grid">' + wallet.methods.map(function (item) {
          return '<button type="button" class="method-btn' + (item.id === wallet.method ? ' on' : '') + '" data-wmethod="' + esc(item.id) + '">' + esc(item.label) + '</button>';
        }).join('') + '</div>' +
        (wallet.error ? '<p class="buy-error">' + esc(wallet.error) + '</p>' : '') +
        '<div class="sheet-actions"><button class="btn ghost" id="wallet-cancel"' + (wallet.busy ? ' disabled' : '') + '>انصراف</button>' +
        '<button class="btn primary" id="wallet-pay"' + (wallet.busy ? ' disabled' : '') + '>' +
          (wallet.busy ? 'در حال پردازش…' : payLabel) + '</button></div>';
    }
    mountSheet(html);
    var cancel = qs('#wallet-cancel');
    if (cancel) cancel.addEventListener('click', function () { wallet = null; closeSheet(); });
    var amount = qs('#wallet-amount');
    if (amount) amount.addEventListener('input', function () { wallet.price = amount.value; });
    var pay = qs('#wallet-pay');
    if (pay) pay.addEventListener('click', submitWallet);
    document.querySelectorAll('[data-preset]').forEach(function (button) {
      button.addEventListener('click', function () {
        wallet.price = button.getAttribute('data-preset');
        paintWallet();
      });
    });
    document.querySelectorAll('[data-wmethod]').forEach(function (button) {
      button.addEventListener('click', function () {
        wallet.method = button.getAttribute('data-wmethod');
        var selected = walletMethod();
        var price = Number(wallet.price);
        if (selected && (!price || price < selected.min || (selected.max > 0 && price > selected.max))) {
          wallet.price = String(selected.min + wallet.debt);
        }
        wallet.error = '';
        paintWallet();
      });
    });
  }

  async function submitWallet() {
    if (!wallet || wallet.busy) return;
    var method = walletMethod();
    var price = Number(wallet.price);
    if (!method) {
      wallet.error = 'روش پرداخت را انتخاب کنید.';
      paintWallet();
      return;
    }
    var min = Math.max(method.min, wallet.debt);
    if (!price || price < min || (method.max > 0 && price > method.max)) {
      wallet.error = 'مبلغ باید بین ' + fmt(min) + ' تا ' + (method.max > 0 ? fmt(method.max) : 'بدون محدودیت') + ' تومان باشد.';
      paintWallet();
      return;
    }
    wallet.busy = true;
    wallet.error = '';
    paintWallet();
    try {
      var res = await apiPost('wallet_topup', { price: price, method: method.id });
      var obj = res.obj || {};
      if (obj.type === 'cart') {
        haptic('success');
        wallet.cart = {
          order_id: String(obj.order_id || ''),
          price: Number(obj.price || price),
          card_number: String(obj.card_number || ''),
          name_card: String(obj.name_card || ''),
          bot_username: String(obj.bot_username || '')
        };
        wallet.receipt = { preview: '', busy: false, sent: false, error: '' };
        wallet.busy = false;
        paintWallet();
        return;
      }
      haptic('success');
      wallet = null;
      closeSheet();
      toast(obj.type === 'redirect' ? 'برای هماهنگی پرداخت، گفتگو با پشتیبانی باز شد.' : 'لینک پرداخت باز شد؛ پس از پرداخت، موجودی به‌روز می‌شود.');
      window.setTimeout(refreshData, 1200);
      openLink(obj.url);
    } catch (error) {
      haptic('error');
      if (!wallet) return;
      wallet.busy = false;
      wallet.error = error.message;
      paintWallet();
    }
  }

  async function submitReceipt() {
    if (!wallet || !wallet.cart || !wallet.receipt || wallet.receipt.busy) return;
    if (!wallet.receipt.preview) return;
    wallet.receipt.busy = true;
    wallet.receipt.error = '';
    paintWallet();
    try {
      await apiPost('wallet_receipt', { order_id: wallet.cart.order_id, image: wallet.receipt.preview });
      haptic('success');
      wallet.receipt.busy = false;
      wallet.receipt.sent = true;
      wallet.receipt.preview = '';
      paintWallet();
      watchOrder({ order_id: wallet.cart.order_id, kind: 'topup' });
      window.setTimeout(refreshData, 1500);
    } catch (error) {
      haptic('error');
      if (!wallet || !wallet.receipt) return;
      wallet.receipt.busy = false;
      wallet.receipt.error = error.message;
      paintWallet();
    }
  }

  /* ---------- Test account ---------- */

  function testPanel() {
    if (!testFlow || !testFlow.panels) return null;
    for (var i = 0; i < testFlow.panels.length; i++) {
      if (testFlow.panels[i].id === testFlow.panelId) return testFlow.panels[i];
    }
    return null;
  }

  async function openTestSheet() {
    haptic('light');
    testFlow = { loading: true, panels: [], limit: 0, isAdmin: false, panelId: '', username: '', error: '', busy: false };
    paintTest();
    try {
      var res = await apiGet('test_info');
      if (!testFlow) return;
      var info = (res && res.obj) || {};
      testFlow.loading = false;
      testFlow.panels = Array.isArray(info.panels) ? info.panels : [];
      testFlow.limit = Number(info.limit || 0);
      testFlow.isAdmin = !!info.is_admin;
      if (!testFlow.panels.length) {
        testFlow.error = 'سرویس تست در حال حاضر غیرفعال است.';
      } else if (testFlow.limit <= 0 && !testFlow.isAdmin) {
        testFlow.error = 'محدودیت دریافت اکانت تست شما به پایان رسیده است.';
      } else {
        testFlow.panelId = testFlow.panels[0].id;
      }
    } catch (error) {
      if (!testFlow) return;
      testFlow.loading = false;
      testFlow.error = error.message;
    }
    paintTest();
  }

  function paintTest() {
    if (!testFlow) return;
    var html = '<div class="sheet-grip"></div><b class="sheet-title">اکانت تست رایگان</b>';
    if (testFlow.loading) {
      html += '<div class="center-box small"><span class="spinner"></span><p class="mut">در حال بررسی وضعیت…</p></div>';
    } else if (!testFlow.panels.length || (testFlow.limit <= 0 && !testFlow.isAdmin)) {
      html += '<p class="mut">' + esc(testFlow.error || 'اکانت تست در دسترس نیست.') + '</p>' +
        '<div class="sheet-actions"><button class="btn ghost" id="test-cancel">بستن</button></div>';
    } else {
      var panel = testPanel();
      html += '<p class="mut tiny">یک سرویس آزمایشی رایگان برای تست کیفیت اتصال دریافت کنید.</p>' +
        '<div class="sheet-row"><span class="mut">مدت اعتبار</span><b>' + fmt(panel ? panel.hours : 0) + ' ساعت</b></div>' +
        '<div class="sheet-row"><span class="mut">حجم سرویس</span><b>' + fmt(panel ? panel.volume_mb : 0) + ' مگابایت</b></div>' +
        (testFlow.panels.length > 1
          ? '<div class="chips">' + testFlow.panels.map(function (item) {
              return '<button type="button" class="chip-btn' + (item.id === testFlow.panelId ? ' on' : '') + '" data-tpanel="' + esc(item.id) + '">' + esc(item.name) + '</button>';
            }).join('') + '</div>'
          : '') +
        (panel && panel.need_username
          ? '<label class="field"><span>نام کاربری سرویس</span><input id="test-username" dir="ltr" value="' +
            esc(testFlow.username) + '" placeholder="مثلاً mers_test"></label>'
          : '') +
        '<div class="sheet-row"><span class="mut">سهمیه باقی‌مانده</span><span>' + (testFlow.isAdmin ? 'نامحدود (مدیر)' : fmt(testFlow.limit) + ' اکانت') + '</span></div>' +
        (testFlow.error ? '<p class="buy-error">' + esc(testFlow.error) + '</p>' : '') +
        '<div class="sheet-actions"><button class="btn ghost" id="test-cancel"' + (testFlow.busy ? ' disabled' : '') + '>انصراف</button>' +
        '<button class="btn primary" id="test-get"' + (testFlow.busy ? ' disabled' : '') + '>' +
          (testFlow.busy ? 'در حال ساخت…' : 'دریافت اکانت تست') + '</button></div>';
    }
    mountSheet(html);
    var cancel = qs('#test-cancel');
    if (cancel) cancel.addEventListener('click', function () { testFlow = null; closeSheet(); });
    var input = qs('#test-username');
    if (input) input.addEventListener('input', function () { testFlow.username = input.value; });
    var submit = qs('#test-get');
    if (submit) submit.addEventListener('click', submitTest);
    document.querySelectorAll('[data-tpanel]').forEach(function (button) {
      button.addEventListener('click', function () {
        testFlow.panelId = button.getAttribute('data-tpanel');
        testFlow.error = '';
        paintTest();
      });
    });
  }

  async function submitTest() {
    if (!testFlow || testFlow.busy) return;
    var panel = testPanel();
    if (!panel) return;
    if (panel.need_username && !/^[a-z][a-z\d_]{2,32}$/i.test(testFlow.username.trim())) {
      testFlow.error = 'نام کاربری باید با حرف شروع شود و ۳ تا ۳۳ کاراکتر باشد.';
      paintTest();
      return;
    }
    testFlow.busy = true;
    testFlow.error = '';
    paintTest();
    try {
      var body = { country_id: panel.id };
      if (panel.need_username) body.custom_username = testFlow.username.trim();
      await apiPost('test_purchase', body);
      haptic('success');
      testFlow = null;
      closeSheet();
      toast('اکانت تست با موفقیت ساخته شد.');
      refreshData();
      go('services');
    } catch (error) {
      haptic('error');
      if (!testFlow) return;
      testFlow.busy = false;
      testFlow.error = error.message;
      paintTest();
    }
  }

  /* ---------- Renewal ---------- */

  function openRenewSheet(username) {
    haptic('light');
    extendFlow = {
      loading: true, error: '', username: username, products: [], balance: 0, directPay: false,
      selected: '', currentCode: '', current: null, busy: false, buyError: '', pay: null
    };
    paintRenewSheet();
    loadRenewInfo();
  }

  async function loadRenewInfo() {
    if (!extendFlow) return;
    var username = extendFlow.username;
    try {
      var res = await apiGet('extend_info', { username: username });
      if (!extendFlow || extendFlow.username !== username) return;
      var obj = res.obj || {};
      extendFlow.loading = false;
      extendFlow.products = Array.isArray(obj.products) ? obj.products : [];
      extendFlow.balance = Number(obj.balance || 0);
      extendFlow.directPay = obj.direct_pay === true;
      extendFlow.currentCode = String(obj.current_code_product || '');
      extendFlow.current = obj.current || null;
      if (extendFlow.currentCode) {
        var currentIndex = -1;
        for (var i = 0; i < extendFlow.products.length; i++) {
          if (String(extendFlow.products[i].code_product) === extendFlow.currentCode) {
            currentIndex = i;
            break;
          }
        }
        if (currentIndex > 0) {
          var currentProduct = extendFlow.products.splice(currentIndex, 1)[0];
          extendFlow.products.unshift(currentProduct);
        }
      }
      if (extendFlow.products.length && !extendFlow.selected) {
        extendFlow.selected = extendFlow.currentCode || extendFlow.products[0].code_product;
      }
    } catch (error) {
      if (!extendFlow) return;
      extendFlow.loading = false;
      extendFlow.error = error.message;
    }
    paintRenewSheet();
  }

  function renewProduct() {
    if (!extendFlow) return null;
    for (var i = 0; i < extendFlow.products.length; i++) {
      if (extendFlow.products[i].code_product === extendFlow.selected) return extendFlow.products[i];
    }
    return null;
  }

  function paintRenewSheet() {
    closeSheet();
    if (!extendFlow) return;
    var flow = extendFlow;
    var html = '<div class="sheet-grip"></div>' +
      '<div class="sheet-head"><b class="sheet-title">تمدید سرویس</b><span class="mut tiny" dir="ltr">' + esc(flow.username) + '</span></div>';
    if (flow.loading) {
      html += spinner('در حال دریافت پلن‌های تمدید…');
    } else if (flow.error) {
      html += '<p class="buy-error">' + esc(flow.error) + '</p>' +
        '<div class="sheet-actions"><button class="btn ghost" id="renew-cancel">بستن</button>' +
        '<button class="btn primary" id="renew-retry">تلاش مجدد</button></div>';
    } else if (!flow.products.length) {
      html += '<p class="mut">در حال حاضر پلنی برای تمدید این سرویس موجود نیست.</p>' +
        '<div class="sheet-actions"><button class="btn ghost" id="renew-cancel">بستن</button></div>';
    } else {
      var product = renewProduct();
      var insufficient = !!(product && Number(product.price_product) > Number(flow.balance));
      var canDirectPay = insufficient && flow.directPay;
      var diff = insufficient ? Number(product.price_product) - Number(flow.balance) : 0;
      html += '<p class="mut tiny">' +
        (flow.currentCode
          ? 'پلن فعلی شما انتخاب شده است؛ با تمدید، نام کاربری و لینک اشتراک تغییر نمی‌کند.'
          : 'پلن تمدید را انتخاب کنید؛ مبلغ از کیف پول کسر می‌شود.') +
        '</p>' +
        '<div class="list renew-list">' + flow.products.map(function (item) {
          var isCurrent = String(item.code_product) === flow.currentCode;
          return '<button type="button" class="card renew-option' + (flow.selected === item.code_product ? ' on' : '') +
            '" data-renew-code="' + esc(item.code_product) + '">' +
            '<div><b>' + esc(item.name_product) + (isCurrent ? ' <span class="renew-current-tag">پلن فعلی</span>' : '') + '</b><span class="mut tiny">' +
              (Number(item.Service_time) === 0 ? 'زمان نامحدود' : fmt(item.Service_time) + ' روز') + ' — ' +
              (Number(item.Volume_constraint) === 0 ? 'حجم نامحدود' : fmt(item.Volume_constraint) + ' گیگ') + '</span></div>' +
            '<b class="renew-price">' + toman(item.price_product) + '</b>' +
          '</button>';
        }).join('') + '</div>' +
        '<div class="sheet-row"><span class="mut">موجودی کیف پول</span><span>' + toman(flow.balance) + '</span></div>' +
        (canDirectPay
          ? '<div class="sheet-row"><span class="mut">مبلغ قابل پرداخت</span><b>' + toman(diff) + '</b></div>' : '') +
        (insufficient
          ? '<p class="mut tiny">' + (canDirectPay
              ? 'موجودی کیف پول کافی نیست؛ تفاوت مبلغ را همین‌جا پرداخت کنید تا سرویس تمدید شود.'
              : 'موجودی کافی نیست؛ ابتدا کیف پول را شارژ کنید.') + '</p>' : '') +
        (flow.buyError ? '<p class="buy-error">' + esc(flow.buyError) + '</p>' : '') +
        '<div class="sheet-actions"><button class="btn ghost" id="renew-cancel"' + (flow.busy ? ' disabled' : '') + '>انصراف</button>' +
        (insufficient && !canDirectPay
          ? '<button class="btn primary" id="renew-topup">شارژ کیف پول</button>'
          : '<button class="btn primary" id="renew-submit"' + (flow.busy || !flow.selected ? ' disabled' : '') + '>' +
            (flow.busy ? 'در حال تمدید…' : (canDirectPay ? 'پرداخت و تمدید' : (flow.selected === flow.currentCode ? 'تمدید پلن فعلی' : 'تمدید اشتراک'))) + '</button>') +
        '</div>';
    }
    var overlay = document.createElement('div');
    overlay.className = 'sheet-back';
    overlay.id = 'sheet-back';
    overlay.innerHTML = '<div class="sheet" id="sheet">' + html + '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeSheet();
    });
    var cancel = qs('#renew-cancel');
    if (cancel) cancel.addEventListener('click', function () { extendFlow = null; closeSheet(); });
    var retry = qs('#renew-retry');
    if (retry) retry.addEventListener('click', function () {
      flow.loading = true;
      flow.error = '';
      paintRenewSheet();
      loadRenewInfo();
    });
    document.querySelectorAll('[data-renew-code]').forEach(function (button) {
      button.addEventListener('click', function () {
        flow.selected = button.getAttribute('data-renew-code');
        flow.buyError = '';
        paintRenewSheet();
      });
    });
    var submit = qs('#renew-submit');
    if (submit) submit.addEventListener('click', submitRenew);
    var topup = qs('#renew-topup');
    if (topup) topup.addEventListener('click', function () {
      extendFlow = null;
      closeSheet();
      openWalletSheet();
    });
  }

  async function submitRenew() {
    if (!extendFlow || extendFlow.busy || !extendFlow.selected) return;
    var flow = extendFlow;
    flow.busy = true;
    flow.buyError = '';
    paintRenewSheet();
    try {
      var res = await apiPost('extend_purchase', { username: flow.username, code_product: flow.selected });
      if (res && res.requires_payment && res.payment) {
        var payment = res.payment;
        var methods = Array.isArray(payment.methods) ? payment.methods : [];
        if (!methods.length) throw new Error('در حال حاضر روش پرداخت فعالی موجود نیست.');
        flow.busy = false;
        flow.pay = {
          amount: Number(payment.amount || 0),
          price: Number(payment.price || 0),
          balance: Number(payment.balance || 0),
          username: payment.username || flow.username,
          code_product: payment.code_product || flow.selected,
          methods: methods,
          method: methods[0].id,
          busy: false,
          error: '',
          cart: null,
          receipt: { preview: '', busy: false, sent: false, error: '' }
        };
        haptic('light');
        paintRenewPaySheet();
        return;
      }
      haptic('success');
      var username = flow.username;
      extendFlow = null;
      closeSheet();
      toast('سرویس با موفقیت تمدید شد.');
      refreshData();
      var route = parseRoute();
      if (route.name === 'service') renderServiceDetail(username);
      else if (route.name === 'services') loadServices();
    } catch (error) {
      haptic('error');
      if (!extendFlow) return;
      extendFlow.busy = false;
      extendFlow.buyError = error.message;
      paintRenewSheet();
    }
  }

  function paintRenewPaySheet() {
    closeSheet();
    if (!extendFlow || !extendFlow.pay) return;
    var pay = extendFlow.pay;
    var html = '<div class="sheet-grip"></div>' +
      '<div class="sheet-head"><b class="sheet-title">پرداخت تمدید</b><span class="secure-tag">پرداخت امن</span></div>';
    if (pay.cart) {
      var receipt = pay.receipt || {};
      html += '<div class="card-info">' +
        '<div class="ci-row"><span>مبلغ قابل پرداخت</span><b>' + fmt(pay.cart.price) + ' تومان</b></div>' +
        '<div class="ci-row"><span>شماره کارت</span><b class="ci-value">' + esc(pay.cart.card_number) + '</b>' +
        '<button type="button" class="ci-copy" data-copy="' + esc(pay.cart.card_number) + '" data-label="شماره کارت">کپی</button></div>' +
        '<div class="ci-row"><span>به نام</span><b>' + esc(pay.cart.name_card) + '</b></div></div>' +
        '<div class="receipt-box">' +
        '<p class="receipt-hint">پس از واریز، تصویر رسید را همین‌جا ارسال کنید.</p>' +
        '<input type="file" id="renew-receipt-file" accept="image/*" hidden>' +
        (receipt.preview ? '<div class="receipt-preview"><img src="' + receipt.preview + '" alt="رسید"></div>' : '') +
        '<button class="btn receipt-pick" id="renew-receipt-pick"' + (receipt.busy ? ' disabled' : '') + '>' +
        (receipt.preview ? 'تغییر تصویر' : 'انتخاب تصویر رسید') + '</button>' +
        '<button class="btn primary" id="renew-receipt-send"' + (!receipt.preview || receipt.busy || receipt.sent ? ' disabled' : '') + '>' +
        (receipt.sent ? 'رسید ارسال شد' : (receipt.busy ? 'در حال ارسال…' : 'تأیید و ارسال رسید')) + '</button>' +
        (receipt.sent ? '<p class="ok-note">رسید شما ارسال شد؛ پس از تأیید، سرویس تمدید می‌شود.</p>' : '') +
        (receipt.error ? '<p class="buy-error">' + esc(receipt.error) + '</p>' : '') +
        '</div>' +
        '<div class="sheet-actions"><button class="btn ghost" id="renew-pay-close">بستن</button>' +
        '<button class="btn ghost" id="renew-pay-bot"' + (pay.cart.bot_username ? '' : ' disabled') + '>ارسال از طریق ربات</button></div>';
    } else {
      html += '<div class="sheet-row"><span class="mut">مبلغ تمدید</span><b>' + toman(pay.price) + '</b></div>' +
        (pay.balance > 0 ? '<div class="sheet-row"><span class="mut">موجودی کیف پول</span><span>' + toman(pay.balance) + '</span></div>' : '') +
        '<div class="sheet-row"><span class="mut">مبلغ قابل پرداخت</span><b>' + toman(pay.amount) + '</b></div>' +
        (pay.balance > 0
          ? '<div class="pay-notice"><p>موجودی کیف پول شما <b>' + toman(pay.balance) + '</b> از مبلغ تمدید کسر می‌شود؛ مابه‌التفاوت <b>' + toman(pay.amount) + '</b> را مستقیم پرداخت می‌کنید تا سرویس با همان نام کاربری و لینک تمدید شود.</p></div>'
          : '<p class="pay-direct-note">پرداخت مستقیم (درگاه یا کارت‌به‌کارت)؛ پس از پرداخت، سرویس با همان نام کاربری و لینک تمدید می‌شود.</p>') +
        '<div class="chips pay-methods">' + pay.methods.map(function (item) {
          return '<button type="button" class="chip-btn' + (pay.method === item.id ? ' on' : '') + '" data-renew-pay-method="' + esc(item.id) + '">' + esc(item.label) + '</button>';
        }).join('') + '</div>' +
        (pay.error ? '<p class="buy-error">' + esc(pay.error) + '</p>' : '') +
        '<div class="sheet-actions"><button class="btn ghost" id="renew-pay-back"' + (pay.busy ? ' disabled' : '') + '>بازگشت</button>' +
        '<button class="btn primary" id="renew-pay-submit"' + (pay.busy || !pay.method ? ' disabled' : '') + '>' +
        (pay.busy ? 'در حال اتصال…' : 'پرداخت') + '</button></div>';
    }
    var overlay = document.createElement('div');
    overlay.className = 'sheet-back';
    overlay.id = 'sheet-back';
    overlay.innerHTML = '<div class="sheet" id="sheet">' + html + '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeSheet();
    });
    if (pay.cart) {
      var close = qs('#renew-pay-close');
      if (close) close.addEventListener('click', function () { extendFlow = null; closeSheet(); });
      var file = qs('#renew-receipt-file');
      var pick = qs('#renew-receipt-pick');
      if (pick) pick.addEventListener('click', function () { file.click(); });
      if (file) file.addEventListener('change', async function () {
        if (!file.files || !file.files[0]) return;
        try {
          pay.receipt.preview = await readReceipt(file.files[0]);
          pay.receipt.error = '';
        } catch (error) {
          pay.receipt.error = 'خواندن تصویر ممکن نشد.';
        }
        paintRenewPaySheet();
      });
      var send = qs('#renew-receipt-send');
      if (send) send.addEventListener('click', submitRenewReceipt);
      var botBtn = qs('#renew-pay-bot');
      if (botBtn) botBtn.addEventListener('click', function () {
        if (pay.cart.bot_username) openLink('https://t.me/' + pay.cart.bot_username);
      });
    } else {
      var back = qs('#renew-pay-back');
      if (back) back.addEventListener('click', function () {
        if (!extendFlow) return;
        extendFlow.pay = null;
        paintRenewSheet();
      });
      qs('#renew-pay-submit').addEventListener('click', submitRenewPay);
      document.querySelectorAll('[data-renew-pay-method]').forEach(function (button) {
        button.addEventListener('click', function () {
          pay.method = button.getAttribute('data-renew-pay-method');
          pay.error = '';
          paintRenewPaySheet();
        });
      });
    }
  }

  async function submitRenewPay() {
    if (!extendFlow || !extendFlow.pay || extendFlow.pay.busy) return;
    var pay = extendFlow.pay;
    pay.busy = true;
    pay.error = '';
    paintRenewPaySheet();
    try {
      var res = await apiPost('extend_pay', { username: pay.username, code_product: pay.code_product, method: pay.method });
      var obj = res.obj || {};
      if (obj.type === 'cart') {
        pay.cart = obj;
        pay.busy = false;
        pay.receipt = { preview: '', busy: false, sent: false, error: '' };
        watchOrder({ order_id: obj.order_id, username: pay.username, kind: 'extend' });
        paintRenewPaySheet();
        return;
      }
      pay.busy = false;
      haptic('success');
      toast('لینک پرداخت باز شد؛ پس از پرداخت سرویس تمدید می‌شود.');
      if (obj.order_id) watchOrder({ order_id: obj.order_id, username: pay.username, kind: 'extend' });
      extendFlow = null;
      closeSheet();
      if (obj.url) openLink(obj.url);
    } catch (error) {
      pay.busy = false;
      pay.error = error.message;
      haptic('error');
      paintRenewPaySheet();
    }
  }

  async function submitRenewReceipt() {
    if (!extendFlow || !extendFlow.pay || !extendFlow.pay.cart) return;
    var pay = extendFlow.pay;
    var receipt = pay.receipt;
    if (!receipt.preview || receipt.busy) return;
    receipt.busy = true;
    receipt.error = '';
    paintRenewPaySheet();
    try {
      await apiPost('wallet_receipt', { order_id: pay.cart.order_id, image: receipt.preview });
      receipt.sent = true;
      receipt.busy = false;
      watchOrder({ order_id: pay.cart.order_id, username: pay.username, kind: 'extend' });
      haptic('success');
      paintRenewPaySheet();
    } catch (error) {
      receipt.busy = false;
      receipt.error = error.message;
      haptic('error');
      paintRenewPaySheet();
    }
  }

  /* ---------- Invite friends ---------- */

  async function openInviteSheet() {
    haptic('light');
    try {
      var res = await apiGet('user_info');
      if (res && res.obj) {
        state.info = res.obj;
        updateBalancePill();
      }
    } catch (error) {}
    paintInviteSheet();
  }

  function paintInviteSheet() {
    var info = state.info || {};
    var enabled = !!info.affiliates_enabled;
    var link = enabled && typeof info.invite_link === 'string' ? info.invite_link : '';
    var code = info.codeInvitation || '';
    var body = '';
    if (enabled && link) {
      body =
        '<div class="invite-link-box" dir="ltr">' + esc(link) + '</div>' +
        '<p class="invite-note">این لینک مخصوص شماست؛ با بازکردن آن توسط دوستانتان، زیرمجموعه شما ثبت می‌شود.</p>' +
        '<div class="sheet-actions">' +
          '<button class="btn primary" data-copy="' + esc(link) + '" data-label="لینک دعوت">کپی لینک دعوت</button>' +
          '<button class="btn ghost" id="invite-share">ارسال به دوستان</button>' +
        '</div>';
    } else {
      body = '<div class="invite-off">بخش دعوت دوستان توسط مدیریت ربات غیرفعال شده است.</div>';
    }
    mountSheet(
      '<div class="sheet-head"><b class="sheet-title">دعوت دوستان</b><span class="mut tiny">' + fmt(info.affiliatescount || 0) + ' زیرمجموعه</span></div>' +
      '<div class="invite-sheet">' +
        body +
        '<div class="invite-code-box"><div><small class="mut">کد معرف شما</small><b class="invite-code" dir="ltr">' + esc(code || '—') + '</b></div>' +
          '<button type="button" class="ci-copy" data-copy="' + esc(code) + '" data-label="کد دعوت">کپی</button></div>' +
      '</div>' +
      '<div class="sheet-actions"><button class="btn ghost" id="invite-close">بستن</button></div>'
    );
    qs('#invite-close').addEventListener('click', closeSheet);
    var share = qs('#invite-share');
    if (share) {
      share.addEventListener('click', function () {
        openLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('به MersConnect بپیوندید'));
      });
    }
  }

  /* ---------- Support chat ---------- */

  function openSupportSheet() {
    haptic('light');
    support = {
      loading: true, error: '', departments: [], messages: [],
      dept: 0, text: '', sending: false, sendError: ''
    };
    paintSupport();
    loadSupport(false);
  }

  async function loadSupport(silent) {
    if (!support) return;
    try {
      var res = await apiGet('support_info');
      if (!support) return;
      var obj = res.obj || {};
      support.loading = false;
      support.error = '';
      support.departments = Array.isArray(obj.departments) ? obj.departments : [];
      support.messages = Array.isArray(obj.messages) ? obj.messages : [];
      if (!support.dept && support.departments.length) support.dept = support.departments[0].id;
      if (!silent || !(document.activeElement && document.activeElement.id === 'support-text')) {
        paintSupport();
      }
    } catch (error) {
      if (!support) return;
      support.loading = false;
      support.error = error.message;
      paintSupport();
    }
  }

  function paintSupport() {
    closeSheet();
    if (!support) return;
    var chat = support;
    var messages = chat.messages.map(function (item) {
      var userBubble = '<div class="chat-msg user"><div class="bubble"><p>' + esc(item.text) + '</p>' +
        '<small>' + esc(item.time) + '</small></div></div>';
      var adminBubble = item.result
        ? '<div class="chat-msg admin"><div class="bubble"><span class="chat-from">پاسخ پشتیبانی</span><p>' + esc(item.result) + '</p>' +
          '<small>' + esc(item.department) + '</small></div></div>'
        : '';
      return userBubble + adminBubble;
    }).join('');
    var html = '<div class="sheet-grip"></div>' +
      '<div class="sheet-head"><b class="sheet-title">پشتیبانی</b>' +
        '<button type="button" class="link" id="support-refresh">به‌روزرسانی</button></div>';
    if (chat.loading) {
      html += spinner('در حال دریافت گفتگو…');
    } else {
      if (chat.error) html += '<p class="buy-error">' + esc(chat.error) + '</p>';
      html += '<div class="support-thread" id="support-thread">' +
        (messages || '<p class="mut tiny">هنوز پیامی رد و بدل نشده است. اولین پیام خود را بنویسید.</p>') + '</div>';
      if (!chat.departments.length) {
        html += '<p class="buy-error">دپارتمان پشتیبانی فعالی یافت نشد.</p>';
      } else {
        html += '<label class="field"><span>دپارتمان</span><select id="support-dept">' +
          chat.departments.map(function (item) {
            return '<option value="' + esc(item.id) + '"' + (String(chat.dept) === String(item.id) ? ' selected' : '') + '>' + esc(item.name) + '</option>';
          }).join('') + '</select></label>' +
          '<label class="field"><span>پیام شما</span><textarea id="support-text" rows="3" maxlength="2000" placeholder="پیام خود را بنویسید…">' + esc(chat.text) + '</textarea></label>' +
          (chat.sendError ? '<p class="buy-error">' + esc(chat.sendError) + '</p>' : '') +
          '<div class="sheet-actions"><button class="btn ghost" id="support-cancel">بستن</button>' +
          '<button class="btn primary" id="support-send"' + (chat.sending ? ' disabled' : '') + '>' +
          (chat.sending ? 'در حال ارسال…' : 'ارسال پیام') + '</button></div>';
      }
    }
    var overlay = document.createElement('div');
    overlay.className = 'sheet-back';
    overlay.id = 'sheet-back';
    overlay.innerHTML = '<div class="sheet" id="sheet">' + html + '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeSheet();
    });
    var thread = qs('#support-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
    var refresh = qs('#support-refresh');
    if (refresh) refresh.addEventListener('click', function () { loadSupport(false); });
    var cancel = qs('#support-cancel');
    if (cancel) cancel.addEventListener('click', function () { support = null; closeSheet(); });
    var dept = qs('#support-dept');
    if (dept) dept.addEventListener('change', function () { chat.dept = Number(dept.value); });
    var input = qs('#support-text');
    if (input) input.addEventListener('input', function () { chat.text = input.value; });
    var send = qs('#support-send');
    if (send) send.addEventListener('click', submitSupport);
    clearInterval(supportTimer);
    supportTimer = window.setInterval(function () {
      if (support && document.visibilityState === 'visible') loadSupport(true);
    }, 15000);
  }

  async function submitSupport() {
    if (!support || support.sending) return;
    var text = String(support.text || '').trim();
    if (!text) {
      support.sendError = 'متن پیام را وارد کنید.';
      paintSupport();
      return;
    }
    support.sending = true;
    support.sendError = '';
    paintSupport();
    try {
      var res = await apiPost('support_send', { department_id: support.dept, text: text });
      haptic('success');
      if (!support) return;
      support.sending = false;
      support.text = '';
      if (res.obj) support.messages.push(res.obj);
      paintSupport();
      toast('پیام شما برای پشتیبانی ارسال شد.');
    } catch (error) {
      haptic('error');
      if (!support) return;
      support.sending = false;
      support.sendError = error.message;
      paintSupport();
    }
  }

  /* ---------- Global interactions ---------- */

  document.addEventListener('click', function (event) {
    var target = event.target.closest('[data-configs]');
    if (target) {
      haptic('light');
      openConfigSheet(serviceConfigPages, 'دریافت کانفیگ');
      return;
    }

    target = event.target.closest('[data-renew]');
    if (target) {
      openRenewSheet(target.getAttribute('data-renew'));
      return;
    }

    target = event.target.closest('#theme-toggle');
    if (target) {
      haptic('light');
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true);
      return;
    }

    target = event.target.closest('[data-invite]');
    if (target) {
      openInviteSheet();
      return;
    }

    target = event.target.closest('[data-support]');
    if (target) {
      openSupportSheet();
      return;
    }

    target = event.target.closest('[data-nav]');
    if (target) {
      go(target.getAttribute('data-nav'));
      return;
    }

    target = event.target.closest('[data-open]');
    if (target) {
      openLink(target.getAttribute('data-open'));
      return;
    }

    target = event.target.closest('[data-toast]');
    if (target) {
      toast(target.getAttribute('data-toast'));
      return;
    }

    target = event.target.closest('[data-wallet]');
    if (target) {
      openWalletSheet();
      return;
    }

    target = event.target.closest('[data-test]');
    if (target) {
      openTestSheet();
      return;
    }

    target = event.target.closest('[data-copy]');
    if (target) {
      var text = target.getAttribute('data-copy');
      var label = target.getAttribute('data-label') || 'متن';
      copyText(text).then(function (ok) {
        haptic(ok ? 'light' : 'error');
        toast(ok ? label + ' کپی شد' : 'کپی انجام نشد');
      });
    }
  });

  window.addEventListener('hashchange', function () {
    if (state.info) renderRoute();
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      if (state.info) refreshData();
      if (orderWatch) checkOrderStatus();
    }
  });

  async function boot() {
    var app = tg();
    try {
      if (app) {
        app.ready();
        app.expand();
        applyTheme(currentTheme(), false);
      }
    } catch (error) {}

    state.me = app && app.initDataUnsafe ? app.initDataUnsafe.user || null : null;
    initData = app ? app.initData || '' : '';

    if (!initData) {
      renderFatal('این صفحه فقط داخل تلگرام باز می‌شود. مینی‌اپ را از دکمه ربات اجرا کنید.');
      return;
    }

    shell();
    applyTheme(currentTheme(), false);
    content.innerHTML = spinner('در حال اتصال…');

    try {
      await verify(initData);
      await loadCore();
    } catch (error) {
      renderFatal(error.message || 'خطای ناشناخته');
      return;
    }

    if (app && app.BackButton) {
      app.BackButton.onClick(function () { window.history.back(); });
    }

    try {
      var storedOrder = sessionStorage.getItem(ORDER_KEY);
      if (storedOrder) {
        var pendingOrder = JSON.parse(storedOrder);
        if (pendingOrder && pendingOrder.order_id) watchOrder(pendingOrder);
      }
    } catch (error) {}

    renderRoute();
  }

  boot();
})();
