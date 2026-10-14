(async () => {
  if (!(await Admin.init('resumen'))) return;
  try { await Admin.dashboard(); } catch (e) { App.toast(e.message, true); }
})();
