/* buscar.html: buscador global con resultados paginados y coincidencias resaltadas. */
(() => {
  'use strict';
  const { api, esc } = App;
  const form = document.getElementById('search-form');
  const input = form.querySelector('input[name=q]');
  const meta = document.getElementById('search-meta');
  const groups = document.getElementById('search-groups');
  const list = document.getElementById('results');
  const pager = document.getElementById('search-pager');
  let token = 0;

  const href = (q, page) => `buscar.html?q=${encodeURIComponent(q)}${page > 1 ? '&page=' + page : ''}`;

  async function search(q, page) {
    q = q.trim();
    document.title = q ? `${q} Buscar` : 'Buscar';
    if (q.length < 2) {
      meta.textContent = 'Escribe al menos dos letras para buscar en títulos, artículos, contenido, categorías y etiquetas.';
      groups.innerHTML = list.innerHTML = pager.innerHTML = '';
      return;
    }
    const my = ++token;
    meta.textContent = 'Buscando…';
    try {
      const r = await api(`search.php?q=${encodeURIComponent(q)}&page=${page}`);
      if (my !== token) return;
      meta.innerHTML = r.total
        ? `<b>${r.total}</b> resultado${r.total === 1 ? '' : 's'} para «${esc(q)}»`
        : `Sin resultados para «${esc(q)}». Prueba con otra palabra o con menos términos.`;

      const chips = [
        ...r.categories.map((c) => `<a href="normativa.html?c=${encodeURIComponent(c.slug)}">Categoría: ${App.highlight(c.name, r.terms)}</a>`),
        ...r.sections.map((s) => `<a href="normativa.html?s=${encodeURIComponent(s.slug)}">${App.highlight(s.name, r.terms)} <small>(${esc(s.category)})</small></a>`),
      ];
      groups.innerHTML = chips.join('');

      list.innerHTML = r.items.map((i) => `
        <li class="result">
          <h2><a href="normativa.html?a=${encodeURIComponent(i.slug)}">Artículo ${i.number ? esc(i.number) + ': ' : ''}${App.highlight(i.title, r.terms)}</a></h2>
          <p class="path">${esc(i.category)}${i.section ? ' / ' + esc(i.section) : ''}</p>
          ${i.snippet ? `<p class="snip">${App.highlight(i.snippet, r.terms)}</p>` : ''}
          <ul class="found-in" aria-label="Coincide en">${i.found_in.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        </li>`).join('');

      pager.innerHTML = r.pages > 1
        ? `${r.page > 1 ? `<a class="btn btn-sm" data-page="${r.page - 1}" href="${href(q, r.page - 1)}">Anterior</a>` : ''}
           <span>Página ${r.page} de ${r.pages}</span>
           ${r.page < r.pages ? `<a class="btn btn-sm" data-page="${r.page + 1}" href="${href(q, r.page + 1)}">Siguiente</a>` : ''}`
        : '';
    } catch (e) {
      meta.textContent = e.message;
      groups.innerHTML = list.innerHTML = pager.innerHTML = '';
    }
  }

  function fromUrl() {
    const p = new URLSearchParams(location.search);
    input.value = p.get('q') || '';
    search(input.value, Math.max(1, parseInt(p.get('page') || '1', 10)));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    history.pushState(null, '', href(input.value.trim(), 1));
    fromUrl();
  });
  pager.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-page]');
    if (!a) return;
    e.preventDefault();
    history.pushState(null, '', a.getAttribute('href'));
    fromUrl();
    window.scrollTo({ top: 0 });
  });
  window.addEventListener('popstate', fromUrl);
  App.ready.then(() => { fromUrl(); if (!input.value) input.focus(); });
})();
