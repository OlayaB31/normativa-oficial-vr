(function () {
const root = document.documentElement;
const toggle = document.getElementById('theme-toggle');
const systemDark = matchMedia('(prefers-color-scheme: dark)');

const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches);
const syncLabel = () => { toggle.textContent = isDark() ? 'Modo claro' : 'Modo oscuro'; };

toggle.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch { }
  syncLabel();
});
systemDark.addEventListener('change', syncLabel);
syncLabel();

const { weapons, activities, renderMatrix } = window.Normativa;
renderMatrix(document.getElementById('matrix'), { weapons, activities });
})();
