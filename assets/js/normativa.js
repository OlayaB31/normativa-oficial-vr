(() => {
  'use strict';
  const { api, esc, fmtDate, pad } = App;
  const main = document.getElementById('view');
  const rail = document.getElementById('rail');
  const idx = document.getElementById('index');
  const idxBtn = document.getElementById('index-toggle');

  const KIND = { apartado: 'Apartado', titulo: 'Título', capitulo: 'Capítulo', seccion: 'Sección' };
  const STATE = { published: 'Vigente', draft: 'Borrador', archived: 'Archivado' };
  const st = { tree: null, map: { c: {}, s: {}, a: {} }, parent: new Map(), flat: [], seq: 0, spy: null };

  /* ---------- Árbol: índices, numeración y orden de lectura ---------- */
  function register(node, type, parent) {
    node.type = type;
    st.map[type][node.slug] = node;
    st.parent.set(node, parent);
  }
  function walk(node) {
    (node.articles || []).forEach((a) => { register(a, 'a', node); st.flat.push(a); });
    (node.sections || []).forEach((s, i) => {
      register(s, 's', node);
      s.num = `${node.num}.${i + 1}`;
      walk(s);
    });
  }
  function indexTree(tree) {
    tree.categories.forEach((c, i) => { register(c, 'c', null); c.num = String(i + 1); walk(c); });
  }

  const href = (n) => `normativa.html?${n.type}=${encodeURIComponent(n.slug)}`;
  const label = (n) => (n.type === 'c' ? pad(n.num) : n.num);
  const nameOf = (n) => n.name || n.title;
  const pathOf = (n) => { const p = []; for (let x = st.parent.get(n); x; x = st.parent.get(x)) p.unshift(x); return p; };
  const kindOf = (n) => (n.type === 'c' ? 'Categoría' : KIND[n.kind] || 'Apartado');

  /* ---------- Índice lateral ---------- */
  function articleLink(a) {
    return `<li data-key="a:${esc(a.slug)}"><a class="ix-link" href="${href(a)}">${a.number ? `<span class="ix-num">${esc(a.number)}</span>` : ''}<span>${esc(a.title)}</span></a></li>`;
  }
  function branch(n) {
    const kids = (n.articles || []).map(articleLink).join('') + (n.sections || []).map(sectionItem).join('');
    return `<div class="ix-sub"><ul>${kids}</ul></div>`;
  }
  function sectionItem(s) {
    const has = s.articles.length + s.sections.length > 0;
    return `<li class="ix-branch" data-key="s:${esc(s.slug)}"><div class="ix-row">${has ? '<button type="button" class="ix-toggle" aria-expanded="false" aria-label="Mostrar u ocultar"></button>' : '<span class="ix-toggle ix-none"></span>'}<a class="ix-link" href="${href(s)}"><span class="ix-num">${esc(s.num)}</span><span>${esc(s.name)}</span></a></div>${has ? branch(s) : ''}</li>`;
  }
  function renderIndex() {
    idx.innerHTML = `<h2 class="ix-title">Índice</h2><ul class="ix-list">${st.tree.categories.map((c) => `
      <li class="ix-cat ix-branch" data-key="c:${esc(c.slug)}"><div class="ix-row"><button type="button" class="ix-toggle" aria-expanded="false" aria-label="Mostrar u ocultar"></button><a class="ix-link" href="${href(c)}"><span class="ix-num">${pad(c.num)}</span><span>${esc(c.name)}</span></a></div>${branch(c)}</li>`).join('')}</ul>`;
  }
  idx.addEventListener('click', (e) => {
    const t = e.target.closest('.ix-toggle');
    if (!t || t.classList.contains('ix-none')) return;
    const li = t.closest('.ix-branch');
    li.classList.toggle('open');
    t.setAttribute('aria-expanded', li.classList.contains('open'));
  });
  function openBranch(li) { li.classList.add('open'); li.querySelector(':scope > .ix-row > .ix-toggle')?.setAttribute('aria-expanded', 'true'); }
  function markCurrent(node) {
    idx.querySelectorAll('.current').forEach((x) => x.classList.remove('current'));
    idx.querySelectorAll('.is-current').forEach((x) => x.classList.remove('is-current'));
    if (!node) return;
    const find = (n) => idx.querySelector(`[data-key="${n.type}:${CSS.escape(n.slug)}"]`);
    pathOf(node).forEach((n) => { const li = find(n); if (li) openBranch(li); });
    const li = find(node);
    if (!li) return;
    if (li.classList.contains('ix-branch')) openBranch(li);
    li.classList.add('is-current');
    const link = li.querySelector(':scope > .ix-row > .ix-link, :scope > .ix-link');
    link?.classList.add('current');
    if (link && getComputedStyle(idx).position === 'sticky') idx.scrollTop = Math.max(0, link.offsetTop - idx.clientHeight / 3);
  }

  /* ---------- Piezas comunes ---------- */
  function crumbs(items) {
    const all = [{ name: 'Inicio', href: 'index.html' }, { name: 'Normativa', href: 'normativa.html' }, ...items];
    return `<nav class="crumbs" aria-label="Ruta de navegación"><ol>${all.map((c, i) => i === all.length - 1
      ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${c.href}">${esc(c.name)}</a></li>`).join('')}</ol></nav>`;
  }
  function outline(nodes, depth) {
    return `<ol class="outline">${nodes.map((n) => {
      if (n.type === 'a') {
        return `<li><a href="${href(n)}"><span class="ol-num">${esc(n.number || '')}</span><span class="ol-title">${esc(n.title)}</span></a>${n.summary ? `<p class="ol-sum">${esc(n.summary)}</p>` : ''}</li>`;
      }
      const kids = depth > 1 ? [...n.articles, ...n.sections] : [];
      return `<li class="ol-node"><a href="${href(n)}"><span class="ol-num">${label(n)}</span><span class="ol-title">${esc(n.name)}</span><span class="ol-count">${n.count} art.</span></a>${kids.length ? outline(kids, depth - 1) : ''}</li>`;
    }).join('')}</ol>`;
  }
  function setMeta(title, desc) {
    const server = App.settings.server_name || 'Normativa Oficial';
    document.title = `${title} - ${server}`;
    const d = desc || App.settings.description || '';
    document.querySelector('meta[name=description]')?.setAttribute('content', d);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', d);
  }
  const cleanUrl = () => { const u = new URL(location.href); u.searchParams.delete('preview'); return u.href; };

  function railActions() {
    return `<div class="rail-actions" aria-label="Herramientas del documento">
      <button type="button" class="btn btn-sm" data-act="copy">Copiar enlace</button>
      <button type="button" class="btn btn-sm" data-act="print">Imprimir</button>
    </div>`;
  }
  rail.addEventListener('click', (e) => {
    const action = e.target.closest('[data-act]')?.dataset.act;
    if (action === 'copy') App.copy(cleanUrl());
    if (action === 'print') window.print();
  });

  /* ---------- Vistas ---------- */
  function viewOverview() {
    setMeta('Normativa', 'Índice completo de la normativa oficial del servidor.');
    markCurrent(null);
    const cats = st.tree.categories;
    main.innerHTML = `${crumbs([])}<div class="view"><header class="view-head"><p class="section-kicker">VIDA ROL <span>/</span> DOCUMENTACIÓN OFICIAL</p><h1>Normativa</h1>
      <p class="lede">Elige una categoría o recorre el índice completo. Cada artículo indica su estado y su última actualización.</p></header>
      ${cats.length ? outline(cats, 2) : '<p class="empty">Todavía no hay normativa publicada.</p>'}</div>`;
    rail.innerHTML = `<h2>Documento</h2><dl class="facts"><dt>Categorías</dt><dd>${cats.length}</dd><dt>Artículos</dt><dd>${st.tree.total_articles}</dd><dt>Actualizada</dt><dd>${fmtDate(st.tree.last_update)}</dd></dl>${railActions()}`;
  }

  function viewNode(n) {
    setMeta(nameOf(n), n.description);
    markCurrent(n);
    const kids = [...n.articles, ...n.sections];
    main.innerHTML = `${crumbs([...pathOf(n).map((p) => ({ name: nameOf(p), href: href(p) })), { name: nameOf(n) }])}
      <article class="view"><header class="view-head"><span class="doc-type">${kindOf(n)} ${esc(label(n))}</span><h1>${esc(n.name)}</h1>
        ${n.description ? `<p class="lede">${esc(n.description)}</p>` : ''}
        <div class="docmeta"><span>${n.count} artículo${n.count === 1 ? '' : 's'}</span>${n.sections.length ? `<span>${n.sections.length} apartado${n.sections.length === 1 ? '' : 's'}</span>` : ''}</div></header>
      ${kids.length ? outline(kids, 4) : '<p class="empty">Esta sección todavía no tiene artículos publicados.</p>'}</article>`;
    const up = st.parent.get(n);
    rail.innerHTML = `<h2>Ficha</h2><dl class="facts"><dt>Tipo</dt><dd>${kindOf(n)}</dd><dt>Artículos</dt><dd>${n.count}</dd></dl>${railActions()}${up ? `<a class="btn btn-sm" href="${href(up)}">Volver a «${esc(nameOf(up))}»</a>` : ''}`;
  }

  async function viewArticle(slug, my) {
    main.innerHTML = '<p class="loading">Cargando documento…</p>';
    rail.innerHTML = '';
    const preview = new URLSearchParams(location.search).has('preview');
    let a;
    try { a = await api(`articles.php?slug=${encodeURIComponent(slug)}${preview ? '&preview=1' : ''}`); }
    catch (e) { if (my === st.seq) viewError(e.message); return; }
    if (my !== st.seq) return;

    const node = st.map.a[slug];
    markCurrent(node || null);
    setMeta(`${a.number ? 'Artículo ' + a.number + '. ' : ''}${a.title}`, a.summary);

    const bc = a.breadcrumbs.map((c) => ({ name: c.name, href: `normativa.html?${c.type}=${encodeURIComponent(c.slug)}` }));
    const back = bc[bc.length - 1];
    const i = node ? st.flat.indexOf(node) : -1;
    const prev = i > 0 ? st.flat[i - 1] : null;
    const next = i >= 0 && i < st.flat.length - 1 ? st.flat[i + 1] : null;
    const title = (n) => `${n.number ? esc(n.number) + ' ' : ''}${esc(n.title)}`;

    main.innerHTML = `${crumbs([...bc, { name: a.title }])}
      ${a.status !== 'published' ? `<div class="banner">Vista previa: este artículo está en estado «${esc(STATE[a.status])}» y no es público.</div>` : ''}
      <article class="view doc">
        <header class="doc-head">
          ${a.number ? `<span class="plate plate-lg" aria-label="Número ${esc(a.number)}">${esc(a.number)}</span>` : ''}
          <div><span class="doc-type">Artículo</span><h1>${esc(a.title)}</h1></div>
          ${a.summary ? `<p class="lede">${esc(a.summary)}</p>` : ''}
          <div class="docmeta"><span class="state state-${esc(a.status)}">${STATE[a.status]}</span><span>Actualizado el ${fmtDate(a.updated_at)}</span><span>Versión ${a.version}</span></div>
        </header>
        <div class="prose" id="prose">${a.content}</div>
        <footer class="doc-foot">
          ${a.scope ? `<div class="scope"><b>Aplicación</b><p>${esc(a.scope)}</p></div>` : ''}
          ${a.tags.length ? `<ul class="taglist" aria-label="Etiquetas">${a.tags.map((t) => `<li><a href="buscar.html?q=${encodeURIComponent(t.name)}">${esc(t.name)}</a></li>`).join('')}</ul>` : ''}
          ${a.related.length ? `<section class="related"><h2>Artículos relacionados</h2><ul>${a.related.map((r) => `<li><a href="normativa.html?a=${encodeURIComponent(r.slug)}"><span class="n">${esc(r.number || '')}</span><span>${esc(r.title)}</span></a></li>`).join('')}</ul></section>` : ''}
        </footer>
      </article>
      <nav class="pager" aria-label="Navegación entre artículos">
        ${prev ? `<a class="prev" href="${href(prev)}" rel="prev"><small>Anterior</small><strong>${title(prev)}</strong></a>` : ''}
        ${next ? `<a class="next" href="${href(next)}" rel="next"><small>Siguiente</small><strong>${title(next)}</strong></a>` : ''}
        <a class="up" href="${back.href}">Volver a «${esc(back.name)}»</a>
      </nav>`;

    const heads = [...main.querySelectorAll('#prose h3, #prose h4')];
    heads.forEach((h, k) => (h.id = `sec-${k + 1}`));
    rail.innerHTML = `<h2>Ficha</h2><dl class="facts"><dt>Estado</dt><dd>${STATE[a.status]}</dd><dt>Versión</dt><dd>${a.version}</dd><dt>Actualizado</dt><dd>${fmtDate(a.updated_at)}</dd><dt>Creado</dt><dd>${fmtDate(a.created_at)}</dd>${a.author ? `<dt>Autor</dt><dd>${esc(a.author)}</dd>` : ''}</dl>${railActions()}
      ${heads.length ? `<h2>En este artículo</h2><ul class="toc">${heads.map((h) => `<li class="l${h.tagName === 'H4' ? 4 : 3}"><a href="#${h.id}">${esc(h.textContent)}</a></li>`).join('')}</ul>` : ''}`;
    spy(heads);
  }

  function spy(heads) {
    st.spy?.disconnect();
    if (!heads.length || !('IntersectionObserver' in window)) return;
    st.spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        rail.querySelectorAll('.toc a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '0px 0px -70% 0px' });
    heads.forEach((h) => st.spy.observe(h));
  }

  function viewError(msg) {
    markCurrent(null);
    setMeta('No encontrado');
    main.innerHTML = `${crumbs([])}<div class="view"><h1>No se pudo mostrar el documento</h1><p class="lede">${esc(msg)}</p><p><a class="btn" href="normativa.html">Ir al índice de la normativa</a></p></div>`;
    rail.innerHTML = '';
  }

  /* ---------- Enrutado ---------- */
  async function render() {
    const my = ++st.seq;
    const p = new URLSearchParams(location.search);
    st.spy?.disconnect();
    if (p.get('a')) await viewArticle(p.get('a'), my);
    else if (p.get('s') && st.map.s[p.get('s')]) viewNode(st.map.s[p.get('s')]);
    else if (p.get('c') && st.map.c[p.get('c')]) viewNode(st.map.c[p.get('c')]);
    else if (p.get('s') || p.get('c')) viewError('La categoría o el apartado solicitado no existe o no está publicado.');
    else viewOverview();
    idx.classList.remove('open');
    idxBtn.setAttribute('aria-expanded', 'false');
    if (!location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank') return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || u.pathname !== location.pathname || (u.hash && !u.search)) return;
    e.preventDefault();
    history.pushState(null, '', u.search);
    render();
  });
  window.addEventListener('popstate', render);

  idxBtn.addEventListener('click', () => {
    const open = idx.classList.toggle('open');
    idxBtn.setAttribute('aria-expanded', open);
  });

  document.addEventListener('keydown', (e) => {
    if (App.typing(e)) return;
    if (e.key === 'n') document.querySelector('.pager .next')?.click();
    else if (e.key === 'p') document.querySelector('.pager .prev')?.click();
    else if (e.key === 'i') idxBtn.click();
  });

  (async () => {
    await App.ready;
    try {
      st.tree = await api('categories.php?tree=1');
      indexTree(st.tree);
      renderIndex();
      render();
    } catch (e) {
      main.innerHTML = `<div class="view"><h1>No se pudo cargar la normativa</h1><p class="lede">${esc(e.message)}</p></div>`;
    }
  })();
})();
