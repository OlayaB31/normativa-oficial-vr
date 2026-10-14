/* Aplica el tema guardado antes del primer pintado (se carga bloqueante en <head>). */
(function () {
  var t = 'light';
  try { t = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
})();
