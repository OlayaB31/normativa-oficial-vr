(async () => {
  'use strict';
  const { api, esc, pad } = App;
  if (!(await Admin.init('estructura'))) return;

  const root = document.getElementById('structure');
  const KIND = { apartado: 'Apartado', titulo: 'Título', capitulo: 'Capítulo', seccion: 'Sección' };
  const STATUS = [{ value: 'published', label: 'Publicado' }, { value: 'draft', label: 'Borrador' }];
  let cats = [], secs = [];

  async function load() {
    try { [cats, secs] = await Promise.all([api('categories.php?admin=1'), api('sections.php?admin=1')]); render(); }
    catch (e) { root.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  }

  const children = (catId, parentId) => secs.filter((s) => +s.category_id === +catId && (s.parent_id === null ? null : +s.parent_id) === parentId);

  function ctl(type, id, extra = '') {
    return `<span class="ctl" data-type="${type}" data-id="${id}">
      <button class="btn btn-sm" data-act="up" aria-label="Subir">Subir</button><button class="btn btn-sm" data-act="down" aria-label="Bajar">Bajar</button>
      ${extra}<button class="btn btn-sm" data-act="edit">Editar</button><button class="btn btn-sm btn-danger" data-act="del">Eliminar</button></span>`;
  }

  function secList(catId, parentId, num) {
    const rows = children(catId, parentId);
    if (!rows.length) return '';
    return `<ul>${rows.map((s, i) => {
      const n = `${num}.${i + 1}`;
      return `<li><div class="srow"><span class="plate plate-sm">${n}</span><span class="name">${esc(s.name)}</span><span class="kind">${KIND[s.kind]}</span>
        ${s.status === 'draft' ? '<span class="badge">Borrador</span>' : ''}<span class="meta">${s.articles_count} art.</span>
        ${ctl('s', s.id, `<button class="btn btn-sm" data-act="add-sec">Añadir subapartado</button><a class="btn btn-sm" href="normativa.html?section_id=${s.id}">Artículos</a>`)}</div>${secList(catId, +s.id, n)}</li>`;
    }).join('')}</ul>`;
  }

  function render() {
    root.innerHTML = cats.length ? `<ul class="struct">${cats.map((c, i) => `
      <li><div class="srow cat"><span class="plate">${pad(i + 1)}</span><span class="name">${esc(c.name)}</span>
        ${c.status === 'draft' ? '<span class="badge">Borrador</span>' : ''}<span class="meta">${c.sections_count} apartados, ${c.articles_count} art.</span>
        ${ctl('c', c.id, `<button class="btn btn-sm" data-act="add-sec">Añadir apartado</button><a class="btn btn-sm" href="normativa.html?category_id=${c.id}">Artículos</a>`)}</div>${secList(c.id, null, String(i + 1))}</li>`).join('')}</ul>`
      : '<p class="empty">No hay categorías. Crea la primera para empezar a organizar la normativa.</p>';
  }

  /* ---------- Formularios ---------- */
  async function editCategory(c) {
    const ok = await Admin.form({
      title: c ? 'Editar categoría' : 'Nueva categoría', submit: c ? 'Guardar cambios' : 'Crear categoría',
      fields: [
        { name: 'name', label: 'Nombre', value: c?.name, required: true, max: 120 },
        { name: 'description', label: 'Descripción', type: 'textarea', value: c?.description, hint: 'Aparece en el índice general de la web.' },
        { name: 'status', label: 'Estado', type: 'select', options: STATUS, value: c?.status || 'published' },
        { name: 'slug', label: 'Dirección (slug)', value: c?.slug, max: 140, hint: 'Opcional. Se genera a partir del nombre.' },
      ],
      onSubmit: (v) => api('categories.php', { method: 'POST', body: { action: c ? 'update' : 'create', id: c?.id, ...v } }),
    });
    if (ok) { App.toast(c ? 'Categoría guardada' : 'Categoría creada'); load(); }
  }

  function placeOptions(excludeId) {
    const banned = new Set();
    if (excludeId) {
      const add = (id) => { banned.add(+id); secs.filter((s) => +s.parent_id === +id).forEach((s) => add(s.id)); };
      add(excludeId);
    }
    return cats.map((c) => {
      const items = [{ value: `c:${c.id}`, label: 'Directamente en la categoría' }];
      const walk = (parent, depth) => children(c.id, parent).forEach((s) => {
        if (banned.has(+s.id)) return;
        items.push({ value: `s:${s.id}`, label: `${'\u00a0\u00a0'.repeat(depth)}Dentro de: ${s.name}` });
        walk(+s.id, depth + 1);
      });
      walk(null, 0);
      return { group: c.name, items };
    });
  }

  async function editSection(s, preset) {
    const place = s ? (s.parent_id ? `s:${s.parent_id}` : `c:${s.category_id}`) : preset;
    const ok = await Admin.form({
      title: s ? 'Editar apartado' : 'Nuevo apartado', submit: s ? 'Guardar cambios' : 'Crear apartado',
      fields: [
        { name: 'name', label: 'Nombre', value: s?.name, required: true, max: 160 },
        { name: 'kind', label: 'Tipo', type: 'select', options: Object.entries(KIND).map(([value, label]) => ({ value, label })), value: s?.kind || 'apartado' },
        { name: 'place', label: 'Ubicación', type: 'select', options: placeOptions(s?.id), value: place, hint: 'Cambiar la ubicación reorganiza el árbol.' },
        { name: 'description', label: 'Descripción', type: 'textarea', value: s?.description },
        { name: 'status', label: 'Estado', type: 'select', options: STATUS, value: s?.status || 'published' },
        { name: 'slug', label: 'Dirección (slug)', value: s?.slug, max: 180, hint: 'Opcional.' },
      ],
      onSubmit: (v) => {
        const [kind, id] = v.place.split(':');
        const body = { action: s ? 'update' : 'create', id: s?.id, name: v.name, kind: v.kind, description: v.description, status: v.status, slug: v.slug };
        if (kind === 'c') Object.assign(body, { category_id: +id, parent_id: null });
        else Object.assign(body, { category_id: +secs.find((x) => +x.id === +id).category_id, parent_id: +id });
        return api('sections.php', { method: 'POST', body });
      },
    });
    if (ok) { App.toast(s ? 'Apartado guardado' : 'Apartado creado'); load(); }
  }

  async function remove(endpoint, id, name) {
    if (!(await Admin.confirm(`¿Eliminar «${name}»? Esta acción no se puede deshacer.`, { title: 'Eliminar', ok: 'Eliminar', danger: true }))) return;
    try {
      await api(endpoint, { method: 'POST', body: { action: 'delete', id } });
    } catch (e) {
      if (!e.data?.needs_force) return App.toast(e.message, true);
      if (!(await Admin.confirm(e.message, { title: 'Contenido incluido', ok: 'Eliminar todo', danger: true }))) return;
      try { await api(endpoint, { method: 'POST', body: { action: 'delete', id, force: true } }); }
      catch (e2) { return App.toast(e2.message, true); }
    }
    App.toast('Eliminado');
    load();
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { type, id } = b.closest('.ctl').dataset;
    const endpoint = type === 'c' ? 'categories.php' : 'sections.php';
    const item = (type === 'c' ? cats : secs).find((x) => +x.id === +id);
    try {
      switch (b.dataset.act) {
        case 'up': case 'down':
          await api(endpoint, { method: 'POST', body: { action: 'move', id: +id, dir: b.dataset.act } });
          return load();
        case 'edit': return type === 'c' ? editCategory(item) : editSection(item);
        case 'add-sec': return editSection(null, type === 'c' ? `c:${id}` : `s:${id}`);
        case 'del': return remove(endpoint, +id, item.name);
      }
    } catch (err) { App.toast(err.message, true); }
  });

  document.getElementById('new-cat').addEventListener('click', () => editCategory(null));
  load();
})();
