

(async () => {

  'use strict';



  const { api, esc, fmtDate, fmtDateTime } = App;

  if (!(await Admin.init('articulos'))) return;



  const view = document.getElementById('view');

  if (!view) return;



  const STATUS = { draft: 'Borrador', review: 'En revisión', scheduled: 'Programado', published: 'Publicado', archived: 'Archivado' };

  const LOCAL_DRAFT_PREFIX = 'articulos-editor-draft-v2';

  const LOCAL_DRAFT_MAX_AGE = 1000 * 60 * 60 * 24 * 30;

  const AUTO_DRAFT_DELAY = 900;

  const MAX_TABLE_ROWS = 20;

  const MAX_TABLE_COLS = 12;



  let cats = [];

  let secs = [];

  let currentUser = { id: 0, display_name: '', role: 'editor' };

  let authors = [];

  let dirty = false;

  let activeArticleId = 0;

  let activeDraftKey = '';

  let draftTimer = null;

  let lastHash = location.hash || '#/';

  let listRequest = 0;

  let editorRequest = 0;

  const selectedRows = new Set();

  const q = new URLSearchParams(location.search);

  const F = {

    q: '',

    status: '',

    category_id: q.get('category_id') || '',

    section_id: q.get('section_id') || '',

    page: 1

  };



  const statusOptions = (current) => Object.entries(STATUS)

    .map(([key, label]) => `<option value="${key}"${key === current ? ' selected' : ''}>${label}</option>`)

    .join('');

  const statusOptionsForRole = (current) => Object.entries(STATUS)

    .filter(([key]) => currentUser.role === 'admin' || ['draft', 'review'].includes(key) || key === current)

    .map(([key, label]) => `<option value="${key}"${key === current ? ' selected' : ''}${currentUser.role !== 'admin' && !['draft', 'review'].includes(key) ? ' disabled' : ''}>${label}</option>`)

    .join('');

  // La programación requiere fecha y hora, por eso no se ofrece en cambios rápidos ni por lote.
  const statusOptionsForQuickChange = (current) => Object.entries(STATUS)

    .filter(([key]) => key !== 'scheduled' || key === current)

    .map(([key, label]) => `<option value="${key}"${key === current ? ' selected' : ''}>${label}</option>`)

    .join('');

  const statusOptionsForBulk = () => Object.entries(STATUS)

    .filter(([key]) => key !== 'scheduled' && (isAdmin() || ['draft', 'review'].includes(key)))

    .map(([key, label]) => `<option value="${key}">${label}</option>`)

    .join('');

  function dateTimeLocalValue(value) {

    const raw = String(value || '').trim().replace(' ', 'T');

    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) ? raw.slice(0, 16) : '';

  }

  const isAdmin = () => currentUser.role === 'admin';

  const canEditRow = (article) => isAdmin() || (Number(article.author_id) === Number(currentUser.id) && ['draft', 'review'].includes(article.status));



  const slugify = (value) => String(value || '')

    .normalize('NFD')

    .replace(/[\u0300-\u036f]/g, '')

    .toLowerCase()

    .trim()

    .replace(/[^a-z0-9]+/g, '-')

    .replace(/^-+|-+$/g, '')

    .slice(0, 220);



  function syncAutoToc(root) {

    const toc = root && root.querySelector ? root.querySelector('.article-toc') : null;

    if (!toc) return;

    const headings = [...root.querySelectorAll('h2, h3, h4')]

      .filter((heading) => !heading.closest('.article-toc') && String(heading.textContent || '').trim());

    const title = document.createElement('h3');

    title.textContent = 'Índice del artículo';

    const list = document.createElement('ol');

    headings.forEach((heading, index) => {

      const label = String(heading.textContent || '').replace(/\s+/g, ' ').trim();

      const id = `articulo-${index + 1}-${slugify(label).slice(0, 70) || `apartado-${index + 1}`}`;

      heading.id = id;

      const item = document.createElement('li');

      item.className = `toc-${heading.tagName.toLowerCase()}`;

      const link = document.createElement('a');

      link.href = `#${id}`;

      link.textContent = label;

      item.append(link);

      list.append(item);

    });

    toc.replaceChildren(title);

    if (headings.length) toc.append(list);

    else {

      const empty = document.createElement('p');

      empty.textContent = 'Añade títulos o subtítulos para completar este índice automáticamente.';

      toc.append(empty);

    }

  }



  function syncAutoTocHtml(html) {

    const root = document.createElement('div');

    root.innerHTML = String(html || '');

    syncAutoToc(root);

    return root.innerHTML;

  }



  function blockTemplates() {

    return {

      prohibition: { label: 'Prohibición', html: '<div class="callout warn"><p><strong>Prohibición.</strong> Describe aquí la conducta que no está permitida.</p></div><p><br></p>' },

      obligation: { label: 'Obligación', html: '<div class="callout note"><p><strong>Obligación.</strong> Indica quién debe cumplirla y en qué circunstancias.</p></div><p><br></p>' },

      exception: { label: 'Excepción', html: '<div class="callout hl"><p><strong>Excepción.</strong> Esta disposición solo admite la siguiente excepción: …</p></div><p><br></p>' },

      sanction: { label: 'Sanción', html: '<div class="callout warn"><p><strong>Consecuencia.</strong> Indica la medida aplicable y los criterios que deben tenerse en cuenta.</p></div><p><br></p>' },

      requirement: { label: 'Requisitos', html: '<div class="callout note"><p><strong>Requisitos</strong></p><ul><li>Primer requisito.</li><li>Segundo requisito.</li></ul></div><p><br></p>' },

      example: { label: 'Ejemplo', html: '<div class="callout hl"><p><strong>Ejemplo:</strong> Añade aquí un caso que ayude a interpretar la norma, sin sustituir el texto reglamentario.</p></div><p><br></p>' },

      procedure: { label: 'Procedimiento numerado', html: '<h3>Procedimiento</h3><ol><li>Primera actuación.</li><li>Segunda actuación.</li><li>Criterio para dar por finalizado el procedimiento.</li></ol><p><br></p>' }

    };

  }



  const asArray = (value) => Array.isArray(value) ? value : [];

  const articleIdFromRow = (row) => Number(row && row.dataset ? row.dataset.id : 0) || 0;

  const editorContent = () => {

    const editor = view.querySelector('#editor');

    const code = view.querySelector('#code');

    if (code && !code.hidden) return code.value;

    return editor ? editor.innerHTML : '';

  };



  async function sanitizeHtml(html) {

    const result = await api('articles.php', {

      method: 'POST',

      body: { action: 'sanitize', html: String(html || '') }

    });

    if (!result || typeof result.html !== 'string') {

      throw new Error('El servidor no devolvió el contenido HTML validado.');

    }

    return result.html;

  }



  async function loadRefs() {

    const [categoryData, sectionData, profile] = await Promise.all([

      api('categories.php?admin=1'),

      api('sections.php?admin=1'),

      api('articles.php?admin=1&me=1')

    ]);

    cats = asArray(categoryData);

    secs = asArray(sectionData);

    currentUser = profile && typeof profile === 'object' ? profile : currentUser;

    currentUser.id = Number(currentUser.id) || 0;

    currentUser.role = currentUser.role === 'admin' ? 'admin' : 'editor';

    if (isAdmin()) {

      try { authors = asArray(await api('articles.php?admin=1&authors=1')); }

      catch (error) { authors = []; }

    } else { authors = []; }

  }



  function sectionLabel(section) {

    const category = cats.find((c) => String(c.id) === String(section.category_id));

    return `${category ? `${category.name} / ` : ''}${section.name || ''}`;

  }



  function sectionFilterOptions(current) {

    const sorted = [...secs].sort((a, b) => {

      const catA = String(a.category_id || '');

      const catB = String(b.category_id || '');

      return catA.localeCompare(catB) || String(a.name || '').localeCompare(String(b.name || ''), 'es');

    });

    return sorted.map((s) => `<option value="${esc(s.id)}"${String(s.id) === String(current) ? ' selected' : ''}>${esc(sectionLabel(s))}</option>`).join('');

  }



  function renderListShell() {

    document.title = 'Artículos - Administración';

    view.innerHTML = `

      <div class="page-head">

        <div><h1>Artículos</h1><p class="hint" id="count" aria-live="polite"></p></div>

        <div class="actions"><a class="btn btn-primary" href="#/nuevo">Nuevo artículo</a></div>

      </div>

      <form class="filters filters" id="filters" role="search">

        <input type="search" name="q" placeholder="Buscar título, número, dirección o contenido…" value="${esc(F.q)}" aria-label="Buscar artículos">

        <select name="status" aria-label="Estado"><option value="">Todos los estados</option>${statusOptions(F.status)}</select>

        <select name="category_id" aria-label="Categoría">

          <option value="">Todas las categorías</option>

          ${cats.map((c) => `<option value="${esc(c.id)}"${String(c.id) === String(F.category_id) ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}

        </select>

        <select name="section_id" aria-label="Apartado"><option value="">Todos los apartados</option>${sectionFilterOptions(F.section_id)}</select>

      </form>

      <div class="bulkbar" id="bulkbar" hidden>

        <span id="bulk-count">0 seleccionados</span>

        <label>Estado <select id="bulk-status" aria-label="Estado para los artículos seleccionados"><option value="">Cambiar estado…</option>${statusOptionsForBulk()}</select></label>

        <button type="button" class="btn btn-sm" data-bulk="apply-status">Aplicar</button>

        ${isAdmin() ? '<button type="button" class="btn btn-sm btn-danger" data-bulk="delete">Eliminar seleccionados</button>' : ''}

        <button type="button" class="btn btn-sm" data-bulk="clear">Cancelar selección</button>

      </div>

      <div class="table-wrap" id="tbl"><p class="loading">Cargando…</p></div>

      <div class="pagination" id="pg"></div>`;



    const form = document.getElementById('filters');

    let timer = null;

    const readFilters = () => {

      F.q = form.elements.q.value.trim();

      F.status = form.elements.status.value;

      F.category_id = form.elements.category_id.value;

      F.section_id = form.elements.section_id.value;

      F.page = 1;

      selectedRows.clear();

      loadRows();

    };

    form.addEventListener('input', () => {

      clearTimeout(timer);

      timer = setTimeout(readFilters, 250);

    });

    form.addEventListener('change', readFilters);

    form.addEventListener('submit', (event) => event.preventDefault());

  }



  function updateBulkBar() {

    const bar = document.getElementById('bulkbar');

    if (!bar) return;

    const count = selectedRows.size;

    bar.hidden = count === 0;

    const label = document.getElementById('bulk-count');

    if (label) label.textContent = `${count} seleccionado${count === 1 ? '' : 's'}`;

    const checkAll = view.querySelector('#select-all-rows');

    const rowChecks = [...view.querySelectorAll('[data-row-select]:not(:disabled)')];

    if (checkAll && rowChecks.length) {

      checkAll.checked = rowChecks.every((input) => input.checked);

      checkAll.indeterminate = rowChecks.some((input) => input.checked) && !checkAll.checked;

    }

  }



  async function loadRows() {

    const request = ++listRequest;

    const tbl = document.getElementById('tbl');

    if (!tbl) return;

    tbl.innerHTML = '<p class="loading">Cargando artículos…</p>';

    try {

      const params = new URLSearchParams({

        admin: '1', q: F.q, status: F.status,

        category_id: F.category_id, section_id: F.section_id,

        page: String(F.page)

      });

      const result = await api('articles.php?' + params.toString());

      if (request !== listRequest || !document.getElementById('tbl')) return;

      const items = asArray(result.items);

      const visibleIds = new Set(items.map((a) => String(a.id)));

      [...selectedRows].forEach((id) => { if (!visibleIds.has(String(id))) selectedRows.delete(id); });



      tbl.innerHTML = items.length ? `

        <table class="tbl articles-table">

          <thead><tr>

            <th class="select-col"><input type="checkbox" id="select-all-rows" aria-label="Seleccionar todos los artículos de esta página"></th>

            <th>Nº</th><th>Título</th><th>Ubicación</th><th>Autor</th><th>Estado</th><th>Actualizado</th><th>Acciones</th>

          </tr></thead>

          <tbody>${items.map((a) => `

            <tr data-id="${esc(a.id)}">

              <td class="select-col"><input type="checkbox" data-row-select value="${esc(a.id)}" aria-label="Seleccionar ${esc(a.title || 'artículo')}"${selectedRows.has(String(a.id)) ? ' checked' : ''}${canEditRow(a) ? '' : ' disabled title="No tienes permisos para modificar este artículo"'}></td>

              <td class="num">${esc(a.number || '')}</td>

              <td class="ttl">${canEditRow(a) ? `<a href="#/editar/${encodeURIComponent(a.id)}">${esc(a.title || 'Sin título')}</a>` : `<span>${esc(a.title || 'Sin título')}</span>`}<small>${esc(a.slug || '')}</small></td>

              <td>${esc(a.category || '')}${a.section ? ' / ' + esc(a.section) : ''}</td>

              <td><span>${esc(a.author || '—')}</span><small class="author-meta">Últ. edición: ${esc(a.updated_by_name || a.author || '—')}</small></td>

              <td>${isAdmin() ? `<select data-status data-s="${esc(a.status || 'draft')}" aria-label="Estado de ${esc(a.title || 'artículo')}">${statusOptionsForQuickChange(a.status || 'draft')}</select>` : `<span class="article-status status-${esc(a.status || 'draft')}">${esc(STATUS[a.status] || a.status || 'Borrador')}</span>`}</td>

              <td>${fmtDate(a.updated_at)}<br><small class="hint">v${esc(a.version ?? '—')}</small>${a.scheduled_at ? `<br><small class="scheduled-meta">Publicación: ${esc(fmtDateTime(a.scheduled_at))}</small>` : ''}</td>

              <td class="acts">

                ${canEditRow(a) ? `<button type="button" class="btn btn-sm ico" data-act="up" aria-label="Subir" title="Subir"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4"/></svg></button>

                <button type="button" class="btn btn-sm ico" data-act="down" aria-label="Bajar" title="Bajar"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>` : ''}

                ${(isAdmin() || (Number(a.author_id) === Number(currentUser.id) && ['draft', 'review'].includes(a.status))) ? `<button type="button" class="btn btn-sm" data-act="dup">Duplicar</button>` : ''}

                ${canEditRow(a) ? `<a class="btn btn-sm" href="#/editar/${encodeURIComponent(a.id)}">Editar</a>` : '<span class="hint read-only-label">Solo lectura</span>'}

                ${isAdmin() ? `<button type="button" class="btn btn-sm btn-danger" data-act="del">Eliminar</button>` : ''}

              </td>

            </tr>`).join('')}</tbody>

        </table>` : '<p class="empty">No hay artículos con estos filtros. Puedes crear uno con «Nuevo artículo».</p>';



      const count = document.getElementById('count');

      if (count) count.textContent = `${Number(result.total) || 0} artículo${Number(result.total) === 1 ? '' : 's'}`;

      const pg = document.getElementById('pg');

      if (pg) {

        const page = Number(result.page) || 1;

        const pages = Number(result.pages) || 1;

        pg.innerHTML = pages > 1

          ? `${page > 1 ? '<button type="button" class="btn btn-sm" data-page="-1">Anterior</button>' : ''}<span>Página ${page} de ${pages} (${Number(result.total) || 0} artículos)</span>${page < pages ? '<button type="button" class="btn btn-sm" data-page="1">Siguiente</button>' : ''}`

          : '';

      }

      updateBulkBar();

    } catch (error) {

      if (request === listRequest && tbl) tbl.innerHTML = `<p class="empty">${esc(error.message || 'No se pudieron cargar los artículos.')}</p>`;

    }

  }



  function readEditorFields() {

    const $ = (selector) => view.querySelector(selector);

    return {

      number: $('#f-number')?.value || '',

      title: $('#f-title')?.value || '',

      summary: $('#f-summary')?.value || '',

      scope: $('#f-scope')?.value || '',

      category_id: $('#f-cat')?.value || '',

      section_id: $('#f-sec')?.value || '',

      status: $('#f-status')?.value || 'draft',

      scheduled_at: $('#f-scheduled-at')?.value || '',

      tags: $('#f-tags')?.value || '',

      slug: $('#f-slug')?.value || '',

      author_id: $('#f-author')?.value || String(currentUser.id || ''),

      note: $('#f-note')?.value || '',

      content: editorContent()

    };

  }



  function getDraftKey(id, categoryId) {

    return `${LOCAL_DRAFT_PREFIX}:${id ? `article-${id}` : `new-cat-${categoryId || 'none'}`}`;

  }



  function writeLocalDraft() {

    if (!activeDraftKey || !view.querySelector('#editor-grid')) return;

    try {

      const data = readEditorFields();

      localStorage.setItem(activeDraftKey, JSON.stringify({

        savedAt: Date.now(), articleId: activeArticleId || null, data

      }));

      const state = view.querySelector('#save-state');

      if (state) state.textContent = 'Borrador local guardado';

    } catch (error) {

      // El editor sigue funcionando si el navegador bloquea el almacenamiento local.

    }

  }



  function queueLocalDraft() {

    clearTimeout(draftTimer);

    const state = view.querySelector('#save-state');

    if (state) state.textContent = 'Cambios sin guardar';

    draftTimer = setTimeout(writeLocalDraft, AUTO_DRAFT_DELAY);

  }



  function clearLocalDraft(key = activeDraftKey) {

    try { if (key) localStorage.removeItem(key); } catch (error) { /* almacenamiento opcional */ }

  }



  async function applyDraftSnapshot(snapshot) {

    if (!snapshot || !snapshot.data) return;

    const data = snapshot.data;

    const setValue = (selector, value) => {

      const element = view.querySelector(selector);

      if (element && value !== undefined && value !== null) element.value = value;

    };

    setValue('#f-number', data.number);

    setValue('#f-title', data.title);

    setValue('#f-summary', data.summary);

    setValue('#f-scope', data.scope);

    setValue('#f-cat', data.category_id);

    fillSections(data.category_id, data.section_id);

    setValue('#f-status', data.status);

    setValue('#f-scheduled-at', data.scheduled_at);

    const scheduledField = view.querySelector('#scheduled-field');

    if (scheduledField) scheduledField.hidden = data.status !== 'scheduled';

    setValue('#f-tags', data.tags);

    setValue('#f-slug', data.slug);

    setValue('#f-author', data.author_id);

    const slugField = view.querySelector('#f-slug');

    if (slugField) slugField.dataset.manual = String(data.slug || '').trim() ? '1' : '0';

    setValue('#f-note', data.note);

    const safe = await sanitizeHtml(data.content || '');

    const editor = view.querySelector('#editor');

    if (editor) editor.innerHTML = safe;

    const code = view.querySelector('#code');

    if (code) code.value = safe;

    refreshStats();

    dirty = true;

    const state = view.querySelector('#save-state');

    if (state) state.textContent = 'Borrador recuperado; falta guardarlo en el servidor';

  }



  function fillSections(categoryId, selectedId) {

    const select = view.querySelector('#f-sec');

    if (!select) return;

    const options = ['<option value="">Directamente en la categoría</option>'];

    const visit = (parentId, depth, path) => {

      secs.filter((s) => String(s.category_id) === String(categoryId) &&

        ((s.parent_id === null || s.parent_id === '' || typeof s.parent_id === 'undefined') ? null : String(s.parent_id)) === parentId)

        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))

        .forEach((section) => {

          // Evita bucles si existen apartados mal configurados en la base de datos.

          if (path.has(String(section.id))) return;

          options.push(`<option value="${esc(section.id)}"${String(section.id) === String(selectedId || '') ? ' selected' : ''}>${'\u00a0\u00a0'.repeat(Math.min(depth, 8))}${esc(section.name)}</option>`);

          const nextPath = new Set(path);

          nextPath.add(String(section.id));

          visit(String(section.id), depth + 1, nextPath);

        });

    };

    visit(null, 0, new Set());

    select.innerHTML = options.join('');

  }



  function refreshStats() {

    const stats = view.querySelector('#editor-stats');

    if (!stats) return;

    const content = editorContent();

    const temp = document.createElement('div');

    temp.innerHTML = content;

    const text = (temp.innerText || temp.textContent || '').replace(/\s+/g, ' ').trim();

    const words = text ? text.split(' ').length : 0;

    const chars = text.length;

    const minutes = words ? Math.max(1, Math.ceil(words / 200)) : 0;

    const headings = temp.querySelectorAll('h1,h2,h3,h4,h5,h6').length;

    stats.textContent = `${words} palabras · ${chars} caracteres · ${headings} encabezados · ${minutes} min de lectura`;

  }



  function setSlugAuto() {

    const title = view.querySelector('#f-title');

    const slug = view.querySelector('#f-slug');

    if (!title || !slug || slug.dataset.manual === '1') return;

    slug.value = slugify(title.value);

  }



  function templates() {

    return {

      prohibition: {

        label: 'Prohibición y excepción',

        html: '<h3>Prohibición</h3><p>Queda prohibido…</p><h4>Excepciones</h4><ul><li>La excepción solo se aplica cuando…</li></ul>'

      },

      procedure: {

        label: 'Procedimiento',

        html: '<h3>Procedimiento</h3><ol><li>El responsable deberá…</li><li>A continuación, deberá…</li><li>La situación se dará por finalizada cuando…</li></ol>'

      },

      sanction: {

        label: 'Infracción y sanción',

        html: '<h3>Infracción</h3><p>Se considera infracción…</p><h4>Consecuencia</h4><p>La sanción aplicable será…</p><p><em>La medida deberá ajustarse a las circunstancias y a las pruebas disponibles.</em></p>'

      },

      requirements: {

        label: 'Requisitos',

        html: '<h3>Requisitos</h3><ul><li>Primer requisito.</li><li>Segundo requisito.</li><li>Tercer requisito.</li></ul>'

      },

      definition: {

        label: 'Definición y alcance',

        html: '<h3>Definición</h3><p>Para efectos de esta normativa, se entiende por…</p><h3>Aplicación</h3><p>Esta disposición aplica a…</p>'

      },

      note: {

        label: 'Nota aclaratoria',

        html: '<div class="callout note"><p><strong>Nota:</strong> texto aclaratorio.</p></div><p><br></p>'

      }

    };

  }



  function htmlToLines(html) {

    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');

    doc.querySelectorAll('script,style,template').forEach((node) => node.remove());

    doc.querySelectorAll('br').forEach((node) => node.replaceWith(doc.createTextNode('\n')));

    doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,div,tr,pre,figure').forEach((node) => {

      node.append(doc.createTextNode('\n'));

    });

    return (doc.body.textContent || '')

      .replace(/\u00a0/g, ' ')

      .split(/\r?\n+/)

      .map((line) => line.replace(/[\t ]+/g, ' ').trim())

      .filter(Boolean);

  }



  function lineDiff(oldLines, newLines) {

    const n = oldLines.length;

    const m = newLines.length;

    // Limita el coste de la comparación para que artículos extraordinariamente largos

    // no bloqueen el navegador. En ese caso, la interfaz usa una comparación lado a lado.

    if (n * m > 160000 || n > 500 || m > 500) return null;

    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

    for (let i = n - 1; i >= 0; i--) {

      for (let j = m - 1; j >= 0; j--) {

        dp[i][j] = oldLines[i] === newLines[j]

          ? dp[i + 1][j + 1] + 1

          : Math.max(dp[i + 1][j], dp[i][j + 1]);

      }

    }

    const result = [];

    let i = 0;

    let j = 0;

    while (i < n || j < m) {

      if (i < n && j < m && oldLines[i] === newLines[j]) {

        result.push({ kind: 'same', text: oldLines[i++] });

        j++;

      } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {

        result.push({ kind: 'added', text: newLines[j++] });

      } else if (i < n) {

        result.push({ kind: 'removed', text: oldLines[i++] });

      }

    }

    return result;

  }



  function renderVersionComparison(version, current) {

    const panel = view.querySelector('#version-compare');

    if (!panel) return;

    const oldLines = htmlToLines(version.content);

    const newLines = htmlToLines(current.content);

    const metadata = [

      ['Número', version.number, current.number],

      ['Título', version.title, current.title],

      ['Descripción', version.summary, current.summary],

      ['Aplicación', version.scope, current.scope],

      ['Estado', STATUS[version.status] || version.status, STATUS[current.status] || current.status],

      ['Publicación programada', dateTimeLocalValue(version.scheduled_at), dateTimeLocalValue(current.scheduled_at)]

    ];

    if (version.slug !== null && version.slug !== undefined) metadata.push(['Dirección', version.slug, current.slug]);

    if (version.tags !== null && version.tags !== undefined) metadata.push(['Etiquetas', version.tags, current.tags]);

    if (version.author_id !== null && version.author_id !== undefined) {

      const oldAuthor = authors.find((item) => String(item.id) === String(version.author_id));

      const newAuthor = authors.find((item) => String(item.id) === String(current.author_id));

      metadata.push(['Autor responsable', oldAuthor?.display_name || version.author_id, newAuthor?.display_name || current.author_id]);

    }

    if (version.category_id !== null && version.category_id !== undefined) {

      const oldCategory = cats.find((item) => String(item.id) === String(version.category_id));

      const newCategory = cats.find((item) => String(item.id) === String(current.category_id));

      metadata.push(['Categoría', oldCategory?.name || version.category_id, newCategory?.name || current.category_id]);

      const oldSection = secs.find((item) => String(item.id) === String(version.section_id || ''));

      const newSection = secs.find((item) => String(item.id) === String(current.section_id || ''));

      metadata.push(['Apartado', oldSection?.name || 'Directamente en la categoría', newSection?.name || 'Directamente en la categoría']);

    }

    const changedMetadata = metadata.filter((item) => String(item[1] ?? '') !== String(item[2] ?? ''));

    let body = '';

    if (oldLines.join('\n') === newLines.join('\n') && changedMetadata.length === 0) {

      body = '<p class="compare-identical">No se encontraron diferencias en los datos comparados ni en el contenido.</p>';

    } else {

      for (const [label, previous, next] of changedMetadata) {

        body += `<div class="diff-line removed"><span>−</span><code>${esc(label)}: ${esc(previous ?? '')}</code></div>`;

        body += `<div class="diff-line added"><span>+</span><code>${esc(label)}: ${esc(next ?? '')}</code></div>`;

      }

      const diff = lineDiff(oldLines, newLines);

      if (diff) {

        body += diff.map((line) => {

          const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ';

          return `<div class="diff-line ${line.kind}"><span>${sign}</span><code>${esc(line.text)}</code></div>`;

        }).join('');

      } else {

        const oldText = oldLines.slice(0, 500).join('\n');

        const newText = newLines.slice(0, 500).join('\n');

        body += `<p class="hint">El artículo es muy extenso para calcular diferencias línea por línea. Se muestran las primeras 500 líneas de cada versión para revisarlas.</p>

          <div class="compare-columns"><section><h4>Versión ${esc(version.version_no)}</h4><pre>${esc(oldText)}</pre></section>

          <section><h4>Contenido actual</h4><pre>${esc(newText)}</pre></section></div>`;

      }

    }

    panel.innerHTML = `<div class="compare-head"><div><strong>Comparación de versiones</strong><p>Versión ${esc(version.version_no)} frente al contenido actual del editor.</p></div><button type="button" class="btn btn-sm" data-close-compare>Cerrar</button></div>

      <p class="compare-legend"><span class="removed">− Eliminado o anterior</span><span class="added">+ Añadido o actual</span></p><div class="diff-content">${body}</div>`;

    panel.hidden = false;

    panel.querySelector('[data-close-compare]')?.addEventListener('click', () => { panel.hidden = true; });

  }



  function insertHtmlAtCursor(html) {

    const editor = view.querySelector('#editor');

    if (!editor) return;

    editor.focus();

    document.execCommand('insertHTML', false, html);

    dirty = true;

    refreshStats();

    queueLocalDraft();

  }



  function safeLinkFromPrompt(value) {

    const raw = String(value || '').trim();

    if (!raw) return null;

    if (raw.startsWith('art:')) {

      const articleSlug = raw.slice(4).trim();

      return articleSlug ? `normativa.html?a=${encodeURIComponent(articleSlug)}` : null;

    }

    try {

      const url = new URL(raw, location.origin);

      if (!['https:', 'http:'].includes(url.protocol)) return null;

      if (url.origin === location.origin) return `${url.pathname}${url.search}${url.hash}`;

      return url.href;

    } catch (error) {

      return null;

    }

  }



  function linkAction() {

    const raw = prompt('Dirección del enlace. Para enlazar otro artículo escribe art: seguido de su dirección (por ejemplo art:metagaming).', 'https://');

    if (!raw) return;

    const href = safeLinkFromPrompt(raw);

    if (!href) { App.toast('Introduce una dirección HTTP/HTTPS válida o una referencia art:slug.', true); return; }

    const selection = window.getSelection();

    const hasSelection = selection && selection.rangeCount && !selection.isCollapsed &&

      view.querySelector('#editor')?.contains(selection.anchorNode);

    if (hasSelection) document.execCommand('createLink', false, href);

    else insertHtmlAtCursor(`<a href="${esc(href)}">Texto del enlace</a>`);

  }



  function insertImageAction() {

    const raw = prompt('Dirección HTTPS de la imagen. La carga de archivos requiere soporte en el servidor.', 'https://');

    if (!raw) return;

    let url;

    try {

      url = new URL(raw);

      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');

    } catch (error) {

      App.toast('La imagen debe tener una dirección HTTP o HTTPS válida.', true);

      return;

    }

    const alt = prompt('Descripción breve de la imagen (texto alternativo):', '');

    if (alt === null) return;

    insertHtmlAtCursor(`<figure><img src="${esc(url.href)}" alt="${esc(alt.trim())}" loading="lazy"><figcaption>${esc(alt.trim())}</figcaption></figure><p><br></p>`);

  }



  function insertCallout(kind) {

    const editor = view.querySelector('#editor');

    const selection = window.getSelection();

    let inner = '';

    if (selection && selection.rangeCount && editor?.contains(selection.anchorNode)) {

      const temp = document.createElement('div');

      temp.append(selection.getRangeAt(0).cloneContents());

      inner = temp.innerHTML.trim();

    }

    if (!inner) inner = '<p>Escribe aquí el contenido del aviso.</p>';

    if (!/<(p|ul|ol|blockquote|table|h[1-6])/i.test(inner)) inner = `<p>${inner}</p>`;

    insertHtmlAtCursor(`<div class="callout ${esc(kind)}">${inner}</div><p><br></p>`);

  }



  function insertTable() {

    const spec = prompt(`Número de filas y columnas (ejemplo 3x2). Máximo ${MAX_TABLE_ROWS} filas y ${MAX_TABLE_COLS} columnas.`, '3x2');

    const match = /^(\d{1,2})\s*[x×]\s*(\d{1,2})$/i.exec(spec || '');

    if (!match) return;

    const rows = Number(match[1]);

    const columns = Number(match[2]);

    if (rows < 1 || rows > MAX_TABLE_ROWS || columns < 1 || columns > MAX_TABLE_COLS) {

      App.toast(`La tabla debe tener entre 1 y ${MAX_TABLE_ROWS} filas y entre 1 y ${MAX_TABLE_COLS} columnas.`, true);

      return;

    }

    const row = (tag) => `<tr>${Array.from({ length: columns }, () => `<${tag}>Escribe aquí</${tag}>`).join('')}</tr>`;

    const html = `<table><thead>${row('th')}</thead><tbody>${Array.from({ length: Math.max(0, rows - 1) }, () => row('td')).join('')}</tbody></table><p><br></p>`;

    insertHtmlAtCursor(html);

  }



  function findReplace() {

    const editor = view.querySelector('#editor');

    if (!editor) return;

    const search = prompt('Texto que deseas buscar:');

    if (search === null || search === '') return;

    const replace = prompt('Reemplazar por:', '');

    if (replace === null) return;

    const caseSensitive = confirm('¿Distinguir mayúsculas y minúsculas?\nAceptar: sí · Cancelar: no');

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {

      acceptNode(node) {

        return node.parentElement && node.parentElement.closest('script,style,textarea,code')

          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;

      }

    });

    const nodes = [];

    while (walker.nextNode()) nodes.push(walker.currentNode);

    let replacements = 0;

    for (const node of nodes) {

      const original = node.nodeValue || '';

      let count = 0;

      let result;

      if (caseSensitive) {

        const parts = original.split(search);

        count = parts.length - 1;

        result = parts.join(replace);

      } else {

        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const regex = new RegExp(escapedSearch, 'gi');

        result = original.replace(regex, () => { count += 1; return replace; });

      }

      if (count) {

        node.nodeValue = result;

        replacements += count;

      }

    }

    dirty = dirty || replacements > 0;

    if (replacements) {

      queueLocalDraft();

      refreshStats();

      App.toast(`${replacements} coincidencia${replacements === 1 ? '' : 's'} reemplazada${replacements === 1 ? '' : 's'}.`);

    } else App.toast('No se encontraron coincidencias.');

  }



  function cleanPastedHtml(rawHtml) {

    const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');

    parsed.querySelectorAll('script,style,meta,link,iframe,object,embed,form,input,button,svg,video,audio').forEach((node) => node.remove());

    parsed.querySelectorAll('*').forEach((node) => {

      [...node.attributes].forEach((attr) => {

        const name = attr.name.toLowerCase();

        const value = attr.value.trim().toLowerCase();

        if (name.startsWith('on') || name === 'contenteditable' || name === 'class' || name === 'id' || name === 'style') {

          node.removeAttribute(attr.name);

        }

        if ((name === 'href' || name === 'src') && /^(javascript|data|vbscript):/.test(value)) node.removeAttribute(attr.name);

      });

    });

    return parsed.body.innerHTML;

  }



  async function showList() {

    dirty = false;

    activeArticleId = 0;

    activeDraftKey = '';

    clearTimeout(draftTimer);

    renderListShell();

    await loadRows();

  }



  async function showEditor(id) {

    const request = ++editorRequest;

    dirty = false;

    clearTimeout(draftTimer);

    activeArticleId = Number(id) || 0;

    let article = {

      number: '', title: '', summary: '', content: '', scope: '', status: 'draft',

      category_id: Number(F.category_id) || cats[0]?.id || '',

      section_id: Number(F.section_id) || '', tags: [], slug: '', author_id: currentUser.id, author_name: currentUser.display_name, scheduled_at: ''

    };



    if (id) {

      try { article = await api('articles.php?admin=1&id=' + encodeURIComponent(id)); }

      catch (error) {

        view.innerHTML = `<p class="empty">${esc(error.message || 'No se pudo cargar el artículo.')}</p><p><a class="btn" href="#/">Volver al listado</a></p>`;

        return;

      }

      if (request !== editorRequest) return;

    } else if (!cats.length) {

      view.innerHTML = '<p class="empty">Antes de crear artículos necesitas al menos una categoría.</p><p><a class="btn btn-primary" href="categorias.html">Ir a Estructura</a></p>';

      return;

    }



    const articleCategory = article.category_id || cats[0]?.id || '';

    const articleSection = article.section_id || '';

    let initialContent;

    try { initialContent = await sanitizeHtml(article.content || ''); }

    catch (error) {

      view.innerHTML = `<p class="empty">No se pudo validar el HTML del artículo: ${esc(error.message || 'error desconocido')}</p><p><a class="btn" href="#/">Volver al listado</a></p>`;

      return;

    }

    if (request !== editorRequest) return;



    article.category_id = articleCategory;

    article.section_id = articleSection;

    article.tags = Array.isArray(article.tags) ? article.tags : String(article.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);

    document.title = `${id ? 'Editar' : 'Nuevo artículo'} - Administración`;



    view.innerHTML = `

      <div class="page-head sticky-actions">

        <div><a class="back" href="#/">Volver a los artículos</a><h1>${id ? 'Editar artículo' : 'Nuevo artículo'}</h1><p class="hint" id="editor-stats" aria-live="polite"></p></div>

        <div class="actions"><span class="save-state" id="save-state" aria-live="polite"></span>

          ${id ? `<a class="btn" id="open-site" target="_blank" rel="noopener noreferrer" href="../normativa.html?a=${encodeURIComponent(article.slug || '')}&preview=1">Ver en el sitio</a>` : ''}

          <button type="button" class="btn" id="btn-save">Guardar cambios</button>

          <button type="button" class="btn btn-primary" id="btn-publish">${isAdmin() ? (article.status === 'scheduled' ? 'Actualizar programación' : 'Guardar y publicar') : 'Enviar a revisión'}</button>

        </div>

      </div>

      <div class="editor-grid" id="editor-grid">

        <div class="paper">

          <div class="row2">

            <label class="fld" for="f-number">Número<input id="f-number" type="text" maxlength="20" placeholder="3.2" value="${esc(article.number || '')}"></label>

            <label class="fld" for="f-title">Título<input id="f-title" type="text" maxlength="200" value="${esc(article.title || '')}" required></label>

          </div>

          <label class="fld" for="f-summary">Descripción breve<input id="f-summary" type="text" maxlength="500" value="${esc(article.summary || '')}"><small>Se muestra bajo el título y en los resultados de búsqueda.</small></label>

          <div class="tabs" role="tablist" aria-label="Modo de edición">

            <button type="button" class="on" role="tab" aria-selected="true" data-tab="visual">Redacción</button>

            <button type="button" role="tab" aria-selected="false" data-tab="code">HTML</button>

            <button type="button" role="tab" aria-selected="false" data-tab="preview">Vista previa</button>

          </div>

          <div class="toolbar toolbar" id="toolbar" role="toolbar" aria-label="Formato">

            <button type="button" data-cmd="undo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer">↶</button>

            <button type="button" data-cmd="redo" title="Rehacer (Ctrl+Y)" aria-label="Rehacer">↷</button>

            <span class="sep"></span>

            <button type="button" data-cmd="bold" title="Negrita (Ctrl+B)"><b>N</b></button>

            <button type="button" data-cmd="italic" title="Cursiva (Ctrl+I)"><i>C</i></button>

            <button type="button" data-cmd="underline" title="Subrayado (Ctrl+U)"><u>S</u></button>

            <span class="sep"></span>

            <button type="button" data-block="h3">Título</button><button type="button" data-block="h4">Subtítulo</button><button type="button" data-block="p">Párrafo</button>

            <button type="button" data-block="blockquote">Cita</button>

            <button type="button" data-cmd="subscript" title="Subíndice">xₙ</button><button type="button" data-cmd="superscript" title="Superíndice">xⁿ</button>

            <span class="sep"></span>

            <button type="button" data-cmd="justifyLeft" title="Alinear a la izquierda">Izquierda</button><button type="button" data-cmd="justifyCenter" title="Centrar">Centrar</button><button type="button" data-cmd="justifyFull" title="Justificar">Justificar</button>

            <button type="button" data-cmd="outdent" title="Reducir sangría">← Sangría</button><button type="button" data-cmd="indent" title="Aumentar sangría">Sangría →</button>

            <span class="sep"></span>

            <button type="button" data-cmd="insertUnorderedList">Lista</button><button type="button" data-cmd="insertOrderedList">Lista numerada</button>

            <button type="button" data-act="link">Enlace</button><button type="button" data-cmd="unlink">Quitar enlace</button>

            <button type="button" data-act="image">Imagen</button>

            <span class="sep"></span>

            <button type="button" data-act="callout" data-kind="note">Nota</button><button type="button" data-act="callout" data-kind="warn">Advertencia</button><button type="button" data-act="callout" data-kind="hl">Destacado</button>

            <button type="button" data-act="table">Tabla</button><button type="button" data-cmd="insertHorizontalRule">Línea</button>

            <span class="sep"></span>

            <select id="template-select" aria-label="Plantilla de artículo"><option value="">Plantillas…</option>${Object.entries(templates()).map(([key, value]) => `<option value="${key}">${esc(value.label)}</option>`).join('')}</select>

            <button type="button" data-act="insert-template">Insertar plantilla</button>

            <select id="block-select" aria-label="Bloques normativos"><option value="">Bloques normativos…</option>${Object.entries(blockTemplates()).map(([key, value]) => `<option value="${key}">${esc(value.label)}</option>`).join('')}</select>

            <button type="button" data-act="insert-block">Insertar bloque</button>

            <button type="button" data-act="toc" title="Crea un índice a partir de títulos y subtítulos">Índice automático</button>

            <button type="button" data-act="find-replace">Buscar / reemplazar</button>

            <button type="button" data-act="fullscreen">Pantalla completa</button>

            <button type="button" data-cmd="removeFormat">Limpiar formato</button>

          </div>

          <div id="editor" class="prose editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Contenido del artículo" data-placeholder="Escribe aquí el contenido de la normativa…" spellcheck="true"></div>

          <textarea id="code" class="code" hidden spellcheck="false" aria-label="Código HTML"></textarea>

          <div class="preview-tools" id="preview-tools" hidden><span>Vista de lectura</span><div><button type="button" class="btn btn-sm" data-preview-size="desktop">Escritorio</button><button type="button" class="btn btn-sm" data-preview-size="mobile">Móvil</button></div></div>

          <div id="preview" class="prose preview" hidden></div>

          <label class="fld" for="f-scope">Aplicación<input id="f-scope" type="text" maxlength="500" placeholder="Esta norma aplica a todos los jugadores." value="${esc(article.scope || '')}"></label>

          <p class="local-note">La recuperación automática guarda una copia en este navegador. Pulsa «Guardar cambios» para enviar los cambios al servidor.</p>

        </div>

        <aside class="ficha" aria-label="Ficha del artículo">

          <h2>Ficha</h2>

          <label class="fld" for="f-cat">Categoría<select id="f-cat">${cats.map((c) => `<option value="${esc(c.id)}"${String(c.id) === String(article.category_id) ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>

          <label class="fld" for="f-sec">Apartado<select id="f-sec"></select></label>

          <label class="fld" for="f-status">Estado<select id="f-status">${statusOptionsForRole(article.status || 'draft')}</select><small>${isAdmin() ? 'Puedes publicar, programar, devolver a borrador o archivar el artículo.' : 'Guarda como borrador o envía a revisión. La publicación está reservada a un administrador.'}</small></label>

          ${isAdmin() ? `<label class="fld scheduled-field" id="scheduled-field" for="f-scheduled-at"${article.status === 'scheduled' ? '' : ' hidden'}>Fecha y hora de publicación<input id="f-scheduled-at" type="datetime-local" value="${esc(dateTimeLocalValue(article.scheduled_at))}"><small>Hora de Colombia (America/Bogota). Requiere la tarea programada del servidor para publicarse automáticamente.</small></label>` : ''}

          ${isAdmin() ? `<label class="fld" for="f-author">Autor responsable<select id="f-author">${authors.map((author) => `<option value="${esc(author.id)}"${Number(author.id) === Number(article.author_id || currentUser.id) ? ' selected' : ''}>${esc(author.display_name)} · ${author.role === 'admin' ? 'Administrador' : 'Editor'}</option>`).join('')}</select><small>El autor responsable podrá editar este artículo mientras siga como borrador o en revisión.</small></label>` : `<div class="author-permissions"><strong>Autor:</strong> ${esc(article.author_name || currentUser.display_name || 'Usuario actual')}<small>Permisos: puedes editar tus borradores y artículos en revisión. La publicación y el archivo requieren un administrador.</small></div>`}

          <div class="publication-meta">${article.submitted_at ? `<small>Enviado a revisión: ${esc(fmtDateTime(article.submitted_at))}</small>` : ''}${article.reviewed_by_name ? `<small>Última revisión de ${esc(article.reviewed_by_name)}${article.reviewed_at ? ' · ' + esc(fmtDateTime(article.reviewed_at)) : ''}</small>` : ''}</div>

          <label class="fld" for="f-tags">Etiquetas<input id="f-tags" type="text" maxlength="300" placeholder="roleplay, sanciones" value="${esc(article.tags.join(', '))}"><small>Separadas por comas.</small></label>

          <label class="fld" for="f-slug">Dirección (slug)<input id="f-slug" type="text" maxlength="220" value="${esc(article.slug || '')}"><small>Se propone a partir del título. Puedes editarla.</small></label>

          <label class="fld" for="f-note">Nota del cambio<input id="f-note" type="text" maxlength="200" placeholder="Qué has modificado"></label>

          ${id ? `<h2>Historial</h2>

            <div class="version-tools">

              <label class="fld" for="compare-version">Comparar con una versión anterior

                <select id="compare-version"><option value="">Selecciona una versión…</option></select>

              </label>

              <button type="button" class="btn btn-sm" id="btn-compare-version">Comparar</button>

            </div>

            <div class="version-compare" id="version-compare" hidden></div>

            <ul class="history" id="history"><li class="hint">Cargando…</li></ul>` : ''}

        </aside>

      </div>`;



    const $ = (selector) => view.querySelector(selector);

    const editor = $('#editor');

    const code = $('#code');

    const preview = $('#preview');

    let tab = 'visual';

    let slugManuallyEdited = Boolean(article.slug);

    $('#f-slug').dataset.manual = slugManuallyEdited ? '1' : '0';

    editor.innerHTML = initialContent;

    code.value = initialContent;

    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (error) { /* no disponible en algunos navegadores */ }

    fillSections(article.category_id, article.section_id);

    const scheduledField = $('#scheduled-field');

    function syncPrimaryActionLabel() {

      const primary = $('#btn-publish');

      if (!primary || !isAdmin()) return;

      primary.textContent = $('#f-status').value === 'scheduled'

        ? (article.status === 'scheduled' ? 'Actualizar programación' : 'Programar publicación')

        : 'Guardar y publicar';

    }

    if (scheduledField) scheduledField.hidden = $('#f-status').value !== 'scheduled';

    syncPrimaryActionLabel();

    $('#f-status').addEventListener('change', () => {

      if (scheduledField) scheduledField.hidden = $('#f-status').value !== 'scheduled';

      syncPrimaryActionLabel();

      dirty = true;

      queueLocalDraft();

    });

    $('#f-scheduled-at')?.addEventListener('change', () => { dirty = true; queueLocalDraft(); });

    refreshStats();



    activeDraftKey = getDraftKey(id, article.category_id);

    const draftKeyForThisView = activeDraftKey;

    try {

      const raw = localStorage.getItem(activeDraftKey);

      if (raw) {

        const snapshot = JSON.parse(raw);

        const valid = snapshot && snapshot.data && Number(snapshot.savedAt) > Date.now() - LOCAL_DRAFT_MAX_AGE;

        const differs = valid && JSON.stringify(snapshot.data) !== JSON.stringify({

          number: article.number || '', title: article.title || '', summary: article.summary || '',

          scope: article.scope || '', category_id: String(article.category_id || ''), section_id: String(article.section_id || ''),

          status: article.status || 'draft', scheduled_at: dateTimeLocalValue(article.scheduled_at),

          tags: article.tags.join(', '), slug: article.slug || '', author_id: $('#f-author')?.value || String(currentUser.id || ''), note: '', content: initialContent

        });

        if (valid && differs) {

          const recover = await Admin.confirm(

            `Hay una copia local de este artículo guardada el ${new Date(snapshot.savedAt).toLocaleString()}. ¿Quieres recuperar esos cambios?`,

            { title: 'Recuperar borrador local', ok: 'Recuperar' }

          );

          if (recover) await applyDraftSnapshot(snapshot);

          else clearLocalDraft(activeDraftKey);

        } else if (!valid) clearLocalDraft(activeDraftKey);

      }

    } catch (error) {

      // Una copia local dañada no debe bloquear el editor.

      clearLocalDraft(activeDraftKey);

    }

    if (request !== editorRequest) return;



    async function setTab(next) {

      if (!['visual', 'code', 'preview'].includes(next) || next === tab) return;

      if (tab === 'code' && next !== 'code') { editor.innerHTML = await sanitizeHtml(code.value); syncAutoToc(editor); }

      if (next === 'code') code.value = editor.innerHTML;

      if (next === 'preview') {

        const html = syncAutoTocHtml(tab === 'code' ? code.value : editor.innerHTML);

        const safe = await sanitizeHtml(html);

        preview.innerHTML = `<div class="doc"><header class="doc-head view-head">${$('#f-number').value ? `<span class="plate plate-lg">${esc($('#f-number').value)}</span>` : ''}<div><h1>${esc($('#f-title').value.trim() || 'Sin título')}</h1></div>${$('#f-summary').value ? `<p class="lede">${esc($('#f-summary').value)}</p>` : ''}</header><div class="prose">${safe}</div>${$('#f-scope').value.trim() ? `<p class="scope"><strong>Aplicación:</strong> ${esc($('#f-scope').value.trim())}</p>` : ''}</div>`;

        preview.classList.remove('preview-mobile');

      }

      tab = next;

      editor.hidden = tab !== 'visual';

      code.hidden = tab !== 'code';

      preview.hidden = tab !== 'preview';

      $('#toolbar').hidden = tab !== 'visual';

      $('#preview-tools').hidden = tab !== 'preview';

      view.querySelectorAll('.tabs button').forEach((button) => {

        const active = button.dataset.tab === tab;

        button.classList.toggle('on', active);

        button.setAttribute('aria-selected', active ? 'true' : 'false');

      });

      refreshStats();

    }



    view.querySelector('.tabs').addEventListener('click', (event) => {

      const button = event.target.closest('[data-tab]');

      if (button) setTab(button.dataset.tab).catch((error) => App.toast(error.message, true));

    });



    const toolbar = $('#toolbar');

    toolbar.addEventListener('mousedown', (event) => {

      if (event.target.closest('button')) event.preventDefault();

    });

    toolbar.addEventListener('click', (event) => {

      const button = event.target.closest('button');

      if (!button) return;

      editor.focus();

      if (button.dataset.cmd) {

        document.execCommand(button.dataset.cmd, false, null);

      } else if (button.dataset.block) {

        document.execCommand('formatBlock', false, `<${button.dataset.block}>`);

      } else if (button.dataset.act === 'link') {

        linkAction();

      } else if (button.dataset.act === 'image') {

        insertImageAction();

      } else if (button.dataset.act === 'callout') {

        insertCallout(button.dataset.kind || 'note');

      } else if (button.dataset.act === 'table') {

        insertTable();

      } else if (button.dataset.act === 'find-replace') {

        findReplace();

      } else if (button.dataset.act === 'insert-template') {

        const templateSelect = $('#template-select');

        const chosen = templates()[templateSelect.value];

        if (!chosen) { App.toast('Selecciona primero una plantilla.', true); return; }

        insertHtmlAtCursor(chosen.html);

        templateSelect.value = '';

      } else if (button.dataset.act === 'insert-block') {

        const blockSelect = $('#block-select');

        const chosen = blockTemplates()[blockSelect.value];

        if (!chosen) { App.toast('Selecciona primero un bloque normativo.', true); return; }

        insertHtmlAtCursor(chosen.html);

        blockSelect.value = '';

      } else if (button.dataset.act === 'toc') {

        if (!editor.querySelector('.article-toc')) {

          insertHtmlAtCursor('<div class="article-toc"><h3>Índice del artículo</h3><p>Añade títulos o subtítulos para completar este índice automáticamente.</p></div><p><br></p>');

        }

        syncAutoToc(editor);

        queueLocalDraft();

      } else if (button.dataset.act === 'fullscreen') {

        $('#editor-grid').classList.toggle('editor-fullscreen');

        button.textContent = $('#editor-grid').classList.contains('editor-fullscreen') ? 'Salir de pantalla completa' : 'Pantalla completa';

      }

      dirty = true;

      syncAutoToc(editor);

      queueLocalDraft();

      refreshStats();

    });



    $('#template-select').addEventListener('keydown', (event) => {

      if (event.key === 'Enter') { event.preventDefault(); $('#toolbar [data-act="insert-template"]').click(); }

    });

    $('#block-select').addEventListener('keydown', (event) => {

      if (event.key === 'Enter') { event.preventDefault(); $('#toolbar [data-act="insert-block"]').click(); }

    });

    view.querySelectorAll('[data-preview-size]').forEach((button) => {

      button.addEventListener('click', () => preview.classList.toggle('preview-mobile', button.dataset.previewSize === 'mobile'));

    });



    editor.addEventListener('paste', async (event) => {

      const clipboard = event.clipboardData;

      if (!clipboard) return;

      const html = clipboard.getData('text/html');

      if (!html) return; // El texto plano del navegador se pega normalmente.

      event.preventDefault();

      try {

        const cleaned = cleanPastedHtml(html);

        const safe = await sanitizeHtml(cleaned);

        editor.focus();

        document.execCommand('insertHTML', false, safe);

        dirty = true;

        queueLocalDraft();

        refreshStats();

      } catch (error) {

        const plain = clipboard.getData('text/plain');

        document.execCommand('insertText', false, plain);

        App.toast('Se pegó el texto sin formato porque no se pudo validar el HTML.', true);

      }

    });



    const editorGrid = $('#editor-grid');

    editorGrid.addEventListener('input', (event) => {

      if (event.target.id === 'f-slug') { slugManuallyEdited = Boolean(event.target.value.trim()); event.target.dataset.manual = slugManuallyEdited ? '1' : '0'; }

      if (event.target.id === 'f-title') setSlugAuto();

      dirty = true;

      if (event.target === editor) syncAutoToc(editor);

      queueLocalDraft();

      refreshStats();

    });

    $('#f-cat').addEventListener('change', (event) => {

      fillSections(event.target.value, '');

      dirty = true;

      queueLocalDraft();

    });

    $('#f-author')?.addEventListener('change', () => { dirty = true; queueLocalDraft(); });

    $('#f-title').addEventListener('input', () => {

      if (!slugManuallyEdited) setSlugAuto();

    });



    async function save(intent = 'save') {

      if (intent === 'publish' && !isAdmin()) intent = 'review';

      const title = $('#f-title').value.trim();

      if (!title) { App.toast('El título es obligatorio.', true); $('#f-title').focus(); return; }

      if (!$('#f-cat').value) { App.toast('Selecciona una categoría.', true); $('#f-cat').focus(); return; }

      const selectedStatus = intent === 'publish' ? 'published' : (intent === 'review' ? 'review' : (intent === 'schedule' ? 'scheduled' : $('#f-status').value));

      const scheduledValue = isAdmin() ? ($('#f-scheduled-at')?.value || '') : '';

      if (selectedStatus === 'scheduled') {

        if (!scheduledValue) { App.toast('Selecciona la fecha y hora de publicación.', true); $('#f-scheduled-at')?.focus(); return; }

        const scheduledDate = new Date(`${scheduledValue}:00-05:00`); // Hora de Colombia (UTC-5).

        if (!Number.isFinite(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {

          App.toast('La fecha programada debe ser posterior a la hora actual.', true);

          $('#f-scheduled-at')?.focus();

          return;

        }

      }

      const rawContent = syncAutoTocHtml(editorContent()).replace(/^(<p><br\s*\/?><\/p>|<br\s*\/?>)$/i, '');

      let content;

      try { content = await sanitizeHtml(rawContent); }

      catch (error) { App.toast(`No se pudo validar el contenido: ${error.message}`, true); return; }



      const body = {

        action: id ? 'update' : 'create',

        ...(id ? { id: Number(id) } : {}),

        number: $('#f-number').value.trim(),

        title,

        summary: $('#f-summary').value.trim(),

        scope: $('#f-scope').value.trim(),

        content,

        category_id: Number($('#f-cat').value),

        section_id: $('#f-sec').value ? Number($('#f-sec').value) : null,

        status: selectedStatus,

        scheduled_at: selectedStatus === 'scheduled' ? scheduledValue : null,

        ...(isAdmin() && $('#f-author') ? { author_id: Number($('#f-author').value) } : {}),

        tags: $('#f-tags').value.trim(),

        slug: $('#f-slug').value.trim(),

        change_note: $('#f-note').value.trim()

      };

      const buttons = view.querySelectorAll('#btn-save, #btn-publish');

      buttons.forEach((button) => { button.disabled = true; });

      const state = $('#save-state');

      if (state) state.textContent = 'Guardando en el servidor…';

      try {

        const result = await api('articles.php', { method: 'POST', body });

        dirty = false;

        clearTimeout(draftTimer);

        clearLocalDraft(draftKeyForThisView);

        if (state) state.textContent = 'Guardado';

        App.toast(intent === 'publish' ? 'Artículo publicado.' : intent === 'review' ? 'Artículo enviado a revisión.' : selectedStatus === 'scheduled' ? 'Publicación programada.' : selectedStatus === 'published' ? 'Artículo publicado.' : 'Cambios guardados.');

        if (!id && result && result.id) {

          location.hash = `#/editar/${encodeURIComponent(result.id)}`;

        } else {

          await showEditor(id);

        }

      } catch (error) {

        App.toast(error.message || 'No se pudieron guardar los cambios.', true);

        buttons.forEach((button) => { button.disabled = false; });

        if (state) state.textContent = 'No se pudo guardar; la copia local se conserva';

        writeLocalDraft();

      }

    }

    $('#btn-save').addEventListener('click', () => save('save'));

    $('#btn-publish').addEventListener('click', () => save(isAdmin() ? ($('#f-status').value === 'scheduled' ? 'schedule' : 'publish') : 'review'));



    if (id) {

      const history = $('#history');

      try {

        const versions = await api('articles.php?admin=1&history=' + encodeURIComponent(id));

        if (request !== editorRequest) return;

        const versionRows = asArray(versions);

        history.innerHTML = versionRows.map((version, index) => `

          <li><div class="row"><b>Versión ${esc(version.version_no)}${index === 0 ? ' (actual)' : ''}</b>${index === 0 || !isAdmin() ? '' : `<button type="button" class="btn btn-sm" data-restore="${esc(version.id)}" data-no="${esc(version.version_no)}">Restaurar</button>`}</div>

          <small>${fmtDateTime(version.created_at)} por ${esc(version.author || 'Sistema')}</small>${version.change_note ? `<small>${esc(version.change_note)}</small>` : ''}</li>`).join('') || '<li class="hint">Todavía no hay versiones guardadas.</li>';

        const compareSelect = $('#compare-version');

        if (compareSelect) {

          compareSelect.innerHTML = '<option value="">Selecciona una versión…</option>' + versionRows

            .filter((version) => Number(version.version_no) !== Number(article.version))

            .map((version) => `<option value="${esc(version.id)}">Versión ${esc(version.version_no)} · ${esc(version.change_note || version.title || 'Sin nota')}</option>`)

            .join('');

          $('#btn-compare-version').disabled = compareSelect.options.length <= 1;

          $('#btn-compare-version').addEventListener('click', async () => {

            const versionId = Number(compareSelect.value);

            if (!versionId) { App.toast('Selecciona una versión anterior para comparar.', true); return; }

            const button = $('#btn-compare-version');

            button.disabled = true;

            try {

              const params = new URLSearchParams({ admin: '1', article_id: String(id), version: String(versionId) });

              const oldVersion = await api('articles.php?' + params.toString());

              if (request !== editorRequest) return;

              renderVersionComparison(oldVersion, {

                number: $('#f-number').value.trim(),

                title: $('#f-title').value.trim(),

                summary: $('#f-summary').value.trim(),

                scope: $('#f-scope').value.trim(),

                slug: $('#f-slug').value.trim(),

                tags: $('#f-tags').value.trim().split(',').map((tag) => tag.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es')).join(', '),

                category_id: $('#f-cat').value,

                section_id: $('#f-sec').value,

                status: $('#f-status').value,

                author_id: $('#f-author')?.value || article.author_id || currentUser.id,

                content: editorContent()

              });

            } catch (error) {

              App.toast(error.message || 'No se pudieron comparar las versiones.', true);

            } finally {

              if (request === editorRequest && button.isConnected) button.disabled = false;

            }

          });

        }

      } catch (error) {

        if (history) history.innerHTML = `<li class="hint">${esc(error.message || 'No se pudo cargar el historial.')}</li>`;

      }

      history?.addEventListener('click', async (event) => {

        const button = event.target.closest('[data-restore]');

        if (!button) return;

        const approved = await Admin.confirm(

          `Se restaurarán el contenido y los metadatos disponibles de la versión ${button.dataset.no}. La restauración se guardará como una versión nueva.`,

          { title: 'Restaurar versión', ok: 'Restaurar' }

        );

        if (!approved) return;

        try {

          await api('articles.php', { method: 'POST', body: { action: 'restore', id: Number(id), version_id: Number(button.dataset.restore) } });

          dirty = false;

          clearLocalDraft(draftKeyForThisView);

          App.toast('Versión restaurada.');

          await showEditor(id);

        } catch (error) { App.toast(error.message || 'No se pudo restaurar la versión.', true); }

      });

    }



    // Atajos de teclado del área de edición.

    editor.addEventListener('keydown', (event) => {

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {

        event.preventDefault();

        findReplace();

      }

      if (event.key === 'Escape' && $('#editor-grid').classList.contains('editor-fullscreen')) {

        $('#editor-grid').classList.remove('editor-fullscreen');

        const fullscreenButton = $('#toolbar [data-act="fullscreen"]');

        if (fullscreenButton) fullscreenButton.textContent = 'Pantalla completa';

      }

    });



    editor.focus();

  }



  // Acciones del listado y operaciones por lote.

  view.addEventListener('click', async (event) => {

    const pageButton = event.target.closest('[data-page]');

    if (pageButton) {

      F.page = Math.max(1, F.page + Number(pageButton.dataset.page));

      await loadRows();

      return;

    }



    const bulkButton = event.target.closest('[data-bulk]');

    if (bulkButton) {

      const action = bulkButton.dataset.bulk;

      const ids = [...selectedRows].map(Number).filter((id) => Number.isFinite(id) && id > 0);

      if (action === 'clear') {

        selectedRows.clear();

        view.querySelectorAll('[data-row-select]').forEach((input) => { input.checked = false; });

        updateBulkBar();

        return;

      }

      if (!ids.length) return;

      try {

        if (action === 'apply-status') {

          const status = view.querySelector('#bulk-status')?.value;

          if (!status || !STATUS[status]) { App.toast('Selecciona un estado antes de aplicar.', true); return; }

          const ok = await Admin.confirm(`Se cambiará el estado de ${ids.length} artículo(s) a «${STATUS[status]}».`, { title: 'Cambiar estado', ok: 'Aplicar cambios' });

          if (!ok) return;

          await api('articles.php', { method: 'POST', body: { action: 'bulk_set_status', ids, status } });

          App.toast('Estados actualizados.');

        } else if (action === 'delete') {

          const ok = await Admin.confirm(`Se eliminarán definitivamente ${ids.length} artículo(s) y su historial. Esta acción no se puede deshacer.`, { title: 'Eliminar artículos', ok: 'Eliminar', danger: true });

          if (!ok) return;

          await api('articles.php', { method: 'POST', body: { action: 'bulk_delete', ids } });

          App.toast('Artículos eliminados.');

        }

        selectedRows.clear();

        await loadRows();

      } catch (error) { App.toast(error.message || 'La operación por lote no se completó.', true); await loadRows(); }

      return;

    }



    const rowCheckbox = event.target.closest('[data-row-select]');

    if (rowCheckbox) {

      if (rowCheckbox.disabled) return;

      const id = Number(rowCheckbox.value);

      if (rowCheckbox.checked) selectedRows.add(String(id));

      else selectedRows.delete(String(id));

      updateBulkBar();

      return;

    }



    const selectAll = event.target.closest('#select-all-rows');

    if (selectAll) {

      view.querySelectorAll('[data-row-select]:not(:disabled)').forEach((input) => {

        input.checked = selectAll.checked;

        if (selectAll.checked) selectedRows.add(String(input.value));

        else selectedRows.delete(String(input.value));

      });

      updateBulkBar();

      return;

    }



    const button = event.target.closest('tr [data-act]');

    if (!button) return;

    const row = button.closest('tr');

    const id = articleIdFromRow(row);

    const post = (body) => api('articles.php', { method: 'POST', body });

    try {

      if (button.dataset.act === 'up' || button.dataset.act === 'down') {

        await post({ action: 'move', id, dir: button.dataset.act });

        await loadRows();

      } else if (button.dataset.act === 'dup') {

        await post({ action: 'duplicate', id });

        App.toast('Artículo duplicado como borrador.');

        await loadRows();

      } else if (button.dataset.act === 'del') {

        const title = row.querySelector('.ttl a')?.textContent || 'este artículo';

        const ok = await Admin.confirm('El artículo y todo su historial se eliminarán de forma definitiva.', { title: `Eliminar «${title}»`, ok: 'Eliminar', danger: true });

        if (!ok) return;

        await post({ action: 'delete', id });

        App.toast('Artículo eliminado.');

        await loadRows();

      }

    } catch (error) { App.toast(error.message || 'La acción no se pudo completar.', true); }

  });



  view.addEventListener('change', async (event) => {

    const select = event.target.closest('[data-status]');

    if (select) {

      const previous = select.dataset.s;

      try {

        await api('articles.php', { method: 'POST', body: { action: 'set_status', id: articleIdFromRow(select.closest('tr')), status: select.value } });

        select.dataset.s = select.value;

        App.toast('Estado actualizado.');

      } catch (error) {

        App.toast(error.message || 'No se pudo actualizar el estado.', true);

        if (previous) select.value = previous;

      }

    }

  });



  // Guardar con Ctrl/Cmd+S; Escape sale de pantalla completa; aviso al abandonar.

  document.addEventListener('keydown', (event) => {

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && document.getElementById('btn-save')) {

      event.preventDefault();

      document.getElementById('btn-save').click();

    }

  });



  window.addEventListener('beforeunload', (event) => {

    if (dirty) {

      event.preventDefault();

      event.returnValue = '';

    }

  });



  async function route() {

    const hash = location.hash || '#/';

    const match = /^#\/(nuevo|editar\/(\d+))\/?$/.exec(hash);

    try {

      if (!cats.length && !secs.length) await loadRefs();

      if (match) await showEditor(match[2] ? Number(match[2]) : 0);

      else await showList();

      lastHash = hash;

    } catch (error) {

      view.innerHTML = `<p class="empty">${esc(error.message || 'No se pudo abrir el módulo de artículos.')}</p>`;

    }

  }



  window.addEventListener('hashchange', async () => {

    const nextHash = location.hash || '#/';

    if (dirty) {

      const approved = confirm('Hay cambios sin guardar en el servidor. La copia local se conserva en este navegador. ¿Quieres salir de todos modos?');

      if (!approved) {

        history.replaceState(null, '', location.pathname + location.search + lastHash);

        return;

      }

    }

    dirty = false;

    await route();

  });



  await route();

})();