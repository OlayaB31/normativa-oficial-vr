(async () => {
  'use strict';
  await App.ready;
  const slug = new URLSearchParams(location.search).get('p') || 'normativa-armas';
  try {
    const p = await App.api('pages.php?slug=' + encodeURIComponent(slug));
    document.getElementById('page-title').textContent = p.title;
    document.getElementById('page-body').innerHTML = p.content; // HTML saneado en el servidor
    document.title = `${p.title} - Normativa Oficial`;
  } catch (e) {
    document.getElementById('page-body').innerHTML = `<p class="empty">${App.esc(e.message)}</p>`;
  }
})();
