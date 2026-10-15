(function () {
  'use strict';

  const table = document.getElementById('matrix');
  if (!table) return;

  const data = window.Normativa;
  const showError = (message, error) => {
    const notice = document.createElement('p');
    notice.className = 'matrix-error';
    notice.setAttribute('role', 'alert');
    notice.textContent = message;
    const container = table.closest('.matrix');
    if (container) container.replaceChildren(notice);
    else table.replaceWith(notice);
    if (error) console.error('No se pudo renderizar la matriz de armas:', error);
  };

  if (!data || !Array.isArray(data.weapons) || !Array.isArray(data.activities) ||
      typeof data.renderMatrix !== 'function') {
    showError('No se pudo cargar la tabla de armas. Comprueba que los archivos data.js y table.js se hayan cargado correctamente.');
    return;
  }

  try {
    data.renderMatrix(table, { weapons: data.weapons, activities: data.activities });
  } catch (error) {
    showError('Ha ocurrido un error al construir la tabla de armas. Recarga la página y vuelve a intentarlo.', error);
  }
})();
