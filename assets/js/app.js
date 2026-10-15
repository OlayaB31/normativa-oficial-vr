(() => {
  'use strict';
  const doc = document.documentElement;
  const App = (window.App = { csrf: null, base: doc.dataset.base || '', settings: {} });

  App.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  App.fmtDate = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
  App.fmtDateTime = (s) => (s ? `${App.fmtDate(s)} ${String(s).slice(11, 16)}` : '');
  App.pad = (n) => String(n).padStart(2, '0');
  const FOLD = { á: 'a', à: 'a', ä: 'a', â: 'a', é: 'e', è: 'e', ë: 'e', ê: 'e', í: 'i', ì: 'i', ï: 'i', î: 'i', ó: 'o', ò: 'o', ö: 'o', ô: 'o', ú: 'u', ù: 'u', ü: 'u', û: 'u', ñ: 'n', ç: 'c' };
  App.fold = (s) => String(s).toLowerCase().replace(/[áàäâéèëêíìïîóòöôúùüûñç]/g, (c) => FOLD[c]);

  App.highlight = (text, terms) => {
    const f = App.fold(text);
    const ranges = [];
    (terms || []).forEach((t) => {
      const ft = App.fold(t);
      if (!ft) return;
      for (let i = f.indexOf(ft); i !== -1; i = f.indexOf(ft, i + ft.length)) ranges.push([i, i + ft.length]);
    });
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    ranges.forEach((r) => {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    });
    let html = '', pos = 0;
    merged.forEach(([a, b]) => {
      html += App.esc(text.slice(pos, a)) + '<mark>' + App.esc(text.slice(a, b)) + '</mark>';
      pos = b;
    });
    return html + App.esc(text.slice(pos));
  };

  App.api = async (path, { method = 'GET', body } = {}) => {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (method !== 'GET' && App.csrf) opts.headers['X-CSRF-Token'] = App.csrf;
    let res;
    try { res = await fetch(App.base + 'api/' + path, opts); }
    catch { throw new Error('No se pudo conectar con el servidor'); }
    let json;
    try { json = await res.json(); }
    catch { throw new Error('El servidor devolvió una respuesta no válida. Comprueba que PHP y MySQL estén configurados.'); }
    if (!json.success) {
      const err = new Error(json.message || 'No se pudo completar la operación');
      err.status = res.status;
      err.data = json;
      throw err;
    }
    return json.data;
  };

  App.toast = (msg, isError = false) => {
    let box = document.querySelector('.toast-box');
    if (!box) { box = document.createElement('div'); box.className = 'toast-box'; box.setAttribute('role', 'status'); document.body.append(box); }
    const t = document.createElement('div');
    t.className = 'toast' + (isError ? ' err' : '');
    t.textContent = msg;
    box.append(t);
    setTimeout(() => t.remove(), isError ? 5000 : 2600);
  };

  App.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    App.toast('Enlace copiado');
  };

  App.typing = (e) => {
    const t = e.target;
    return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || e.ctrlKey || e.metaKey || e.altKey;
  };

  const themeLabel = () => (doc.dataset.theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  const syncThemeButtons = () => document.querySelectorAll('[data-theme-toggle]').forEach((b) => { b.setAttribute('aria-label', themeLabel()); b.title = themeLabel(); });
  App.toggleTheme = () => {
    const next = doc.dataset.theme === 'dark' ? 'light' : 'dark';
    doc.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
    syncThemeButtons();
  };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-theme-toggle]')) App.toggleTheme(); });
  App.themeButton = () => `<button type="button" class="icon-btn" data-theme-toggle aria-label="${themeLabel()}" title="${themeLabel()}">
    <svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
    <svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>
  </button>`;

  const NAV = [['inicio', 'index.html', 'Inicio'], ['normativa', 'normativa.html', 'Normativa'], ['buscar', 'buscar.html', 'Buscar'], ['normativa-armas', 'normativa-armas.html', 'Normativa de Armas']];

  function renderChrome() {
    const head = document.querySelector('[data-masthead]');
    if (head) {
      const active = head.dataset.active;
      head.innerHTML = `
        <div class="pill">
          <a class="brand" href="index.html" aria-label="Inicio">
            <img class="brand-gif" src="assets/img/logo-vr.gif" alt="">
            <span class="brand-text"><strong data-server-name>Normativa</strong></span>
          </a>
          <nav class="mainnav" aria-label="Principal">${NAV.map(([k, h, l]) => `<a href="${h}"${k === active ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
          ${active === 'inicio' || active === 'buscar' || active === 'normativa-armas' ? '' : `
          <form class="quick-search" role="search" action="buscar.html">
            <label class="sr-only" for="qs-input">Buscar normativa</label>
            <input id="qs-input" type="search" name="q" placeholder="Buscar normativa" autocomplete="off" aria-controls="qs-list">
            <kbd>/</kbd>
            <div class="qs-list" id="qs-list" hidden></div>
          </form>`}
          <div class="tools">${App.themeButton()}</div>
        </div>`;
    }
    const foot = document.querySelector('[data-footer]');
    if (foot) {
      foot.innerHTML = `
        <div class="wrap footer-main">
          <div class="footer-brand">
            <a class="brand" href="index.html"><img class="brand-gif" src="assets/img/logo-vr.gif" alt=""><span class="brand-text"><strong data-server-name>Normativa</strong></span></a>
            <p data-footer-text></p>
          </div>
          <nav aria-label="Pie"><h2>Normativa</h2><ul><li><a href="normativa.html">Índice</a></li><li><a href="buscar.html">Buscar</a></li><li><a href="normativa-armas.html">Normativa de Armas</a></li></ul></nav>
          <div><h2>Gestión</h2><ul><li><a href="admin/login.html">Acceso administrativo</a></li></ul></div>
        </div>
        <div class="footer-base"><div class="wrap"><span>© ${new Date().getFullYear()} <span data-server-name>Normativa</span></span></div></div>`;
    }
    syncThemeButtons();
  }

  function applySettings(s) {
    App.settings = s || {};
    document.querySelectorAll('[data-server-name]').forEach((el) => (el.textContent = s.server_name || 'Normativa'));
    document.querySelectorAll('[data-tagline]').forEach((el) => (el.textContent = s.tagline || 'Reglamento y disposiciones de Vida Rol.'));
    document.querySelectorAll('[data-footer-text]').forEach((el) => (el.textContent = s.footer_text || ''));
  }

  App.ready = (async () => {
    renderChrome();
    try { applySettings(await App.api('settings.php')); } catch { applySettings({}); }
    return App.settings;
  })();

  function initQuickSearch() {
    const form = document.querySelector('.quick-search');
    if (!form) return;
    const input = form.querySelector('input');
    const list = form.querySelector('.qs-list');
    let timer, token = 0, items = [], sel = -1;
    const close = () => { list.hidden = true; sel = -1; };
    const mark = () => items.forEach((a, i) => a.classList.toggle('on', i === sel));

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) return close();
      timer = setTimeout(async () => {
        const my = ++token;
        try {
          const r = await App.api('search.php?limit=6&q=' + encodeURIComponent(q));
          if (my !== token) return;
          list.innerHTML = r.items.length
            ? r.items.map((i) => `<a href="normativa.html?a=${encodeURIComponent(i.slug)}">${i.number ? `<span class="plate plate-sm">${App.esc(i.number)}</span>` : ''}<span>${App.highlight(i.title, r.terms)}</span><span class="qs-cat">${App.esc(i.category)}</span></a>`).join('') +
              `<a class="qs-all" href="buscar.html?q=${encodeURIComponent(q)}">Ver los ${r.total} resultados</a>`
            : '<div class="qs-empty">Sin resultados para esa búsqueda.</div>';
          items = [...list.querySelectorAll('a:not(.qs-all)')];
          list.hidden = false; sel = -1;
        } catch { close(); }
      }, 200);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); input.blur(); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !list.hidden && items.length) {
        e.preventDefault();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        mark();
      } else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); items[sel].click(); }
    });
    document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
  }

  document.addEventListener('keydown', (e) => {
    if (App.typing(e)) return;
    if (e.key === '/') {
      const q = document.querySelector('.quick-search input, .hero-search input, .search-form input');
      if (q) { e.preventDefault(); q.focus(); q.select(); }
    } else if (e.key === 't') App.toggleTheme();
  });

  App.ready.then(initQuickSearch);
})();
