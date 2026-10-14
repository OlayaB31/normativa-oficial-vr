(() => {
  'use strict';
  const { api, esc, fmtDate, fmtDateTime } = App;
  const Admin = (window.Admin = { user: null });

  const NAV = [['resumen', 'index.html', 'Resumen'], ['estructura', 'categorias.html', 'Estructura'], ['articulos', 'normativa.html', 'Artículos'], ['ajustes', 'configuracion.html', 'Configuración']];

  /** Comprueba la sesión y dibuja la barra de navegación. Devuelve false si redirige al acceso. */
  Admin.init = async (active) => {
    let s;
    try { s = await api('auth.php'); }
    catch (e) {
      document.body.innerHTML = `<main class="admin-main"><h1>No se pudo conectar</h1><p>${esc(e.message)}</p></main>`;
      return false;
    }
    if (!s.authenticated) { location.replace('login.html'); return false; }
    App.csrf = s.csrf;
    Admin.user = s.user;
    const bar = document.querySelector('[data-adminbar]');
    bar.className = 'masthead';
    bar.innerHTML = `<div class="pill">
      <a class="brand" href="index.html">
        <img class="brand-gif" src="../assets/img/logo-vr.gif" alt="">
        <span class="brand-text">
          <strong data-server-name>Normativa</strong>
          <small>Administración</small>
        </span>
      </a>
      <nav class="adminnav" aria-label="Panel">${NAV.map(([k, h, l]) => `<a href="${h}"${k === active ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <div class="tools"><span class="who">${esc(s.user.display_name)}</span><a class="btn btn-sm" href="../index.html" target="_blank" rel="noopener">Ver sitio</a>${App.themeButton()}<button class="btn btn-sm" id="logout">Salir</button></div></div>`;
    document.getElementById('logout').addEventListener('click', async () => {
      try { await api('auth.php', { method: 'POST', body: { action: 'logout' } }); } catch {}
      location.replace('login.html');
    });
    App.ready.then((cfg) => document.querySelectorAll('[data-server-name]').forEach((el) => (el.textContent = cfg.server_name || 'Normativa')));
    return true;
  };

  /* ---------- Diálogos ---------- */
  Admin.confirm = (message, { title = 'Confirmar', ok = 'Aceptar', danger = false } = {}) => new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><p>${esc(message)}</p><div class="modal-actions"><button class="btn" value="cancel">Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="ok">${esc(ok)}</button></div></form>`;
    document.body.append(dlg);
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); dlg.remove(); });
    dlg.showModal();
  });

  const fieldHtml = (f) => {
    const id = 'f-' + f.name;
    const v = f.value ?? '';
    let ctl;
    if (f.type === 'textarea') ctl = `<textarea id="${id}" name="${f.name}" maxlength="${f.max || 500}">${esc(v)}</textarea>`;
    else if (f.type === 'select') {
      ctl = `<select id="${id}" name="${f.name}">${f.options.map((o) => o.group
        ? `<optgroup label="${esc(o.group)}">${o.items.map((i) => `<option value="${esc(i.value)}"${String(i.value) === String(v) ? ' selected' : ''}>${esc(i.label)}</option>`).join('')}</optgroup>`
        : `<option value="${esc(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else ctl = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" maxlength="${f.max || 200}" autocomplete="off">`;
    return `<label class="fld" for="${id}">${esc(f.label)}${ctl}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
  };

  /** Formulario modal. onSubmit(values) puede lanzar un error: se muestra sin cerrar el diálogo. */
  Admin.form = ({ title, fields, submit = 'Guardar', onSubmit }) => new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `<form novalidate><h2>${esc(title)}</h2>${fields.map(fieldHtml).join('')}<p class="form-error" role="alert" hidden></p><div class="modal-actions"><button type="button" class="btn" data-cancel>Cancelar</button><button class="btn btn-primary" type="submit">${esc(submit)}</button></div></form>`;
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    const errBox = dlg.querySelector('.form-error');
    let saved = false;
    dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { resolve(saved); dlg.remove(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const missing = fields.find((f) => f.required && !String(values[f.name] || '').trim());
      if (missing) { errBox.textContent = `El campo «${missing.label}» es obligatorio.`; errBox.hidden = false; return; }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try { await onSubmit(values); saved = true; dlg.close(); }
      catch (err) { errBox.textContent = err.message; errBox.hidden = false; btn.disabled = false; }
    });
    dlg.showModal();
    form.querySelector('input,select,textarea')?.focus();
  });

  /* ---------- Acceso (login.html) ---------- */
  Admin.login = async () => {
    const slot = document.querySelector('[data-theme-slot]');
    if (slot) slot.innerHTML = App.themeButton();
    const box = document.getElementById('login-box');
    let s;
    try { s = await api('auth.php'); }
    catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    App.csrf = s.csrf;
    if (s.authenticated) { location.replace('index.html'); return; }
    const setup = s.needs_setup;
    box.innerHTML = `
      <h2>${setup ? 'Crear el primer administrador' : 'Acceso administrativo'}</h2>
      <p class="hint">${setup ? 'Aún no hay usuarios. Esta cuenta tendrá control total del panel.' : 'Introduce tus credenciales para gestionar la normativa.'}</p>
      <form id="login-form" novalidate>
        <label class="fld" for="u">Usuario<input id="u" name="username" type="text" autocomplete="username" required maxlength="40"></label>
        ${setup ? '<label class="fld" for="dn">Nombre visible<input id="dn" name="display_name" type="text" maxlength="80"></label>' : ''}
        <label class="fld" for="p">Contraseña<input id="p" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required maxlength="200">${setup ? '<small>Mínimo 10 caracteres.</small>' : ''}</label>
        ${setup ? '<label class="fld" for="p2">Repite la contraseña<input id="p2" name="password2" type="password" autocomplete="new-password" maxlength="200"></label>' : ''}
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">${setup ? 'Crear administrador' : 'Entrar'}</button>
      </form>`;
    const form = document.getElementById('login-form');
    const err = form.querySelector('.form-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      err.hidden = true;
      if (!v.username.trim() || !v.password) { err.textContent = 'Completa usuario y contraseña.'; err.hidden = false; return; }
      if (setup && v.password !== v.password2) { err.textContent = 'Las contraseñas no coinciden.'; err.hidden = false; return; }
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        await api('auth.php', { method: 'POST', body: { action: setup ? 'setup' : 'login', username: v.username, password: v.password, display_name: v.display_name } });
        location.replace('index.html');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    });
    document.getElementById('u').focus();
  };

  /* ---------- Resumen (index.html) ---------- */
  Admin.dashboard = async () => {
    const s = await api('stats.php');
    document.getElementById('figures').innerHTML = `
      <div><dt>Artículos</dt><dd>${s.articles.total}</dd><small>${s.articles.published} publicados, ${s.articles.draft} en borrador, ${s.articles.archived} archivados</small></div>
      <div><dt>Categorías</dt><dd>${s.categories}</dd><small>${s.sections} apartados y ${s.tags} etiquetas</small></div>
      <div><dt>Última actualización</dt><dd class="date">${s.last_update ? fmtDate(s.last_update) : 'Sin datos'}</dd><small>${s.last_update ? String(s.last_update).slice(11, 16) + ' h' : ''}</small></div>`;
    document.getElementById('activity').innerHTML = s.activity.length
      ? s.activity.map((a) => `<tr><td>${fmtDateTime(a.created_at)}</td><td class="ttl"><a href="normativa.html#/editar/${a.id}">${a.number ? esc(a.number) + '. ' : ''}${esc(a.title)}</a></td><td>v${a.version_no}</td><td>${esc(a.change_note || '')}</td><td>${esc(a.author || 'Sistema')}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">Aún no hay actividad.</td></tr>';
  };

  /* ---------- Configuración ---------- */
  Admin.settings = async () => {
    const f = document.getElementById('settings-form');
    const cfg = await api('settings.php');
    Object.entries(cfg).forEach(([k, v]) => { if (f.elements[k]) f.elements[k].value = v; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const settings = Object.fromEntries(['server_name', 'tagline', 'description', 'footer_text'].map((k) => [k, f.elements[k].value]));
        await api('settings.php', { method: 'POST', body: { settings } });
        App.toast('Configuración guardada');
      } catch (ex) { App.toast(ex.message, true); }
    });
    const pf = document.getElementById('password-form');
    pf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(pf));
      if (v.new !== v.repeat) return App.toast('Las contraseñas nuevas no coinciden', true);
      try {
        await api('auth.php', { method: 'POST', body: { action: 'password', current: v.current, new: v.new } });
        pf.reset();
        App.toast('Contraseña actualizada');
      } catch (ex) { App.toast(ex.message, true); }
    });
  };
})();
