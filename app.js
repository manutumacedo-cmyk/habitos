// Configuración de Supabase. Es la clave PUBLICABLE, pensada para ir en el cliente.
// Nunca pongas acá la service_role ni ninguna sb_secret_.
const SUPABASE_URL = "https://xusidmmwfjnfdvzvkwdi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_TPO1n7Jp9U1bjLJQ-LLoeg_dGWTdrUt";

import * as L from "./logic.js";

// supabase-js con la versión exacta fijada.
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";
const COLS_CHECKIN = "id,habit_id,date,done,value_num,value_time,note";
const PAGINA = 1000;       // máximo de filas que devuelve PostgREST por consulta
const VENTANA = 120;       // días de checkins que se cargan de una vez
const ESPERA_VALOR = 600;  // ms de debounce para − / + y hora

const IDEAS = [
  "Mejorar un poco cada día se acumula; los resultados llegan tarde, hay que tener paciencia.",
  "Cada vez que hacés un hábito, votás por la persona que querés ser.",
  "Todo hábito es señal → ganas → acción → premio.",
  "No podés cambiar lo que no notás: primero hacete consciente.",
  "Decidí cuándo y dónde, o atalo a algo que ya hacés.",
  "El entorno pesa más que la motivación: dejá a la vista lo bueno.",
  "Es más fácil evitar la tentación que resistirla.",
  "Juntá lo que tenés que hacer con algo que te gusta.",
  "Copiamos a la gente que nos rodea: rodeate de quien ya hace lo que querés.",
  "Asociá el mal hábito con lo que te cuesta y el bueno con lo que ganás.",
  "Cuentan las repeticiones, no el tiempo ni planear.",
  "Elegimos el camino con menos esfuerzo: sacá pasos a lo bueno.",
  "Empezá con una versión de dos minutos; primero existir, después mejorar.",
  "Decidí hoy algo que te obligue mañana (automatizar, comprometerte).",
  "Lo que te da un premio inmediato se repite.",
  "Ver tu progreso es un premio: no rompas la cadena, y nunca falles dos veces.",
  "Alguien que te mire cambia todo.",
  "Elegí hábitos que se adapten a vos.",
  "La motivación es máxima cuando la tarea está apenas por encima de tu nivel; el enemigo es el aburrimiento.",
  "Revisá seguido para no quedarte en piloto automático.",
];

const TABS = [["hoy", "Hoy"], ["habitos", "Hábitos"], ["historial", "Historial"], ["revision", "Revisión"], ["mas", "Más"]];

const LEYES = {
  construir: [
    { titulo: "Identidad", campos: [["identity", "Soy alguien que…"]] },
    { titulo: "Ley 1 · Obvio", campos: [["when_where", "Cuándo y dónde"], ["stack_after", "Después de…"], ["environment", "Qué cambio en mi entorno"]] },
    { titulo: "Ley 2 · Atractivo", campos: [["attractive", "Qué lo hace atractivo"]] },
    { titulo: "Ley 3 · Sencillo", campos: [["two_minute", "Versión de 2 minutos"], ["friction", "Fricción que saco"]] },
    { titulo: "Ley 4 · Satisfactorio", campos: [["reward", "Premio inmediato"]] },
  ],
  romper: [
    { titulo: "Identidad", campos: [["identity", "Soy alguien que…"]] },
    { titulo: "Ley 1 · Invisible", campos: [["when_where", "Qué me lo dispara"], ["environment", "Cómo lo hago invisible"]] },
    { titulo: "Ley 2 · Poco atractivo", campos: [["attractive", "Por qué no me conviene"]] },
    { titulo: "Ley 3 · Difícil", campos: [["friction", "Fricción que agrego"]] },
    { titulo: "Ley 4 · Insatisfactorio", campos: [["reward", "Costo o socio que me controla"]] },
  ],
};

const DIFICULTAD = [["facil", "Muy fácil"], ["justa", "Justa"], ["dificil", "Muy difícil"]];
const CONSEJO = { facil: "Subile un poco la dificultad.", dificil: "Achicalo." };
const PREGUNTAS = [
  ["bien", "¿Qué salió bien?"],
  ["mal", "¿Qué no?"],
  ["cambio", "¿Qué cambio chico pruebo la semana que viene?"],
];
const RATINGS = [["+", "+", "Suma"], ["-", "−", "Resta"], ["=", "=", "Neutro"]]; // se guarda '-' ASCII
const SIMBOLO = { done: "✓", fail: "✗", pending: "·", blank: "" };
const ESTADO_TEXTO = { done: "cumplido", fail: "fallado", pending: "sin registro", blank: "no tocaba" };

// ---------- DOM (solo createElement / textContent / append) ----------

function h(tag, props, ...hijos) {
  const n = document.createElement(tag);
  let valor;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "value") valor = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "disabled" || k === "hidden" || k === "open" || k === "selected") n[k] = true;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of hijos.flat(Infinity)) if (c != null && c !== false && c !== "") n.append(c);
  if (valor !== undefined) n.value = valor; // después de los hijos (select necesita sus option)
  return n;
}

// Como replaceChildren, pero descarta null/false/"" (replaceChildren los escribiría como texto).
function poner(n, ...hijos) {
  n.replaceChildren(...hijos.flat(Infinity).filter((c) => c != null && c !== false && c !== ""));
}

const $app = document.getElementById("app");
const $nav = document.getElementById("nav");

// ---------- Estado ----------

let sb = null;
let S = nuevoEstado();
const timers = new Map();  // clave → { t, fn }: guardados con debounce
const cadenas = new Map(); // clave → promesa: guardados de una misma cosa, de a uno y en orden
let hoyVisto = L.todayStr();

function nuevoEstado() {
  const hoy = L.todayStr();
  return {
    user: null,
    habits: [],          // todos, ordenados por sort
    ci: new Map(),       // habit_id → Map(fecha → checkin)
    desde: null,         // primer día de checkins cargado
    scorecard: [],
    reviews: new Map(),  // week_start → answers
    tab: "hoy",
    fecha: hoy,          // día que muestra Hoy
    histId: null,
    semana: L.mondayOf(hoy),
    form: null,          // borrador del formulario de hábito
    confirmar: null,     // id del hábito que se está por borrar
    fallas: new Map(),   // clave → { texto, reintentar }
    tarjetas: new Map(), // habit_id → tarjeta visible en Hoy
    votos: null,
    rev: null,           // { W, areas, pintarEstado } de la revisión visible
    nuevoItem: "",
    exp: null,           // estado de "Exportar mis datos"
    claveMsg: null,      // resultado de "Cambiar contraseña"
  };
}

function mapa(habitId) {
  let m = S.ci.get(habitId);
  if (!m) S.ci.set(habitId, (m = new Map()));
  return m;
}

// ---------- Supabase ----------

async function q(consulta) {
  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}

// Trae todas las filas de a PAGINA con .range().
async function traerTodo(armar) {
  let filas = [];
  for (let i = 0; ; i += PAGINA) {
    const data = await q(armar().range(i, i + PAGINA - 1));
    filas = filas.concat(data);
    if (data.length < PAGINA) return filas;
  }
}

function enCadena(clave, fn) {
  const p = (cadenas.get(clave) || Promise.resolve()).catch(() => {}).then(fn);
  cadenas.set(clave, p);
  return p;
}

const SIN_CONEXION = "Sin conexión. Revisá internet y probá de nuevo.";
const DEMASIADOS = "Demasiados intentos. Esperá unos minutos y probá de nuevo.";

function esErrorDeRed(e) {
  return e?.name === "AuthRetryableFetchError" || !navigator.onLine || /fetch|network|load failed/i.test(String(e?.message || ""));
}

function esDemasiados(e) {
  const code = String(e?.code || "");
  return e?.status === 429 || code.startsWith("over_") || /rate limit/i.test(String(e?.message || ""));
}

function mensajeError(e) {
  return esErrorDeRed(e) ? SIN_CONEXION : "No se pudo completar. Probá de nuevo.";
}

// Errores de signInWithPassword.
function errorLogin(e) {
  if (esDemasiados(e)) return DEMASIADOS;
  if (esErrorDeRed(e)) return SIN_CONEXION;
  if (e?.code === "invalid_credentials" || /invalid login credentials/i.test(String(e?.message || ""))) {
    return "Mail o contraseña incorrectos.";
  }
  if (e?.code === "email_not_confirmed") return "Ese mail todavía no está confirmado en Supabase.";
  return "No se pudo iniciar sesión. Probá de nuevo.";
}

// Errores de updateUser({ password }).
function errorClave(e) {
  if (esDemasiados(e)) return DEMASIADOS;
  if (esErrorDeRed(e)) return SIN_CONEXION;
  if (e?.code === "same_password") return "La nueva contraseña tiene que ser distinta de la actual.";
  if (e?.code === "weak_password") return "Supabase la rechazó por débil. Probá con una más larga o más variada.";
  if (e?.code === "reauthentication_needed" || e?.name === "AuthSessionMissingError" || e?.status === 401) {
    return "Por seguridad, cerrá sesión, volvé a entrar y probá de nuevo.";
  }
  return "No se pudo cambiar la contraseña. Probá de nuevo.";
}

function filaSinGuardar(clave) {
  const f = S.fallas.get(clave);
  if (!f) return null;
  return h("div", { class: "unsaved", role: "status" },
    h("span", { text: f.texto }),
    h("button", { type: "button", text: "Reintentar", onclick: () => f.reintentar() }));
}

// ---------- Arranque y sesión ----------

function pantallaMensaje(titulo, texto, ...acciones) {
  $nav.hidden = true;
  $app.replaceChildren(h("section", { class: "center" },
    h("h1", { text: titulo }),
    texto && h("p", { text: texto }),
    acciones.length > 0 && h("div", { class: "actions" }, acciones)));
}

async function iniciar() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    pantallaMensaje("Falta configurar Supabase", "Completá SUPABASE_URL y SUPABASE_ANON_KEY al inicio de app.js.");
    return;
  }
  pantallaMensaje("Hábitos", "Cargando…");
  let mod;
  try {
    mod = await import(SUPABASE_JS);
  } catch {
    pantallaMensaje("No se pudo cargar la app", "Revisá tu conexión a internet.",
      h("button", { type: "button", class: "primary", text: "Reintentar", onclick: () => location.reload() }));
    return;
  }
  sb = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  // Nada de await a Supabase dentro del callback: se despacha aparte.
  sb.auth.onAuthStateChange((evento, sesion) => {
    setTimeout(() => {
      if (sesion?.user) {
        if (evento === "INITIAL_SESSION" || evento === "SIGNED_IN") entrar(sesion.user);
      } else if (evento === "INITIAL_SESSION" || evento === "SIGNED_OUT") {
        mostrarLogin();
      }
    }, 0);
  });
  document.addEventListener("visibilitychange", alCambiarVisibilidad);
}

function mostrarLogin() {
  for (const { t } of timers.values()) clearTimeout(t);
  timers.clear();
  S = nuevoEstado();
  $nav.hidden = true;
  vistaLogin();
}

async function entrar(user) {
  if (S.user?.id === user.id) return;
  S = nuevoEstado();
  S.user = user;
  const yo = S;
  hoyVisto = L.todayStr();
  pantallaMensaje("Hábitos", "Cargando tus datos…");
  try {
    await cargarTodo();
  } catch (e) {
    console.warn(e);
    if (S !== yo) return; // mientras cargaba se cerró la sesión
    S.user = null;
    pantallaMensaje("No se pudieron cargar tus datos", mensajeError(e),
      h("button", { type: "button", class: "primary", text: "Reintentar", onclick: () => entrar(user) }),
      h("button", { type: "button", text: "Cerrar sesión", onclick: cerrarSesion }));
    return;
  }
  if (S !== yo) return;
  armarNav();
  render(true);
}

async function cerrarSesion() {
  try { await sb.auth.signOut({ scope: "local" }); } catch (e) { console.warn(e); }
  mostrarLogin();
}

function alCambiarVisibilidad() {
  if (document.visibilityState === "hidden") {
    // Si se cierra la app, guardá ya lo que estaba esperando el debounce.
    for (const [k, { t, fn }] of timers) { clearTimeout(t); timers.delete(k); fn(); }
    guardarAreasRevision();
    return;
  }
  if (!S.user) return;
  const hoy = L.todayStr();
  if (hoy !== hoyVisto) {
    if (S.fecha === hoyVisto) S.fecha = hoy;
    if (S.semana === L.mondayOf(hoyVisto)) S.semana = L.mondayOf(hoy);
    hoyVisto = hoy;
    if (!S.form) render();
  }
}

// ---------- Login con mail y contraseña ----------
// Sin registro ni "olvidé mi contraseña": la cuenta se crea en Supabase.
// autocomplete username / current-password: el iPhone ofrece guardarla en el llavero.

function vistaLogin() {
  const error = h("p", { class: "error", role: "alert" });
  const email = h("input", {
    id: "l-email", name: "email", type: "email", inputmode: "email", autocomplete: "username",
    autocapitalize: "off", autocorrect: "off", spellcheck: "false",
  });
  const clave = h("input", { id: "l-pass", name: "password", type: "password", autocomplete: "current-password" });
  const boton = h("button", { type: "submit", class: "primary wide", text: "Entrar" });

  const form = h("form", {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const mail = email.value.trim();
      const password = clave.value;
      if (!mail || !password) { error.textContent = "Escribí tu mail y tu contraseña."; return; }
      error.textContent = "";
      boton.disabled = true;
      boton.textContent = "Entrando…";
      let res;
      try {
        res = await sb.auth.signInWithPassword({ email: mail, password });
      } catch (e2) {
        res = { error: e2 };
      }
      boton.disabled = false;
      boton.textContent = "Entrar";
      if (res.error) { error.textContent = errorLogin(res.error); return; }
      if (res.data?.session?.user) entrar(res.data.session.user);
    },
  },
  h("label", { for: "l-email", text: "Mail" }), email,
  h("label", { for: "l-pass", text: "Contraseña" }), clave,
  boton);

  $app.replaceChildren(h("section", { class: "login" }, h("h1", { text: "Hábitos" }), form, error));
}

// ---------- Datos ----------

async function cargarTodo() {
  const yo = S;
  const desde = L.addDays(L.todayStr(), -(VENTANA - 1));
  const [habits, checkins, scorecard] = await Promise.all([
    q(sb.from("habits").select("*").order("sort").order("created_at")),
    traerTodo(() => sb.from("checkins").select(COLS_CHECKIN).gte("date", desde).order("date").order("id")),
    q(sb.from("scorecard").select("*").order("sort").order("id")),
  ]);
  if (S !== yo) return;
  S.habits = habits;
  S.scorecard = scorecard;
  S.ci = new Map();
  for (const c of checkins) mapa(c.habit_id).set(c.date, c);
  S.desde = desde;
}

// Si hace falta ver más atrás que lo cargado, trae lo que falta (paginado).
async function asegurarDesde(fecha) {
  if (fecha >= S.desde) return;
  const hasta = S.desde;
  const filas = await traerTodo(() => sb.from("checkins").select(COLS_CHECKIN)
    .gte("date", fecha).lt("date", hasta).order("date").order("id"));
  for (const c of filas) {
    const m = mapa(c.habit_id);
    if (!m.has(c.date)) m.set(c.date, c);
  }
  if (fecha < S.desde) S.desde = fecha;
}

async function asegurarRevision(W) {
  if (S.reviews.has(W)) return;
  const fila = await q(sb.from("reviews").select("week_start,answers").eq("week_start", W).maybeSingle());
  if (!S.reviews.has(W)) S.reviews.set(W, L.normalizeAnswers(fila?.answers));
}

// ---------- Navegación y render ----------

const VISTAS = { hoy: vistaHoy, habitos: vistaHabitos, historial: vistaHistorial, revision: vistaRevision, mas: vistaMas };
let turno = 0;

async function render(arriba) {
  const mio = ++turno;
  actualizarNav();
  let nodo;
  try {
    nodo = await VISTAS[S.tab]();
  } catch (e) {
    console.warn(e);
    nodo = h("section", {},
      h("h1", { text: "Algo falló" }),
      h("p", { text: mensajeError(e) }),
      h("button", { type: "button", class: "primary", text: "Reintentar", onclick: () => render() }));
  }
  if (mio !== turno) return;
  $app.replaceChildren(nodo);
  if (arriba) window.scrollTo(0, 0);
}

function armarNav() {
  $nav.replaceChildren(...TABS.map(([id, texto]) =>
    h("button", { type: "button", "data-tab": id, text: texto, onclick: () => irA(id) })));
  $nav.hidden = false;
  actualizarNav();
}

function actualizarNav() {
  for (const b of $nav.children) {
    if (b.dataset.tab === S.tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
}

function irA(tab) {
  guardarAreasRevision();
  const hoy = L.todayStr();
  if (tab === "hoy") S.fecha = hoy;
  if (tab === "revision" && S.tab !== "revision") S.semana = L.mondayOf(hoy);
  S.tab = tab;
  S.form = null;
  S.confirmar = null;
  S.claveMsg = null;
  render(true);
}

// ---------- Hoy ----------

async function vistaHoy() {
  const hoy = L.todayStr();
  if (S.fecha > hoy) S.fecha = hoy;
  const F = S.fecha;
  await asegurarDesde(L.addDays(F, -(VENTANA - 1)));
  const lista = S.habits.filter((x) => L.showsInHoy(x, F));

  const votos = h("p", { class: "votos" });
  S.votos = () => {
    const n = lista.filter((x) => mapa(x.id).get(F)?.done).length;
    votos.textContent = `Votos del día: ${n} de ${lista.length}`;
  };
  S.tarjetas = new Map();
  const tarjetas = lista.map((x) => {
    const c = h("article", { class: "card" });
    S.tarjetas.set(x.id, c);
    llenarTarjeta(c, x, F);
    return c;
  });
  S.votos();

  const irAFecha = (d) => { S.fecha = d > hoy ? hoy : d; render(); };
  const vacio = S.habits.some((x) => x.active)
    ? "Ningún hábito toca este día."
    : "Todavía no tenés hábitos activos. Agregalos en la pestaña Hábitos.";

  return h("section", {},
    h("h1", { text: F === hoy ? "Hoy" : L.longDate(F) }),
    h("div", { class: "datebar" },
      h("button", { type: "button", text: "‹", "aria-label": "Día anterior", onclick: () => irAFecha(L.addDays(F, -1)) }),
      h("input", {
        type: "date", value: F, max: hoy, "aria-label": "Fecha",
        onchange: (e) => { if (e.target.value) irAFecha(e.target.value); },
      }),
      h("button", { type: "button", text: "›", "aria-label": "Día siguiente", disabled: F >= hoy, onclick: () => irAFecha(L.addDays(F, 1)) })),
    votos,
    lista.length ? tarjetas : h("p", { class: "empty", text: vacio }));
}

function llenarTarjeta(c, x, F) {
  const arriba = h("div");
  const ctl = h("div", { class: "controls" });
  const abajo = h("div");
  c.replaceChildren(arriba, ctl, abajo);
  c._partes = { arriba, ctl, abajo };
  dibujarControles(c, x, F);
  dibujarInfo(c, x, F);
}

// Nombre, 2 minutos, identidad, racha, aviso, meta y "sin guardar". No toca los controles.
function dibujarInfo(c, x, F) {
  const hoy = L.todayStr();
  const m = mapa(x.id);
  const reg = m.get(F);
  const r = L.streak(x, F, m, hoy, S.desde);
  const { arriba, abajo } = c._partes;
  c.classList.toggle("done", !!reg?.done);
  poner(arriba,
    h("div", { class: "card-top" },
      h("div", { class: "card-title" },
        h("h3", { text: x.name }),
        x.two_minute && h("p", { class: "two", text: `2 minutos: ${x.two_minute}` }),
        x.identity && h("p", { class: "small", text: x.identity })),
      h("div", { class: "streak", text: `Racha ${r.count}${r.capped ? "+" : ""}` })),
    L.shouldWarn(x, F, m, hoy) && h("p", { class: "warn", text: "La última vez fallaste: no falles dos veces" }));
  const meta = L.metaLabel(x);
  poner(abajo, meta && h("p", { class: "small", text: meta }), filaSinGuardar(`ci|${x.id}|${F}`));
  S.votos?.();
}

function dibujarControles(c, x, F) {
  const { ctl } = c._partes;
  const reg = mapa(x.id).get(F);
  const romper = x.kind === "romper";

  if (x.measure === "number") {
    const v = reg?.value_num ?? null;
    const redondear = (n) => Math.round(n * 1000) / 1000;
    ctl.replaceChildren(
      h("button", {
        type: "button", text: "−", "aria-label": "Restar uno", disabled: v == null || v <= 0,
        onclick: () => cambiarValor(x, F, Math.max(0, redondear(v - 1)), ESPERA_VALOR, true),
      }),
      h("output", { class: "value", text: v == null ? "Sin registrar" : L.fmtNum(v) }),
      h("button", { type: "button", text: "+", "aria-label": "Sumar uno", onclick: () => cambiarValor(x, F, redondear((v ?? 0) + 1), ESPERA_VALOR, true) }),
      h("button", { type: "button", text: "0", "aria-label": "Registrar cero", onclick: () => cambiarValor(x, F, 0, ESPERA_VALOR, true) }));
    return;
  }

  if (x.measure === "time") {
    const v = reg?.value_time ? String(reg.value_time).slice(0, 5) : "";
    const borrar = h("button", {
      type: "button", text: "Borrar", disabled: !v,
      onclick: () => cambiarValor(x, F, null, 0, true),
    });
    const hora = h("input", {
      type: "time", value: v, "aria-label": `Hora de ${x.name}`,
      onchange: (e) => {
        const val = e.target.value || null;
        borrar.disabled = !val;
        cambiarValor(x, F, val, ESPERA_VALOR, false); // no redibuja el input mientras se usa
      },
    });
    ctl.replaceChildren(hora, borrar);
    return;
  }

  const hecho = !!reg?.done;
  ctl.replaceChildren(h("button", {
    type: "button",
    class: "check" + (hecho ? " on" : ""),
    "aria-pressed": hecho ? "true" : "false",
    text: hecho ? (romper ? "✓ Lo evité" : "✓ Hecho") : (romper ? "Lo evité" : "Marcar como hecho"),
    onclick: () => cambiarValor(x, F, hecho ? null : true, 0, true),
  }));
}

// valor null = sin registro (se borra el checkin).
function cambiarValor(x, F, valor, espera, redibujarControles) {
  const m = mapa(x.id);
  if (valor == null) {
    m.delete(F);
  } else {
    m.set(F, {
      ...(m.get(F) || {}),
      habit_id: x.id,
      date: F,
      done: L.computeDone(x, valor),
      value_num: x.measure === "number" ? valor : null,
      value_time: x.measure === "time" ? valor : null,
    });
  }
  const c = S.tarjetas.get(x.id);
  if (c && c.isConnected) {
    if (redibujarControles) dibujarControles(c, x, F);
    dibujarInfo(c, x, F);
  }
  programarGuardado(`ci|${x.id}|${F}`, () => guardarCheckin(x, F), espera);
}

function programarGuardado(clave, fn, espera) {
  const previo = timers.get(clave);
  if (previo) clearTimeout(previo.t);
  const t = setTimeout(() => { timers.delete(clave); fn(); }, espera);
  timers.set(clave, { t, fn });
}

function guardarCheckin(x, F) {
  const clave = `ci|${x.id}|${F}`;
  return enCadena(clave, async () => {
    const reg = mapa(x.id).get(F);
    if (reg) {
      await q(sb.from("checkins").upsert(
        { habit_id: x.id, date: F, done: reg.done, value_num: reg.value_num, value_time: reg.value_time },
        { onConflict: "habit_id,date" }));
    } else {
      await q(sb.from("checkins").delete().eq("habit_id", x.id).eq("date", F));
    }
  }).then(
    () => { if (S.fallas.delete(clave)) refrescarTarjeta(x, F); },
    (e) => {
      console.warn(e);
      S.fallas.set(clave, { texto: "Sin guardar", reintentar: () => guardarCheckin(x, F) });
      refrescarTarjeta(x, F);
    });
}

function refrescarTarjeta(x, F) {
  if (S.tab !== "hoy" || S.fecha !== F) return;
  const c = S.tarjetas.get(x.id);
  if (c && c.isConnected) dibujarInfo(c, x, F);
}

// ---------- Hábitos ----------

function vistaHabitos() {
  if (S.form) return vistaFormulario();
  const activos = S.habits.filter((x) => x.active);
  const pausados = S.habits.filter((x) => !x.active);
  const lista = (xs, vacio) => xs.length
    ? h("ul", { class: "list" }, xs.map((x, i) => filaHabito(x, i, xs.length)))
    : h("p", { class: "empty", text: vacio });
  return h("section", {},
    h("div", { class: "title-row" },
      h("h1", { text: "Hábitos" }),
      h("button", { type: "button", class: "primary", text: "Agregar hábito", onclick: () => abrirFormulario(null) })),
    h("h2", { text: "Activos" }),
    lista(activos, "No tenés hábitos activos."),
    h("h2", { text: "Pausados" }),
    lista(pausados, "No hay hábitos pausados."));
}

function filaHabito(x, i, n) {
  const clave = `habits|${x.id}`;
  return h("li", { class: "row" },
    h("div", { class: "row-main" },
      h("strong", { text: x.name }),
      h("span", { class: "tag" + (x.kind === "romper" ? " romper" : ""), text: x.kind === "romper" ? "Romper" : "Construir" }),
      h("span", { class: "small", text: L.daysLabel(x.days) })),
    h("div", { class: "actions" },
      h("button", { type: "button", text: "↑", "aria-label": `Subir ${x.name}`, disabled: i === 0, onclick: () => moverHabito(x, -1) }),
      h("button", { type: "button", text: "↓", "aria-label": `Bajar ${x.name}`, disabled: i === n - 1, onclick: () => moverHabito(x, 1) }),
      h("button", { type: "button", text: "Editar", onclick: () => abrirFormulario(x) }),
      h("button", { type: "button", text: x.active ? "Pausar" : "Reactivar", onclick: () => cambiarActivo(x, !x.active) }),
      h("button", { type: "button", class: "danger", text: "Borrar", onclick: () => { S.confirmar = x.id; render(); } })),
    S.confirmar === x.id && h("div", { class: "confirm" },
      h("p", { text: `Si borrás "${x.name}" se pierde todo su historial.${x.active ? " ¿Preferís pausarlo?" : ""}` }),
      h("div", { class: "actions" },
        x.active && h("button", { type: "button", class: "primary", text: "Pausar en su lugar", onclick: () => { S.confirmar = null; cambiarActivo(x, false); } }),
        h("button", { type: "button", class: "danger", text: "Borrar igual", onclick: () => borrarHabito(x) }),
        h("button", { type: "button", text: "Cancelar", onclick: () => { S.confirmar = null; render(); } }))),
    filaSinGuardar(clave));
}

// Guarda en la base los campos de lista de una fila (siempre todos, así un reintento cubre todo).
function actualizarFila(tabla, fila, vista) {
  const clave = `${tabla}|${fila.id}`;
  const campos = tabla === "habits"
    ? () => ({ active: fila.active, sort: fila.sort })
    : () => ({ text: fila.text, rating: fila.rating, sort: fila.sort });
  return enCadena(clave, () => q(sb.from(tabla).update(campos()).eq("id", fila.id))).then(
    () => { if (S.fallas.delete(clave) && S.tab === vista && !S.form) render(); },
    (e) => {
      console.warn(e);
      S.fallas.set(clave, { texto: "Sin guardar", reintentar: () => actualizarFila(tabla, fila, vista) });
      if (S.tab === vista && !S.form) render();
    });
}

// Renumera sort según el orden de la lista y devuelve las filas que cambiaron.
function renumerar(lista) {
  const cambios = [];
  lista.forEach((y, k) => { if (y.sort !== k) { y.sort = k; cambios.push(y); } });
  return cambios;
}

function moverHabito(x, delta) {
  const mismos = S.habits.filter((y) => y.active === x.active);
  const i = mismos.indexOf(x);
  const j = i + delta;
  if (j < 0 || j >= mismos.length) return;
  [mismos[i], mismos[j]] = [mismos[j], mismos[i]];
  const otros = S.habits.filter((y) => y.active !== x.active);
  S.habits = x.active ? [...mismos, ...otros] : [...otros, ...mismos];
  const cambios = renumerar(S.habits);
  render();
  for (const y of cambios) actualizarFila("habits", y, "habitos");
}

function cambiarActivo(x, activo) {
  x.active = activo;
  render();
  actualizarFila("habits", x, "habitos");
}

async function borrarHabito(x) {
  const clave = `habits|${x.id}`;
  try {
    await q(sb.from("habits").delete().eq("id", x.id));
  } catch (e) {
    console.warn(e);
    S.fallas.set(clave, { texto: "No se pudo borrar", reintentar: () => borrarHabito(x) });
    S.confirmar = null;
    render();
    return;
  }
  S.habits = S.habits.filter((y) => y.id !== x.id);
  S.ci.delete(x.id);
  S.fallas.delete(clave);
  S.confirmar = null;
  if (S.histId === x.id) S.histId = null;
  render();
}

function abrirFormulario(x) {
  const campos = ["identity", "when_where", "stack_after", "environment", "attractive", "two_minute", "friction", "reward"];
  const d = {
    id: x?.id ?? null,
    name: x?.name ?? "",
    kind: x?.kind ?? "construir",
    measure: x?.measure ?? "check",
    target_num: x?.target_num != null ? L.fmtNum(x.target_num) : "",
    target_time: x?.target_time ? String(x.target_time).slice(0, 5) : "",
    target_dir: x?.target_dir ?? "min",
    days: x ? [...x.days] : [0, 1, 2, 3, 4, 5, 6],
    abiertas: new Set(),
    error: null,
    guardando: false,
  };
  for (const k of campos) d[k] = x?.[k] ?? "";
  // Al editar, las secciones con datos arrancan abiertas.
  LEYES[d.kind].forEach((s, i) => { if (s.campos.some(([k]) => d[k])) d.abiertas.add(i); });
  S.form = d;
  S.confirmar = null;
  render(true);
}

function vistaFormulario() {
  const d = S.form;
  const otros = S.habits.filter((x) => x.id !== d.id).map((x) => x.name);

  const campo = (k, etiqueta) => {
    const id = `f-${k}`;
    const props = { id, value: d[k], oninput: (e) => { d[k] = e.target.value; } };
    const control = k === "stack_after"
      ? h("input", { ...props, type: "text", list: "otros-habitos", autocomplete: "off" })
      : h("textarea", { ...props, rows: 2 });
    return [h("label", { for: id, text: etiqueta }), control];
  };

  const secciones = LEYES[d.kind].map((s, i) => h("details", {
    open: d.abiertas.has(i),
    ontoggle: (e) => { if (e.target.open) d.abiertas.add(i); else d.abiertas.delete(i); },
  }, h("summary", { text: s.titulo }), s.campos.map(([k, t]) => campo(k, t))));

  const medicion = [
    h("label", { for: "f-measure", text: "Cómo lo medís" }),
    h("select", { id: "f-measure", value: d.measure, onchange: (e) => { d.measure = e.target.value; render(); } },
      h("option", { value: "check", text: "Hecho o no hecho" }),
      h("option", { value: "number", text: "Con un número" }),
      h("option", { value: "time", text: "Con una hora" })),
  ];
  if (d.measure !== "check") {
    const numero = d.measure === "number";
    medicion.push(
      h("label", { for: "f-target", text: "Meta (opcional)" }),
      h("div", { class: "meta-row" },
        h("select", { id: "f-dir", "aria-label": "Dirección de la meta", value: d.target_dir, onchange: (e) => { d.target_dir = e.target.value; } },
          h("option", { value: "min", text: numero ? "al menos" : "no antes de" }),
          h("option", { value: "max", text: numero ? "como máximo" : "no después de" })),
        numero
          ? h("input", { id: "f-target", type: "text", inputmode: "decimal", placeholder: "Sin meta", value: d.target_num, oninput: (e) => { d.target_num = e.target.value; } })
          : h("input", { id: "f-target", type: "time", value: d.target_time, oninput: (e) => { d.target_time = e.target.value; }, onchange: (e) => { d.target_time = e.target.value; } })));
  }
  medicion.push(
    h("label", { text: "Días de la semana" }),
    h("div", { class: "days", role: "group", "aria-label": "Días de la semana" },
      L.ORDEN_DIAS.map((n) => h("button", {
        type: "button", text: L.DIAS_CORTOS[n], "aria-label": L.DIAS[n],
        "aria-pressed": d.days.includes(n) ? "true" : "false",
        onclick: (e) => {
          d.days = d.days.includes(n) ? d.days.filter((k) => k !== n) : [...d.days, n];
          e.currentTarget.setAttribute("aria-pressed", d.days.includes(n) ? "true" : "false");
        },
      }))));

  return h("section", {},
    h("h1", { text: d.id ? "Editar hábito" : "Nuevo hábito" }),
    h("form", { novalidate: true, onsubmit: (e) => { e.preventDefault(); guardarFormulario(); } },
      h("label", { for: "f-name", text: "Nombre (obligatorio)" }),
      h("input", { id: "f-name", type: "text", maxlength: 80, autocomplete: "off", value: d.name, oninput: (e) => { d.name = e.target.value; } }),
      h("label", { text: "Tipo" }),
      h("div", { class: "seg", role: "group", "aria-label": "Tipo de hábito" },
        [["construir", "Construir"], ["romper", "Romper"]].map(([k, t]) => h("button", {
          type: "button", text: t, "aria-pressed": d.kind === k ? "true" : "false",
          onclick: () => { d.kind = k; render(); },
        }))),
      secciones,
      h("datalist", { id: "otros-habitos" }, otros.map((nombre) => h("option", { value: nombre }))),
      h("div", { class: "box" }, h("h3", { text: "Medición", style: "margin-top:12px" }), medicion),
      d.error && h("div", { class: "unsaved", role: "alert" },
        h("span", { text: d.error }),
        d.fallo && h("button", { type: "button", text: "Reintentar", onclick: () => guardarFormulario() })),
      h("div", { class: "form-actions" },
        h("button", { type: "button", text: "Cancelar", onclick: () => { S.form = null; render(true); } }),
        h("button", { type: "submit", class: "primary", text: d.guardando ? "Guardando…" : "Guardar", disabled: d.guardando }))));
}

async function guardarFormulario() {
  const d = S.form;
  if (!d || d.guardando) return;
  const { payload, error } = L.normalizeHabit(d);
  if (error) { d.error = error; d.fallo = false; render(); return; }
  d.error = null;
  d.guardando = true;
  render();
  try {
    if (d.id) {
      const fila = await q(sb.from("habits").update(payload).eq("id", d.id).select().single());
      S.habits = S.habits.map((x) => (x.id === d.id ? fila : x));
    } else {
      const sort = S.habits.reduce((m, x) => Math.max(m, x.sort), -1) + 1;
      const fila = await q(sb.from("habits").insert({ ...payload, sort }).select().single());
      S.habits.push(fila);
    }
  } catch (e) {
    console.warn(e);
    d.guardando = false;
    d.error = "Sin guardar. " + mensajeError(e);
    d.fallo = true;
    if (S.form === d) render();
    return;
  }
  if (S.form === d) {
    S.form = null;
    render(true);
  }
}

// ---------- Historial ----------

async function vistaHistorial() {
  const hoy = L.todayStr();
  if (!S.habits.length) {
    return h("section", {}, h("h1", { text: "Historial" }), h("p", { class: "empty", text: "Todavía no tenés hábitos." }));
  }
  const orden = [...S.habits.filter((x) => x.active), ...S.habits.filter((x) => !x.active)];
  const x = orden.find((y) => y.id === S.histId) || orden[0];
  S.histId = x.id;
  const inicio = L.addDays(L.mondayOf(hoy), -49); // 8 semanas, de lunes a domingo
  await asegurarDesde(inicio);
  const m = mapa(x.id);

  const celdas = [];
  for (let i = 0; i < 56; i++) {
    const d = L.addDays(inicio, i);
    if (d > hoy) { celdas.push(h("span", { class: "cell future" })); continue; }
    const st = L.dayStatus(x, d, m.get(d), hoy);
    celdas.push(h("button", {
      type: "button", class: `cell ${st}`, "aria-label": `${L.longDate(d)}: ${ESTADO_TEXTO[st]}`,
      onclick: () => { S.fecha = d; S.tab = "hoy"; render(true); },
    }, h("span", { class: "n", text: String(L.parseDate(d).getDate()) }), h("span", { class: "s", text: SIMBOLO[st] })));
  }

  return h("section", {},
    h("h1", { text: "Historial" }),
    h("select", { "aria-label": "Hábito", value: x.id, onchange: (e) => { S.histId = e.target.value; render(); } },
      orden.map((y) => h("option", { value: y.id, text: y.active ? y.name : `${y.name} (pausado)` }))),
    h("div", { class: "grid" },
      L.ORDEN_DIAS.map((n) => h("span", { class: "hd", text: L.DIAS_CORTOS[n] })),
      celdas),
    h("p", { class: "legend", text: "✓ cumplido  /  ✗ fallado  /  · hoy sin registro  /  en blanco: no tocaba. Tocá un día para abrirlo en Hoy." }));
}

// ---------- Revisión ----------

async function vistaRevision() {
  const hoy = L.todayStr();
  const actual = L.mondayOf(hoy);
  if (S.semana > actual) S.semana = actual;
  const W = S.semana;
  await Promise.all([asegurarDesde(W), asegurarRevision(W)]);
  const ans = S.reviews.get(W);
  const filas = S.habits
    .map((x) => ({ x, r: L.weekSummary(x, W, mapa(x.id), hoy) }))
    .filter(({ x, r }) => L.inReview(x, r));

  const estado = h("div");
  const pintarEstado = () => poner(estado, filaSinGuardar(`rev|${W}`));
  pintarEstado();

  const filaRev = ({ x, r }) => {
    const li = h("li", { class: "row" });
    const pintar = () => {
      const val = ans.dificultad[x.id];
      poner(li,
        h("div", { class: "row-main" },
          h("strong", { text: x.active ? x.name : `${x.name} (pausado)` }),
          h("span", { class: "score", text: `${r.done} de ${r.scheduled}` })),
        h("div", { class: "seg", role: "group", "aria-label": `Dificultad de ${x.name}` },
          DIFICULTAD.map(([k, t]) => h("button", {
            type: "button", text: t, "aria-pressed": val === k ? "true" : "false",
            onclick: () => { ans.dificultad[x.id] = k; pintar(); guardarRevision(W); },
          }))),
        CONSEJO[val] && h("p", { class: "tip", text: CONSEJO[val] }));
    };
    pintar();
    return li;
  };

  const areas = {};
  const preguntas = PREGUNTAS.map(([k, t]) => {
    const ta = h("textarea", {
      id: `r-${k}`, rows: 3, value: ans[k],
      onblur: () => { if (ta.value !== ans[k]) { ans[k] = ta.value; guardarRevision(W); } },
    });
    areas[k] = ta;
    return [h("label", { for: `r-${k}`, text: t }), ta];
  });
  S.rev = { W, areas, pintarEstado };

  const copiado = h("div");
  return h("section", {},
    h("h1", { text: "Revisión" }),
    h("div", { class: "weekbar" },
      h("button", { type: "button", text: "‹", "aria-label": "Semana anterior", onclick: () => { guardarAreasRevision(); S.semana = L.addDays(W, -7); render(); } }),
      h("strong", { text: L.weekLabel(W) }),
      h("button", { type: "button", text: "›", "aria-label": "Semana siguiente", disabled: W >= actual, onclick: () => { guardarAreasRevision(); S.semana = L.addDays(W, 7); render(); } })),
    estado,
    h("h2", { text: "Resumen" }),
    filas.length
      ? h("ul", { class: "list" }, filas.map(filaRev))
      : h("p", { class: "empty", text: "No hubo hábitos programados esta semana." }),
    h("h2", { text: "Preguntas" }),
    preguntas,
    h("div", { class: "actions", style: "margin-top:16px" },
      h("button", {
        type: "button", class: "primary wide", text: "Copiar resumen",
        onclick: () => { guardarAreasRevision(); copiar(textoResumen(W, filas, ans), copiado); },
      })),
    copiado);
}

// Pasa a answers lo escrito en las preguntas visibles de la semana W. Devuelve si cambió algo.
function sincronizarAreas(W) {
  const rv = S.rev;
  if (!rv || rv.W !== W || !rv.areas.bien?.isConnected) return false;
  const ans = S.reviews.get(W);
  let cambio = false;
  for (const [k, ta] of Object.entries(rv.areas)) {
    if (ta.value !== ans[k]) { ans[k] = ta.value; cambio = true; }
  }
  return cambio;
}

// Guarda lo escrito aunque el campo todavía no haya perdido el foco (cambio de pestaña o semana, app al fondo).
function guardarAreasRevision() {
  if (S.rev && sincronizarAreas(S.rev.W)) guardarRevision(S.rev.W);
}

function guardarRevision(W) {
  const clave = `rev|${W}`;
  const pintar = () => { if (S.rev?.W === W) S.rev.pintarEstado(); };
  return enCadena(clave, () => {
    sincronizarAreas(W); // manda siempre lo último que hay escrito
    return q(sb.from("reviews").upsert({ week_start: W, answers: S.reviews.get(W) }, { onConflict: "user_id,week_start" }));
  }).then(
    () => { if (S.fallas.delete(clave)) pintar(); },
    (e) => {
      console.warn(e);
      S.fallas.set(clave, { texto: "Sin guardar", reintentar: () => guardarRevision(W) });
      pintar();
    });
}

function textoResumen(W, filas, ans) {
  const anio = L.parseDate(L.addDays(W, 6)).getFullYear();
  const etiqueta = Object.fromEntries(DIFICULTAD);
  const lineas = [`Revisión · ${L.weekLabel(W)} de ${anio}`, ""];
  for (const { x, r } of filas) {
    const dif = ans.dificultad[x.id];
    let linea = `- ${x.name}: ${r.done} de ${r.scheduled}`;
    if (dif) linea += ` · ${etiqueta[dif]}${CONSEJO[dif] ? ` → ${CONSEJO[dif]}` : ""}`;
    lineas.push(linea);
  }
  for (const [k, t] of PREGUNTAS) lineas.push("", t, ans[k].trim() || "—");
  return lineas.join("\n");
}

async function copiar(texto, destino) {
  try {
    await navigator.clipboard.writeText(texto);
    destino.replaceChildren(h("p", { class: "ok", text: "Copiado." }));
  } catch {
    const ta = h("textarea", { rows: 10, readonly: true, value: texto });
    destino.replaceChildren(h("p", { class: "small", text: "No se pudo copiar solo. Copialo desde acá:" }), ta);
    ta.focus();
    ta.select();
  }
}

// ---------- Más ----------

function vistaMas() {
  return h("section", {},
    h("h1", { text: "Más" }),
    h("h2", { text: "Hoja de puntuación" }),
    hojaPuntuacion(),
    h("h2", { text: "Ideas del libro" }),
    h("ol", { class: "ideas" }, IDEAS.map((t, i) => {
      const hs = L.habitsForIdea(i + 1, S.habits);
      return h("li", {},
        h("p", { text: t }),
        hs.length > 0 && h("p", { class: "small", text: "La aplicás en: " + hs.map((x) => x.name).join(", ") }));
    })),
    h("h2", { text: "Tus datos" }),
    bloqueExportar(),
    h("h2", { text: "Cuenta" }),
    bloqueClave(),
    h("button", { type: "button", class: "danger wide", text: "Cerrar sesión", style: "margin-top:24px", onclick: cerrarSesion }));
}

// ---------- Cambiar contraseña ----------

const MINIMO_CLAVE = 12;

function bloqueClave() {
  const cont = h("div");
  pintarClave(cont);
  return cont;
}

function pintarClave(cont) {
  const aviso = h("p", { role: "status" });
  const mostrar = (m) => { S.claveMsg = m; aviso.className = m?.ok ? "ok" : "error"; aviso.textContent = m?.texto ?? ""; };
  mostrar(S.claveMsg);
  // Campo de usuario oculto: así el llavero del iPhone sabe de qué cuenta es la nueva contraseña.
  const usuario = h("input", {
    type: "email", name: "email", autocomplete: "username", value: S.user?.email ?? "",
    readonly: true, hidden: true, tabindex: "-1", "aria-hidden": "true",
  });
  const nueva = h("input", { id: "c-nueva", name: "new-password", type: "password", autocomplete: "new-password", minlength: MINIMO_CLAVE });
  const repetir = h("input", { id: "c-repetir", name: "confirm-password", type: "password", autocomplete: "new-password", minlength: MINIMO_CLAVE });
  const boton = h("button", { type: "submit", class: "primary wide", text: "Cambiar contraseña", style: "margin-top:12px" });

  const form = h("form", {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const password = nueva.value;
      if (password.length < MINIMO_CLAVE) { mostrar({ ok: false, texto: `La contraseña tiene que tener al menos ${MINIMO_CLAVE} caracteres.` }); return; }
      if (password !== repetir.value) { mostrar({ ok: false, texto: "Las dos contraseñas no coinciden." }); return; }
      mostrar(null);
      boton.disabled = true;
      boton.textContent = "Guardando…";
      let res;
      try {
        res = await sb.auth.updateUser({ password });
      } catch (e2) {
        res = { error: e2 };
      }
      if (res.error) {
        console.warn(res.error);
        boton.disabled = false;
        boton.textContent = "Cambiar contraseña";
        mostrar({ ok: false, texto: errorClave(res.error) });
        return;
      }
      S.claveMsg = { ok: true, texto: "Listo: tu contraseña cambió." };
      pintarClave(cont); // formulario nuevo y vacío
    },
  },
  usuario,
  h("label", { for: "c-nueva", text: `Nueva contraseña (mínimo ${MINIMO_CLAVE} caracteres)` }), nueva,
  h("label", { for: "c-repetir", text: "Repetir la nueva contraseña" }), repetir,
  boton);

  poner(cont, form, aviso);
}

function hojaPuntuacion() {
  const n = S.scorecard.length;
  const nuevo = h("input", {
    type: "text", maxlength: 200, placeholder: "Algo que hacés en el día", "aria-label": "Nuevo ítem",
    autocomplete: "off", value: S.nuevoItem, oninput: (e) => { S.nuevoItem = e.target.value; },
  });
  return h("div", {},
    n ? h("ul", { class: "list" }, S.scorecard.map((it, i) => filaItem(it, i, n))) : h("p", { class: "empty", text: "Todavía no anotaste nada." }),
    h("form", { class: "add-row", novalidate: true, onsubmit: (e) => { e.preventDefault(); agregarItem(); } },
      nuevo, h("button", { type: "submit", class: "primary", text: "Agregar" })),
    filaSinGuardar("scorecard|nuevo"));
}

function filaItem(it, i, n) {
  const texto = h("input", {
    type: "text", maxlength: 200, value: it.text, "aria-label": "Texto del ítem",
    onchange: () => {
      const t = texto.value.trim();
      if (!t) { texto.value = it.text; return; } // no puede quedar vacío
      if (t !== it.text) { it.text = t; actualizarFila("scorecard", it, "mas"); }
    },
  });
  return h("li", { class: "row" },
    texto,
    h("div", { class: "actions" },
      RATINGS.map(([v, t, a]) => h("button", {
        type: "button", text: t, "aria-label": a, "aria-pressed": it.rating === v ? "true" : "false",
        onclick: () => { it.rating = v; render(); actualizarFila("scorecard", it, "mas"); },
      })),
      h("button", { type: "button", text: "↑", "aria-label": "Subir", disabled: i === 0, onclick: () => moverItem(it, -1) }),
      h("button", { type: "button", text: "↓", "aria-label": "Bajar", disabled: i === n - 1, onclick: () => moverItem(it, 1) }),
      h("button", { type: "button", class: "danger", text: "Borrar", onclick: () => borrarItem(it) })),
    filaSinGuardar(`scorecard|${it.id}`));
}

async function agregarItem() {
  const t = S.nuevoItem.trim().slice(0, 200);
  if (!t) return;
  const sort = S.scorecard.reduce((m, x) => Math.max(m, x.sort), -1) + 1;
  try {
    const fila = await q(sb.from("scorecard").insert({ text: t, sort }).select().single());
    S.scorecard.push(fila);
    S.nuevoItem = "";
    S.fallas.delete("scorecard|nuevo");
  } catch (e) {
    console.warn(e);
    S.fallas.set("scorecard|nuevo", { texto: "Sin guardar", reintentar: agregarItem });
  }
  if (S.tab === "mas") render();
}

function moverItem(it, delta) {
  const i = S.scorecard.indexOf(it);
  const j = i + delta;
  if (j < 0 || j >= S.scorecard.length) return;
  const l = [...S.scorecard];
  [l[i], l[j]] = [l[j], l[i]];
  S.scorecard = l;
  const cambios = renumerar(l);
  render();
  for (const y of cambios) actualizarFila("scorecard", y, "mas");
}

async function borrarItem(it) {
  const clave = `scorecard|${it.id}`;
  try {
    await q(sb.from("scorecard").delete().eq("id", it.id));
  } catch (e) {
    console.warn(e);
    S.fallas.set(clave, { texto: "No se pudo borrar", reintentar: () => borrarItem(it) });
    if (S.tab === "mas") render();
    return;
  }
  S.scorecard = S.scorecard.filter((x) => x.id !== it.id);
  S.fallas.delete(clave);
  if (S.tab === "mas") render();
}

// ---------- Exportar ----------

function bloqueExportar() {
  const cont = h("div", { class: "export" });
  pintarExport(cont);
  return cont;
}

function pintarExport(cont) {
  const e = S.exp;
  if (!e || e.estado === "error") {
    poner(cont,
      e && h("p", { class: "error", text: "No se pudo exportar. " + e.msg }),
      h("button", { type: "button", class: "wide", text: e ? "Reintentar" : "Exportar mis datos (JSON)", onclick: () => exportar(cont) }));
    return;
  }
  if (e.estado === "preparando") {
    cont.replaceChildren(h("p", { class: "small", text: "Preparando tus datos…" }));
    return;
  }
  if (e.estado === "texto") {
    const nota = h("div");
    const ta = h("textarea", { readonly: true, value: e.json, "aria-label": "Tus datos en JSON" });
    cont.replaceChildren(
      h("p", { class: "small", text: "Copiá este texto y guardalo donde quieras:" }),
      ta,
      h("button", { type: "button", class: "primary wide", text: "Copiar", onclick: () => copiar(e.json, nota) }),
      nota);
    return;
  }
  poner(cont,
    h("button", { type: "button", class: "primary wide", text: "Guardar archivo", onclick: () => guardarArchivo(cont, false) }),
    e.nota && h("p", { class: "small", text: e.nota }),
    e.verTexto && h("button", {
      type: "button", class: "wide", text: "¿No se descargó? Ver como texto",
      onclick: () => { e.estado = "texto"; pintarExport(cont); },
    }));
}

async function exportar(cont) {
  S.exp = { estado: "preparando" };
  pintarExport(cont);
  try {
    const [habits, checkins, scorecard, reviews] = await Promise.all([
      traerTodo(() => sb.from("habits").select("*").order("sort").order("id")),
      traerTodo(() => sb.from("checkins").select("*").order("date").order("id")),
      traerTodo(() => sb.from("scorecard").select("*").order("sort").order("id")),
      traerTodo(() => sb.from("reviews").select("*").order("week_start").order("id")),
    ]);
    const json = JSON.stringify({ app: "habitos", dia: L.todayStr(), habits, checkins, scorecard, reviews }, null, 2);
    S.exp = { estado: "listo", json, nombre: `habitos-${L.todayStr()}.json` };
  } catch (err) {
    console.warn(err);
    S.exp = { estado: "error", msg: mensajeError(err) };
    pintarExport(cont);
    return;
  }
  pintarExport(cont);
  await guardarArchivo(cont, true);
}

// 1) navigator.share con un File · 2) descarga con <a download> · 3) textarea con Copiar.
async function guardarArchivo(cont, automatico) {
  const e = S.exp;
  const archivo = new File([e.json], e.nombre, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: e.nombre });
      e.nota = "Listo.";
      pintarExport(cont);
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // lo canceló
      if (automatico && err.name === "NotAllowedError") { pintarExport(cont); return; } // que toque "Guardar archivo"
    }
  }
  try {
    const url = URL.createObjectURL(archivo);
    const a = h("a", { href: url, download: e.nombre, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    e.nota = `Se descargó ${e.nombre}.`;
    e.verTexto = true;
  } catch (err) {
    console.warn(err);
    e.estado = "texto";
  }
  pintarExport(cont);
}

iniciar();
