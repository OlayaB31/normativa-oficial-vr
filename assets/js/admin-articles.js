(async () => {
  'use strict';
  const { api, esc, fmtDate, fmtDateTime } = App;
  if (!(await Admin.init('articulos'))) return;

  const view = document.getElementById('view');
  const STATUS = { draft: 'Borrador', published: 'Publicado', archived: 'Archivado' };
  let cats = [], secs = [];
  const q = new URLSearchParams(location.search);
  const F = { q: '', status: '', category_id: q.get('category_id') || '', section_id: q.get('section_id') || '', page: 1 };
  let dirty = false;

  async function loadRefs() {
    [cats, secs] = await Promise.all([api('categories.php?admin=1'), api('sections.php?admin=1')]);
  }
  const statusOptions = (cur) => Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('');

  async function showList() {
    dirty = false;
    document.title = 'Artículos - Administración';
    view.innerHTML = `
      <div class="page-head"><div><h1>Artículos</h1></div><div class="actions"><a class="btn btn-primary" href="#/nuevo">Nuevo artículo</a></div></div>
      <form class="filters" id="filters" role="search">
        <input type="search" name="q" placeholder="Buscar por título, número o dirección…" value="${esc(F.q)}">
        <select name="status" aria-label="Estado"><option value="">Todos los estados</option>${statusOptions(F.status)}</select>
        <select name="category_id" aria-label="Categoría"><option value="">Todas las categorías</option>${cats.map((c) => `<option value="${c.id}"${String(c.id) === String(F.category_id) ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </form>
      <div class="table-wrap" id="tbl"><p class="loading">Cargando…</p></div><div class="pagination" id="pg"></div>`;
    const form = document.getElementById('filters');
    let t;
    form.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { F.q = form.q.value; F.status = form.status.value; F.category_id = form.category_id.value; F.section_id = ''; F.page = 1; loadRows(); }, 250);
    });
    form.addEventListener('submit', (e) => e.preventDefault());
    loadRows();
  }

  async function loadRows() {
    const tbl = document.getElementById('tbl');
    try {
      const p = new URLSearchParams({ admin: 1, q: F.q, status: F.status, category_id: F.category_id, section_id: F.section_id, page: F.page });
      const r = await api('articles.php?' + p);
      tbl.innerHTML = r.items.length ? `<table class="tbl"><thead><tr><th>Nº</th><th>Título</th><th>Ubicación</th><th>Estado</th><th>Actualizado</th><th></th></tr></thead><tbody>${r.items.map((a) => `
        <tr data-id="${a.id}"><td class="num">${esc(a.number || '')}</td>
          <td class="ttl"><a href="#/editar/${a.id}">${esc(a.title)}</a><small>${esc(a.slug)}</small></td>
          <td>${esc(a.category)}${a.section ? ' / ' + esc(a.section) : ''}</td>
          <td><select data-status aria-label="Estado de ${esc(a.title)}">${statusOptions(a.status)}</select></td>
          <td>${fmtDate(a.updated_at)}<br><small class="hint">v${a.version}</small></td>
          <td class="acts"><button class="btn btn-sm" data-act="up">Subir</button> <button class="btn btn-sm" data-act="down">Bajar</button> <button class="btn btn-sm" data-act="dup">Duplicar</button> <a class="btn btn-sm" href="#/editar/${a.id}">Editar</a> <button class="btn btn-sm btn-danger" data-act="del">Eliminar</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="empty">No hay artículos con estos filtros. Crea el primero con «Nuevo artículo».</p>';
      document.getElementById('pg').innerHTML = r.pages > 1
        ? `${r.page > 1 ? '<button class="btn btn-sm" data-page="-1">Anterior</button>' : ''}<span>Página ${r.page} de ${r.pages} (${r.total} artículos)</span>${r.page < r.pages ? '<button class="btn btn-sm" data-page="1">Siguiente</button>' : ''}` : '';
    } catch (e) { tbl.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  }

  view.addEventListener('click', async (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg) { F.page += +pg.dataset.page; return loadRows(); }
    const b = e.target.closest('tr [data-act]');
    if (!b) return;
    const tr = b.closest('tr');
    const id = +tr.dataset.id;
    const post = (body) => api('articles.php', { method: 'POST', body });
    try {
      if (b.dataset.act === 'up' || b.dataset.act === 'down') { await post({ action: 'move', id, dir: b.dataset.act }); loadRows(); }
      else if (b.dataset.act === 'dup') { await post({ action: 'duplicate', id }); App.toast('Artículo duplicado como borrador'); loadRows(); }
      else if (b.dataset.act === 'del') {
        if (await Admin.confirm('El artículo y todo su historial se eliminarán de forma definitiva.', { title: `Eliminar «${tr.querySelector('.ttl a').textContent}»`, ok: 'Eliminar', danger: true })) {
          await post({ action: 'delete', id }); App.toast('Artículo eliminado'); loadRows();
        }
      }
    } catch (err) { App.toast(err.message, true); }
  });
  view.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]');
    if (!sel) return;
    try { await api('articles.php', { method: 'POST', body: { action: 'set_status', id: +sel.closest('tr').dataset.id, status: sel.value } }); App.toast('Estado actualizado'); }
    catch (err) { App.toast(err.message, true); loadRows(); }
  });

  /* ======================= EDITOR ======================= */
  async function showEditor(id) {
    let a = { number: '', title: '', summary: '', content: '', scope: '', status: 'draft', category_id: +F.category_id || cats[0]?.id, section_id: +F.section_id || '', tags: [], slug: '' };
    if (id) {
      try { a = await api('articles.php?admin=1&id=' + id); }
      catch (e) { view.innerHTML = `<p class="empty">${esc(e.message)}</p><p><a class="btn" href="#/">Volver al listado</a></p>`; return; }
    } else if (!cats.length) {
      view.innerHTML = '<p class="empty">Antes de crear artículos necesitas al menos una categoría.</p><p><a class="btn btn-primary" href="categorias.html">Ir a Estructura</a></p>';
      return;
    }
    if (id && a.section_id) a.section_id = +a.section_id;
    document.title = (id ? 'Editar' : 'Nuevo artículo') + ' - Administración';

    view.innerHTML = `
      <div class="page-head sticky-actions">
        <div><a class="back" href="#/">Volver a los artículos</a><h1>${id ? 'Editar artículo' : 'Nuevo artículo'}</h1></div>
        <div class="actions"><span class="save-state" id="save-state"></span>
          ${id ? `<a class="btn" id="open-site" target="_blank" rel="noopener" href="../normativa.html?a=${encodeURIComponent(a.slug)}&preview=1">Ver en el sitio</a>` : ''}
          <button class="btn" id="btn-save">Guardar</button><button class="btn btn-primary" id="btn-publish">Guardar y publicar</button></div>
      </div>
      <div class="editor-grid">
        <div class="paper">
          <div class="row2">
            <label class="fld" for="f-number">Número<input id="f-number" type="text" maxlength="20" placeholder="3.2" value="${esc(a.number)}"></label>
            <label class="fld" for="f-title">Título<input id="f-title" type="text" maxlength="200" value="${esc(a.title)}"></label>
          </div>
          <label class="fld" for="f-summary">Descripción breve<input id="f-summary" type="text" maxlength="500" value="${esc(a.summary)}"><small>Se muestra bajo el título y en los resultados de búsqueda.</small></label>
          <div class="tabs" role="tablist"><button type="button" class="on" data-tab="visual">Redacción</button><button type="button" data-tab="code">HTML</button><button type="button" data-tab="preview">Vista previa</button></div>
          <div class="toolbar" id="toolbar" role="toolbar" aria-label="Formato">
            <button type="button" data-cmd="bold" title="Negrita (Ctrl+B)"><b>N</b></button><button type="button" data-cmd="italic" title="Cursiva (Ctrl+I)"><i>C</i></button><button type="button" data-cmd="underline" title="Subrayado (Ctrl+U)"><u>S</u></button>
            <span class="sep"></span>
            <button type="button" data-block="h3">Título</button><button type="button" data-block="h4">Subtítulo</button><button type="button" data-block="p">Párrafo</button>
            <span class="sep"></span>
            <button type="button" data-cmd="insertUnorderedList">Lista</button><button type="button" data-cmd="insertOrderedList">Lista numerada</button><button type="button" data-block="blockquote">Cita</button>
            <span class="sep"></span>
            <button type="button" data-act="link">Enlace</button><button type="button" data-cmd="unlink">Quitar enlace</button>
            <span class="sep"></span>
            <button type="button" data-act="callout" data-kind="note">Nota</button><button type="button" data-act="callout" data-kind="warn">Advertencia</button><button type="button" data-act="callout" data-kind="hl">Destacado</button>
            <span class="sep"></span>
            <button type="button" data-act="table">Tabla</button><button type="button" data-cmd="insertHorizontalRule">Línea</button>
            <button type="button" data-cmd="removeFormat">Limpiar formato</button>
          </div>
          <div id="editor" class="prose editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Contenido" data-placeholder="Escriba aquí la normativa…"></div>
          <textarea id="code" class="code" hidden spellcheck="false" aria-label="Código HTML"></textarea>
          <div id="preview" class="prose preview" hidden></div>
          <label class="fld" for="f-scope">Aplicación<input id="f-scope" type="text" maxlength="500" placeholder="Esta norma aplica a todos los jugadores." value="${esc(a.scope)}"></label>
        </div>
        <aside class="ficha" aria-label="Ficha del artículo">
          <h2>Ficha</h2>
          <label class="fld" for="f-cat">Categoría<select id="f-cat">${cats.map((c) => `<option value="${c.id}"${+c.id === +a.category_id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label class="fld" for="f-sec">Apartado<select id="f-sec"></select></label>
          <label class="fld" for="f-status">Estado<select id="f-status">${statusOptions(a.status)}</select><small>Solo los artículos publicados son visibles en la web.</small></label>
          <label class="fld" for="f-tags">Etiquetas<input id="f-tags" type="text" maxlength="300" placeholder="roleplay, sanciones" value="${esc(a.tags.join(', '))}"><small>Separadas por comas.</small></label>
          <label class="fld" for="f-slug">Dirección (slug)<input id="f-slug" type="text" maxlength="220" value="${esc(a.slug)}"><small>Vacío: se genera desde el título.</small></label>
          <label class="fld" for="f-note">Nota del cambio<input id="f-note" type="text" maxlength="200" placeholder="Qué has modificado"></label>
          ${id ? `<h2>Historial</h2><ul class="history" id="history"><li class="hint">Cargando…</li></ul>` : ''}
        </aside>
      </div>`;

    const $ = (s) => view.querySelector(s);
    const editor = $('#editor'), code = $('#code'), preview = $('#preview');
    editor.innerHTML = a.content;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
    let tab = 'visual';

    /* Ubicación dependiente */
    const fillSecs = (catId, sel) => {
      const opts = ['<option value="">Directamente en la categoría</option>'];
      const walk = (parent, depth) => secs.filter((s) => +s.category_id === +catId && (s.parent_id === null ? null : +s.parent_id) === parent).forEach((s) => {
        opts.push(`<option value="${s.id}"${+s.id === +sel ? ' selected' : ''}>${'\u00a0\u00a0'.repeat(depth)}${esc(s.name)}</option>`);
        walk(+s.id, depth + 1);
      });
      walk(null, 0);
      $('#f-sec').innerHTML = opts.join('');
    };
    fillSecs(a.category_id, a.section_id);
    $('#f-cat').addEventListener('change', (e) => fillSecs(e.target.value, ''));

    /* Pestañas */
    async function setTab(next) {
      if (next === tab) return;
      if (tab === 'code') editor.innerHTML = await clean(code.value);
      if (next === 'code') code.value = editor.innerHTML;
      if (next === 'preview') {
        const html = tab === 'code' ? code.value : editor.innerHTML;
        preview.innerHTML = `<div class="doc"><header class="doc-head view-head"><div><span class="doc-type">Artículo ${esc($('#f-number').value)}</span><h1>${esc($('#f-title').value || 'Sin título')}</h1></div>${$('#f-summary').value ? `<p class="lede">${esc($('#f-summary').value)}</p>` : ''}</header><div class="prose">${await clean(html)}</div></div>`;
      }
      tab = next;
      editor.hidden = tab !== 'visual'; code.hidden = tab !== 'code'; preview.hidden = tab !== 'preview';
      $('#toolbar').hidden = tab !== 'visual';
      view.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    }
    const clean = async (html) => (await api('articles.php', { method: 'POST', body: { action: 'sanitize', html } })).html;
    view.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab).catch((x) => App.toast(x.message, true)); });

    /* Barra de herramientas (execCommand: soportado en todos los navegadores) */
    const bar = $('#toolbar');
    bar.addEventListener('mousedown', (e) => e.preventDefault()); // conserva la selección
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      editor.focus();
      if (b.dataset.cmd) document.execCommand(b.dataset.cmd, false, null);
      else if (b.dataset.block) document.execCommand('formatBlock', false, `<${b.dataset.block}>`);
      else if (b.dataset.act === 'link') {
        const url = prompt('Dirección del enlace.\nPara enlazar a otro artículo escribe art: seguido de su slug (por ejemplo art:metagaming).', 'https://');
        if (!url) return;
        document.execCommand('createLink', false, url.startsWith('art:') ? `normativa.html?a=${encodeURIComponent(url.slice(4).trim())}` : url.trim());
      } else if (b.dataset.act === 'callout') {
        const sel = getSelection();
        let inner = '';
        if (sel.rangeCount && editor.contains(sel.anchorNode)) {
          const tmp = document.createElement('div');
          tmp.append(sel.getRangeAt(0).cloneContents());
          inner = tmp.innerHTML.trim();
        }
        if (!inner) inner = 'Texto del aviso';
        if (!/<(p|ul|ol|blockquote|table)/i.test(inner)) inner = `<p>${inner}</p>`;
        document.execCommand('insertHTML', false, `<div class="callout ${b.dataset.kind}">${inner}</div><p><br></p>`);
      } else if (b.dataset.act === 'table') {
        const spec = prompt('Filas y columnas (por ejemplo 3x2). La primera fila es la cabecera.', '3x2');
        const m = /^(\d{1,2})\s*[x×]\s*(\d{1,2})$/i.exec(spec || '');
        if (!m) return;
        const [rows, cols] = [+m[1], +m[2]];
        const row = (tag) => `<tr>${Array.from({ length: cols }, () => `<${tag}>&nbsp;</${tag}>`).join('')}</tr>`;
        document.execCommand('insertHTML', false, `<table><thead>${row('th')}</thead><tbody>${Array.from({ length: Math.max(1, rows - 1) }, () => row('td')).join('')}</tbody></table><p><br></p>`);
      }
      dirty = true;
    });

    /* Guardado */
    view.querySelector('.editor-grid').addEventListener('input', () => { dirty = true; $('#save-state').textContent = 'Cambios sin guardar'; });
    async function save(publish) {
      const title = $('#f-title').value.trim();
      if (!title) { App.toast('El título es obligatorio', true); $('#f-title').focus(); return; }
      const content = tab === 'code' ? code.value : editor.innerHTML;
      const body = {
        action: id ? 'update' : 'create', id, number: $('#f-number').value, title, summary: $('#f-summary').value, scope: $('#f-scope').value,
        content: content.replace(/^(<p><br><\/p>|<br>)$/i, ''), category_id: +$('#f-cat').value, section_id: $('#f-sec').value || null,
        status: publish ? 'published' : $('#f-status').value, tags: $('#f-tags').value, slug: $('#f-slug').value, change_note: $('#f-note').value,
      };
      const btns = view.querySelectorAll('#btn-save, #btn-publish');
      btns.forEach((b) => (b.disabled = true));
      try {
        const r = await api('articles.php', { method: 'POST', body });
        dirty = false;
        App.toast(publish ? 'Artículo publicado' : 'Cambios guardados');
        if (!id) location.hash = `#/editar/${r.id}`;
        else showEditor(id);
      } catch (e) { App.toast(e.message, true); btns.forEach((b) => (b.disabled = false)); }
    }
    $('#btn-save').addEventListener('click', () => save(false));
    $('#btn-publish').addEventListener('click', () => save(true));

    /* Historial y restauración */
    if (id) {
      const h = $('#history');
      try {
        const rows = await api('articles.php?admin=1&history=' + id);
        h.innerHTML = rows.map((v, i) => `<li><div class="row"><b>Versión ${v.version_no}${i === 0 ? ' (actual)' : ''}</b>${i === 0 ? '' : `<button type="button" class="btn btn-sm" data-restore="${v.id}" data-no="${v.version_no}">Restaurar</button>`}</div><small>${fmtDateTime(v.created_at)} por ${esc(v.author || 'Sistema')}</small>${v.change_note ? `<small>${esc(v.change_note)}</small>` : ''}</li>`).join('');
      } catch (e) { h.innerHTML = `<li class="hint">${esc(e.message)}</li>`; }
      h.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-restore]');
        if (!b || !(await Admin.confirm(`Se restaurará el contenido de la versión ${b.dataset.no} y se guardará como una versión nueva.`, { title: 'Restaurar versión', ok: 'Restaurar' }))) return;
        try { await api('articles.php', { method: 'POST', body: { action: 'restore', id, version_id: +b.dataset.restore } }); dirty = false; App.toast('Versión restaurada'); showEditor(id); }
        catch (err) { App.toast(err.message, true); }
      });
    }
    editor.focus();
  }

  /* Ctrl+S guarda; aviso al salir con cambios */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && document.getElementById('btn-save')) { e.preventDefault(); document.getElementById('btn-save').click(); }
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ======================= ENRUTADO ======================= */
  async function route() {
    const m = /^#\/(nuevo|editar\/(\d+))/.exec(location.hash);
    if (!cats.length && !secs.length) { try { await loadRefs(); } catch (e) { view.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; } }
    if (m) await showEditor(m[2] ? +m[2] : 0);
    else await showList();
  }
  window.addEventListener('hashchange', () => {
    if (dirty && !confirm('Hay cambios sin guardar. ¿Salir de todos modos?')) return;
    dirty = false;
    route();
  });
  route();
})();
