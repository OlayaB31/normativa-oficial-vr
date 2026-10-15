(function () {
  const iconPath = (id) => `assets/icons/${id}.png`;

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    node.append(...children.flat().filter(Boolean));
    return node;
  }

  const srOnly = (text) => h('span', { class: 'sr-only' }, text);

  function renderMatrix(table, { weapons, activities }) {
    let focused = null;
    const columns = new Map(weapons.map((w) => [w.id, []]));
    const buttons = new Map();
    const rows = [];

    const headRow = h('tr', {}, h('th', { scope: 'col', class: 'corner' }, 'Situación'));
    for (const weapon of weapons) {
      const button = h('button', {
        type: 'button', class: 'weapon', 'aria-pressed': 'false',
        onclick: () => setFocus(focused === weapon.id ? null : weapon.id),
      },
        h('img', { src: iconPath(weapon.id), alt: '', width: 48, height: 48, loading: 'lazy' }),
        h('span', {}, weapon.name));
      const th = h('th', { scope: 'col' }, button);
      columns.get(weapon.id).push(th);
      buttons.set(weapon.id, button);
      headRow.append(th);
    }

    const body = h('tbody');
    for (const activity of activities) {
      const allowed = new Set(activity.allowed);
      const tr = h('tr');
      tr.append(h('th', { scope: 'row', class: 'row-head' },
        h('span', { class: 'activity' }, activity.name),
        activity.note && h('span', { class: 'note' }, activity.note)));

      for (const weapon of weapons) {
        const ok = allowed.has(weapon.id);
        // En escritorio solo se ve .yes / .no; en móvil solo icono + nombre (ver CSS).
        const td = h('td', { class: ok ? 'cell cell-yes' : 'cell cell-no' },
          h('span', { class: ok ? 'yes' : 'no' }, srOnly(ok ? 'Permitido' : 'No permitido')),
          ok && h('img', { class: 'chip-icon', src: iconPath(weapon.id), alt: '', width: 28, height: 28, loading: 'lazy' }),
          ok && h('span', { class: 'chip-name', 'aria-hidden': 'true' }, weapon.name));
        columns.get(weapon.id).push(td);
        tr.append(td);
      }
      rows.push({ tr, allowed });
      body.append(tr);
    }

    function setFocus(id) {
      focused = id;
      for (const [weaponId, button] of buttons) {
        button.setAttribute('aria-pressed', String(weaponId === id));
        for (const cell of columns.get(weaponId)) cell.classList.toggle('is-focus', weaponId === id);
      }
      for (const { tr, allowed } of rows) tr.classList.toggle('is-muted', id !== null && !allowed.has(id));
    }

    table.replaceChildren(
      h('caption', { class: 'sr-only' }, 'Armas permitidas según el tipo de rol'),
      h('thead', {}, headRow),
      body);
  }

  window.Normativa = window.Normativa || {};
  window.Normativa.renderMatrix = renderMatrix;
})();
