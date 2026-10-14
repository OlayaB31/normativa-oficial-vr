(async () => {
  if (!(await Admin.init('ajustes'))) return;
  try { await Admin.settings(); } catch (e) { App.toast(e.message, true); }
})();
