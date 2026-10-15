(async () => {
  'use strict';
  const { api, esc, fmtDate } = App;
  await App.ready;

  const index = document.getElementById('home-index');
  const recent = document.getElementById('home-recent');
  const ICON = {
    doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5V8h4M9.5 12h5M9.5 15.5h5"/></svg>',
    stack: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>',
  };

  try {
    const [tree, last] = await Promise.all([api('categories.php?tree=1'), api('articles.php?recent=1&limit=6')]);
    const cats = tree.categories;

    index.innerHTML = cats.length
      ? cats.map((c, i) => `
        <li><a class="cat-card" href="normativa.html?c=${encodeURIComponent(c.slug)}">
          <span class="cat-top"><span class="count">${c.count} artículo${c.count === 1 ? '' : 's'}</span></span>
          <span><h3>${esc(c.name)}</h3>${c.description ? `<p>${esc(c.description)}</p>` : ''}</span>
          <span class="go">Ver categoría</span>
        </a></li>`).join('')
      : '<li class="empty">Todavía no hay normativa publicada.</li>';

    recent.innerHTML = last.length
      ? last.map((a) => `
        <li><time datetime="${esc(a.updated_at)}">${fmtDate(a.updated_at)}</time>
          <span><a href="normativa.html?a=${encodeURIComponent(a.slug)}">${a.number ? esc(a.number) + '. ' : ''}${esc(a.title)}</a><small>${esc(a.category)}</small></span></li>`).join('')
      : '<li class="empty">Sin modificaciones recientes.</li>';

    const stats = document.getElementById('hero-stats');
    if (stats) {
      stats.innerHTML = `
        <li><span class="stat-ico">${ICON.doc}</span><span><span class="stat-t">Artículos vigentes</span><span class="stat-d">${tree.total_articles} en total</span></span></li>
        <li><span class="stat-ico">${ICON.stack}</span><span><span class="stat-t">Categorías</span><span class="stat-d">${cats.length} publicadas</span></span></li>
        <li><span class="stat-ico">${ICON.clock}</span><span><span class="stat-t">Última actualización</span><span class="stat-d">${tree.last_update ? fmtDate(tree.last_update) : 'Sin datos'}</span></span></li>`;
      stats.hidden = false;
    }
    const ed = document.getElementById('edition');
    if (ed && tree.last_update) ed.textContent = `Edición vigente  ${fmtDate(tree.last_update)}`;
  } catch (e) {
    index.innerHTML = `<li class="empty">${esc(e.message)}</li>`;
  }
})();
