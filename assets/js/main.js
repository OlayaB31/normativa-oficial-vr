(function () {
const root = document.documentElement;
const systemDark = matchMedia('(prefers-color-scheme: dark)');

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
