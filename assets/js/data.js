(function () {

const weapons = [
  { id: 'armas-blancas',  name: 'Armas Blancas' },
  { id: 'pistolas',        name: 'Pistolas' },
  { id: 'micro-subfusil', name: 'Micro Subfusil' },
  { id: 'escopeta',       name: 'Escopeta' },
  { id: 'fusiles',       name: 'Fusiles' },
  { id: 'sniper',         name: 'Sniper' },
  { id: 'granadas',        name: 'Granadas' },
  { id: 'subfusil',            name: 'Subfusil' },
];

const ids = weapons.map((w) => w.id);
const [blanca, colt, micro, escopeta, fusil, sniper, granada, mp5] = ids;
const todas = ids;

const activities = [
  { name: 'Robo a civiles',        allowed: [blanca, colt] },
  { name: 'Robo a 24/7',           allowed: [blanca, colt, micro] },
  { name: 'Venta de armas',        allowed: [blanca, colt, micro, escopeta, mp5] },
  { name: 'Guerra de grafitis',    allowed: [blanca, colt, micro, escopeta] },
  { name: 'Guerra de pandillas',   allowed: [blanca, colt, micro, escopeta, granada, mp5] },
  { name: 'Secuestros comunes',    allowed: [blanca, colt, micro, escopeta, granada] },
  { name: 'Secuestros grandes',    allowed: [blanca, colt, micro, escopeta, fusil, granada, mp5] },
  { name: 'Traslado de armamento', allowed: [blanca, colt, micro, escopeta, fusil, granada, mp5] },
  { name: 'Atrincheramientos',     note: 'Más de 10 minutos', allowed: todas },
  { name: 'Bizwar',                allowed: todas },
  { name: 'Robos grandes',         allowed: todas },
  { name: 'Atentados',             allowed: todas },
  { name: 'Tiroteo masivo',        note: 'Más de 15 minutos', allowed: todas },
  { name: 'Conquistas de mafia',   allowed: todas },
];

window.Normativa = { weapons, activities };
})();
