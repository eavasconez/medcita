// Ecuador's national holidays of a year, as a shortcut to block the agenda. The list is a
// starting point, not an official calendar: the Ministerio del Trabajo can move some of them
// to a Monday each year (and local holidays such as Quito's or Guayaquil's are not here), so
// the dates are shown to the person to review and edit before anything is saved.

// Easter Sunday of a year (Gregorian calendar, "Anonymous" algorithm), as [month, day]
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const pad = (n) => String(n).padStart(2, '0');
// 'YYYY-MM-DD' of a date given in UTC parts (no time zone involved)
const ymd = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const MAY_MOVE = 'The Ministerio del Trabajo can move it to a Monday: check the official calendar';

function ecuadorHolidays(year) {
  const [easterMonth, easterDay] = easter(year);
  const easterSunday = Date.UTC(year, easterMonth - 1, easterDay);
  const beforeEaster = (days) => ymd(new Date(easterSunday - days * 24 * 60 * 60 * 1000));
  const fixed = (month, day) => `${year}-${pad(month)}-${pad(day)}`;

  return [
    { date: fixed(1, 1), name: 'Año Nuevo', note: null },
    { date: beforeEaster(48), name: 'Carnaval (lunes)', note: null },
    { date: beforeEaster(47), name: 'Carnaval (martes)', note: null },
    { date: beforeEaster(2), name: 'Viernes Santo', note: null },
    { date: fixed(5, 1), name: 'Día del Trabajo', note: MAY_MOVE },
    { date: fixed(5, 24), name: 'Batalla de Pichincha', note: MAY_MOVE },
    { date: fixed(8, 10), name: 'Primer Grito de Independencia', note: MAY_MOVE },
    { date: fixed(10, 9), name: 'Independencia de Guayaquil', note: MAY_MOVE },
    { date: fixed(11, 2), name: 'Día de Difuntos', note: MAY_MOVE },
    { date: fixed(11, 3), name: 'Independencia de Cuenca', note: MAY_MOVE },
    { date: fixed(12, 25), name: 'Navidad', note: MAY_MOVE }
  ].sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { ecuadorHolidays, easter };
