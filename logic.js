// logic.js — funciones puras: fechas locales, "toca", cumplido, rachas, estados y resúmenes.
// Sin DOM ni Supabase. Toda fecha de día es un string 'YYYY-MM-DD' en hora LOCAL.

export const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const DIAS_CORTOS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"];
export const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]; // para mostrar de lunes a domingo
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const pad2 = (n) => String(n).padStart(2, "0");

// ---------- Fechas (siempre locales; nunca toISOString ni new Date('YYYY-MM-DD')) ----------

export function fmtDate(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayStr(now = new Date()) {
  return fmtDate(now);
}

export function addDays(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  return fmtDate(new Date(y, m - 1, d + n, 12)); // mediodía: inmune a cambios de horario
}

export function weekday(s) {
  return parseDate(s).getDay();
}

export function mondayOf(s) {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}

// created_at es timestamptz (con zona). Lo paso a fecha local. Recorto microsegundos por Safari.
export function createdDate(habit) {
  if (!habit.created_at) return "0000-01-01";
  const s = String(habit.created_at).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "0000-01-01" : fmtDate(d);
}

export function longDate(s) {
  const d = parseDate(s);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

export function weekLabel(monday) {
  const a = parseDate(monday);
  const b = parseDate(addDays(monday, 6));
  return a.getMonth() === b.getMonth()
    ? `Semana del ${a.getDate()} al ${b.getDate()} de ${MESES[b.getMonth()]}`
    : `Semana del ${a.getDate()} de ${MESES[a.getMonth()]} al ${b.getDate()} de ${MESES[b.getMonth()]}`;
}

export function daysLabel(days) {
  if (!Array.isArray(days) || days.length === 7) return "Todos los días";
  return ORDEN_DIAS.filter((n) => days.includes(n)).map((n) => DIAS_CORTOS[n]).join(" ");
}

export function fmtNum(n) {
  return String(n).replace(".", ",");
}

// ---------- Cuándo toca un hábito ----------

// Toca en la fecha si el día de la semana está en days y la fecha es ≥ su creación.
// (active NO se mira acá: solo filtra la pantalla Hoy.)
export function isScheduled(habit, date) {
  return Array.isArray(habit.days) && habit.days.includes(weekday(date)) && date >= createdDate(habit);
}

export function showsInHoy(habit, date) {
  return !!habit.active && isScheduled(habit, date);
}

// ---------- Cumplido ----------

export function timeToMin(t) {
  if (t == null || t === "") return null;
  const [hh, mm] = String(t).split(":").map(Number);
  return hh * 60 + mm;
}

// valor: check → true | null; number → número | null; time → 'HH:MM' | null.
export function computeDone(habit, valor) {
  if (valor == null || valor === "" || valor === false) return false;
  const dir = habit.target_dir === "max" ? "max" : "min";
  if (habit.measure === "number") {
    const n = Number(valor);
    if (!Number.isFinite(n)) return false;
    if (habit.target_num == null) return true;
    const t = Number(habit.target_num);
    return dir === "max" ? n <= t : n >= t;
  }
  if (habit.measure === "time") {
    const m = timeToMin(valor);
    if (m == null || Number.isNaN(m)) return false;
    if (!habit.target_time) return true;
    const t = timeToMin(habit.target_time);
    return dir === "max" ? m <= t : m >= t;
  }
  return valor === true;
}

export function metaLabel(habit) {
  const max = habit.target_dir === "max";
  if (habit.measure === "number" && habit.target_num != null) {
    return `Meta: ${max ? "como máximo" : "al menos"} ${fmtNum(habit.target_num)}`;
  }
  if (habit.measure === "time" && habit.target_time) {
    return `Meta: ${max ? "no después de" : "no antes de"} ${String(habit.target_time).slice(0, 5)}`;
  }
  return null;
}

// ---------- Estado de un día, rachas y aviso ----------

// 'blank' = no tocaba, anterior a la creación o futuro · 'done' = ✓
// 'pending' = · (solo HOY sin registro) · 'fail' = ✗ (pasado sin done, exista o no el checkin;
// u hoy con registro que no cumple).
export function dayStatus(habit, date, checkin, today) {
  if (date > today || !isScheduled(habit, date)) return "blank";
  if (checkin && checkin.done) return "done";
  if (date === today && !checkin) return "pending";
  return "fail";
}

// Racha hasta F: días programados consecutivos con done, hacia atrás y desde la creación.
// Los días que no tocaban no la cortan. Si F está en "·" (hoy sin registro), arranca en el anterior.
// byDate: Map fecha → checkin del hábito. minDate: primer día con datos cargados (si se llega
// ahí sin cortar, capped = true porque puede haber más racha antes).
export function streak(habit, F, byDate, today, minDate) {
  const inicio = createdDate(habit);
  let count = 0;
  for (let d = F; d >= inicio; d = addDays(d, -1)) {
    if (minDate && d < minDate) return { count, capped: true };
    const st = dayStatus(habit, d, byDate.get(d), today);
    if (st === "done") count++;
    else if (st === "fail") break;
    // 'blank' (no tocaba) y 'pending' (hoy sin registro) no cortan
  }
  return { count, capped: false };
}

// Día programado anterior a F (desde la creación), o null si no hay.
export function prevScheduled(habit, F) {
  const inicio = createdDate(habit);
  let d = addDays(F, -1);
  for (let i = 0; i < 7 && d >= inicio; i++, d = addDays(d, -1)) {
    if (isScheduled(habit, d)) return d;
  }
  return null;
}

// "La última vez fallaste: no falles dos veces"
export function shouldWarn(habit, F, byDate, today) {
  const p = prevScheduled(habit, F);
  return p != null && dayStatus(habit, p, byDate.get(p), today) === "fail";
}

// ---------- Revisión semanal ----------

export function weekDates(monday) {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
}

// programados = días que tocaban con ✓ o ✗ (hoy en "·" todavía no cuenta); cumplidos = ✓.
// touches = toca algún día de la semana; checkins = cuántos registros tiene en la semana.
export function weekSummary(habit, monday, byDate, today) {
  let done = 0, scheduled = 0, touches = false, checkins = 0;
  for (const d of weekDates(monday)) {
    if (byDate.get(d)) checkins++;
    if (!isScheduled(habit, d)) continue;
    touches = true;
    const st = dayStatus(habit, d, byDate.get(d), today);
    if (st === "done") { done++; scheduled++; }
    else if (st === "fail") scheduled++;
  }
  return { done, scheduled, touches, checkins };
}

// Activos: si tocaban esa semana. Pausados: solo si tienen al menos un checkin esa semana.
export function inReview(habit, summary) {
  return habit.active ? summary.touches : summary.checkins > 0;
}

export function normalizeAnswers(a) {
  const o = a && typeof a === "object" ? a : {};
  const s = (v) => (typeof v === "string" ? v : "");
  const dificultad = {};
  if (o.dificultad && typeof o.dificultad === "object") {
    for (const [k, v] of Object.entries(o.dificultad)) {
      if (v === "facil" || v === "justa" || v === "dificil") dificultad[k] = v;
    }
  }
  return { bien: s(o.bien), mal: s(o.mal), cambio: s(o.cambio), dificultad };
}

// ---------- Ideas del libro: en qué hábitos activos se aplica cada una ----------

const tiene = (v) => typeof v === "string" && v.trim() !== "";
const IDEA_CAMPOS = {
  2: (x) => tiene(x.identity),
  5: (x) => tiene(x.when_where) || tiene(x.stack_after),
  6: (x) => x.kind === "construir" && tiene(x.environment),
  7: (x) => x.kind === "romper" && tiene(x.environment),
  8: (x) => x.kind === "construir" && tiene(x.attractive),
  10: (x) => x.kind === "romper" && tiene(x.attractive),
  12: (x) => x.kind === "construir" && tiene(x.friction),
  13: (x) => tiene(x.two_minute),
  14: (x) => x.kind === "romper" && tiene(x.friction),
  15: (x) => x.kind === "construir" && tiene(x.reward),
  17: (x) => x.kind === "romper" && tiene(x.reward),
};

export function habitsForIdea(n, habits) {
  const f = IDEA_CAMPOS[n];
  return f ? habits.filter((x) => x.active && f(x)) : [];
}

// ---------- Formulario de hábito → fila para la base ----------

const limpio = (v) => {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
};

export function normalizeHabit(d) {
  const name = limpio(d.name);
  if (!name) return { error: "Poné un nombre." };
  if (name.length > 80) return { error: "El nombre puede tener hasta 80 caracteres." };
  const kind = d.kind === "romper" ? "romper" : "construir";
  const measure = d.measure === "number" || d.measure === "time" ? d.measure : "check";
  const days = [...new Set((d.days || []).map(Number))].filter((n) => n >= 0 && n <= 6).sort((a, b) => a - b);
  if (!days.length) return { error: "Elegí al menos un día de la semana." };

  const p = {
    name, kind, measure, days,
    identity: limpio(d.identity),
    when_where: limpio(d.when_where),
    stack_after: kind === "romper" ? null : limpio(d.stack_after),
    environment: limpio(d.environment),
    attractive: limpio(d.attractive),
    two_minute: kind === "romper" ? null : limpio(d.two_minute),
    friction: limpio(d.friction),
    reward: limpio(d.reward),
    target_num: null, target_time: null, target_dir: null,
  };
  if (measure === "number") {
    const raw = limpio(d.target_num);
    if (raw != null) {
      const n = Number(raw.replace(",", "."));
      if (!Number.isFinite(n)) return { error: "La meta tiene que ser un número." };
      p.target_num = n;
    }
  } else if (measure === "time") {
    const raw = limpio(d.target_time);
    if (raw != null) {
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return { error: "La meta tiene que ser una hora." };
      p.target_time = raw.slice(0, 5);
    }
  }
  if (p.target_num != null || p.target_time != null) p.target_dir = d.target_dir === "max" ? "max" : "min";
  return { payload: p };
}
