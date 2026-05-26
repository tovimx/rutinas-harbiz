const data = window.CUATRO_PERFORMANCE_DATA || { events: [], workouts: [], stats: {} };

const CONFIG_KEY = "cuatro-padel-performance.config.v1";
const PROGRESS_KEY = "cuatro-padel-performance.progress.v1";
const PROFILE_KEY = "cuatro-padel-performance.profile.v1";
const SYNC_META_KEY = "cuatro-padel-performance.sync.v1";
const SYNC_DATA_KEYS = new Set([CONFIG_KEY, PROGRESS_KEY, PROFILE_KEY]);

const defaultConfig = {
  startDate: nextMondayValue(),
  frequency: 3,
  goal: "padel",
};

const defaultProfile = {
  name: "",
  planStarted: false,
  introStarted: false,
};

const state = {
  profile: { ...defaultProfile, ...readStorage(PROFILE_KEY, {}) },
  config: { ...defaultConfig, ...readStorage(CONFIG_KEY, {}) },
  progress: readStorage(PROGRESS_KEY, {}),
  syncMeta: readStorage(SYNC_META_KEY, {}),
  firebase: {
    configured: false,
    ready: false,
    user: null,
    status: "local",
    message: "Progreso local",
    error: "",
    cloudReady: false,
    applyingCloud: false,
    lastSavedAt: "",
  },
  support: {
    sending: false,
    message: "",
    status: "",
  },
  view: "plan",
  selectedWeek: 0,
  selectedSessionId: "",
  sessionMode: "preview",
  activeStageIndex: 0,
  query: "",
  block: "all",
};

const els = {
  statsPanel: document.querySelector("#statsPanel"),
  appStepPanel: document.querySelector("#appStepPanel"),
  dashboardBoard: document.querySelector("#dashboard"),
  progressBand: document.querySelector("#progressBand"),
  weekRail: document.querySelector("#weekRail"),
  calendarSummary: document.querySelector("#calendarSummary"),
  controlDock: document.querySelector("#biblioteca"),
  filterBand: document.querySelector(".filter-band"),
  searchInput: document.querySelector("#searchInput"),
  blockFilters: document.querySelector("#blockFilters"),
  contentArea: document.querySelector("#sesion"),
  sourceStrip: document.querySelector("#archivo"),
  printButton: document.querySelector("#printButton"),
  beginOnboardingButton: document.querySelector("#beginOnboardingButton"),
  accountPanel: document.querySelector("#accountPanel"),
  viewTabs: document.querySelectorAll(".tab-button"),
};

const iconExternal = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 17 17 7M9 7h8v8"></path>
  </svg>`;

const iconPlay = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5v14l11-7-11-7Z"></path>
  </svg>`;

const weekSlots = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 5],
};

const goalProfiles = {
  padel: {
    label: "Padel completo",
    focus: "fuerza util, potencia lateral y movilidad para competir mejor",
    cue: "prioriza tecnica limpia y deja 1-2 repeticiones en reserva",
  },
  strength: {
    label: "Fuerza",
    focus: "capacidad de producir fuerza en tren inferior, core y empujes/tirones",
    cue: "usa cargas controladas y descansa completo en los bloques principales",
  },
  knee: {
    label: "Rodilla",
    focus: "control de aterrizaje, alineacion de rodilla y tolerancia a cambios de direccion",
    cue: "manten rodilla alineada con pie y evita dolor punzante",
  },
  power: {
    label: "Potencia",
    focus: "saltos, lanzamientos y aceleraciones transferibles al punto",
    cue: "mueve rapido sin perder postura; corta la serie si baja la velocidad",
  },
};

const workouts = (data.workouts || [])
  .map((workout, index) => {
    const originalDate = parseWorkoutDate(workout.scheduled_date) || parseListingDate(workout.listing_date);
    return {
      ...workout,
      index,
      originalDate,
      originalKey: dateKey(originalDate),
      category: classifyWorkout(workout),
    };
  })
  .sort((a, b) => (b.originalDate || 0) - (a.originalDate || 0));

const allExercises = workouts.flatMap((workout) =>
  (workout.exercises || []).map((exercise) => ({
    ...exercise,
    workout,
    workoutIndex: workout.index,
  }))
);

const programStart = new Date(Date.UTC(2026, 2, 31, 12));
const programWorkouts = workouts
  .filter((workout) => workout.category === "strength" && workout.originalDate >= programStart)
  .sort((a, b) => a.originalDate - b.originalDate);

const accessoryWorkouts = workouts
  .filter((workout) => ["mobility", "recovery", "test"].includes(workout.category))
  .sort((a, b) => a.originalDate - b.originalDate);

const uniqueExercises = uniqueBy(
  allExercises,
  (exercise) => `${normalize(exercise.name)}|${clean(exercise.video_url)}`
);

const uniqueVideos = uniqueBy(
  allExercises.filter((exercise) => exercise.video_url),
  (exercise) => exercise.video_url
);

let plan = buildPlan();

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalize(value) {
  return clean(value).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  if (SYNC_DATA_KEYS.has(key) && state && !state.firebase.applyingCloud) {
    state.syncMeta = { updatedAt: new Date().toISOString() };
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(state.syncMeta));
    queueCloudSave();
  }
}

function persistCloudStateLocally() {
  state.firebase.applyingCloud = true;
  writeStorage(PROFILE_KEY, state.profile);
  writeStorage(CONFIG_KEY, state.config);
  writeStorage(PROGRESS_KEY, state.progress);
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(state.syncMeta));
  state.firebase.applyingCloud = false;
}

function localExperienceExists() {
  return Boolean(
    state.profile.name ||
      state.profile.planStarted ||
      state.profile.introStarted ||
      Object.keys(state.progress || {}).length
  );
}

function exportCloudState() {
  return {
    profile: state.profile,
    config: state.config,
    progress: state.progress,
    localUpdatedAt: state.syncMeta.updatedAt || "",
  };
}

function applyCloudState(cloudState) {
  if (!cloudState) return;
  state.profile = { ...defaultProfile, ...(cloudState.profile || {}) };
  state.config = { ...defaultConfig, ...(cloudState.config || {}) };
  state.progress = cloudState.progress || {};
  state.syncMeta = { updatedAt: cloudState.updatedAt || cloudState.localUpdatedAt || new Date().toISOString() };
  persistCloudStateLocally();
  plan = buildPlan();
  ensureSelection();
  render();
}

let cloudSaveTimer = null;

function queueCloudSave(immediate = false) {
  const service = window.CuatroFirebase;
  if (!service || !state.firebase.user || state.firebase.applyingCloud) return;
  if (!state.firebase.cloudReady && !immediate) return;

  clearTimeout(cloudSaveTimer);
  state.firebase.status = "syncing";
  state.firebase.message = "Sincronizando";
  renderAccountPanel();

  cloudSaveTimer = setTimeout(saveCloudState, immediate ? 0 : 600);
}

async function saveCloudState() {
  const service = window.CuatroFirebase;
  if (!service || !state.firebase.user) return;

  try {
    await service.saveState(exportCloudState());
    state.firebase.status = "synced";
    state.firebase.message = "Sincronizado";
    state.firebase.error = "";
    state.firebase.lastSavedAt = new Date().toISOString();
  } catch (error) {
    state.firebase.status = "error";
    state.firebase.message = "No se pudo sincronizar";
    state.firebase.error = error.message || "Error al guardar en Firebase.";
  }

  renderAccountPanel();
}

function nextMondayValue() {
  const date = new Date();
  const offset = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + offset);
  return toDateInputValue(date);
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseWorkoutDate(value) {
  const parts = clean(value).split("/").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(Date.UTC(parts[2], parts[1] - 1, parts[0], 12));
}

function parseListingDate(value) {
  const months = new Map([
    ["enero", 0],
    ["febrero", 1],
    ["marzo", 2],
    ["abril", 3],
    ["mayo", 4],
    ["junio", 5],
    ["julio", 6],
    ["agosto", 7],
    ["septiembre", 8],
    ["setiembre", 8],
    ["octubre", 9],
    ["noviembre", 10],
    ["diciembre", 11],
  ]);
  const normalized = normalize(value).replace(/[.,]/g, "");
  const parts = normalized.split(/\s+/);
  const day = Number(parts.find((part) => /^\d+$/.test(part)));
  const month = parts.map((part) => months.get(part)).find((part) => Number.isInteger(part));
  const year = Number(data.stats?.latest_event?.slice(0, 4)) || new Date().getFullYear();
  if (!day || month === undefined) return null;
  return new Date(Date.UTC(year, month, day, 12));
}

function dateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function uniqueBy(items, keyFn) {
  return Array.from(new Map(items.map((item) => [keyFn(item), item])).values());
}

function classifyWorkout(workout) {
  const title = normalize(workout.title || workout.listing_title);
  if (/^fuerza fb\d/.test(title)) return "strength";
  if (/movilidad/.test(title)) return "mobility";
  if (/recovery|regeneration|recuper/.test(title)) return "recovery";
  if (/test/.test(title)) return "test";
  if (/shape|mmslow/.test(title)) return "foundation";
  return "other";
}

function buildPlan() {
  const start = new Date(`${state.config.startDate || defaultConfig.startDate}T12:00:00`);
  const frequency = Number(state.config.frequency) || 3;
  const slots = weekSlots[frequency] || weekSlots[3];
  const sessions = programWorkouts.map((workout, index) => {
    const weekIndex = Math.floor(index / frequency);
    const slot = slots[index % frequency];
    const scheduledDate = addDays(start, weekIndex * 7 + slot);
    const phase = phaseForIndex(index);
    return {
      id: `session-${index}-${workout.source_event_id || workout.index}`,
      number: index + 1,
      weekIndex,
      scheduledDate,
      workout,
      phase,
    };
  });

  const weeks = [];
  sessions.forEach((session) => {
    if (!weeks[session.weekIndex]) {
      const weekStart = addDays(start, session.weekIndex * 7);
      weeks[session.weekIndex] = {
        index: session.weekIndex,
        title: `Semana ${session.weekIndex + 1}`,
        range: `${formatDate(weekStart)} - ${formatDate(addDays(weekStart, 6))}`,
        sessions: [],
        accessories: accessorySuggestions(session.weekIndex),
      };
    }
    weeks[session.weekIndex].sessions.push(session);
  });

  return {
    start,
    frequency,
    sessions,
    weeks,
    completedCount: sessions.filter((session) => state.progress[session.id]?.completed).length,
  };
}

function phaseForIndex(index) {
  if (index < 3) {
    return {
      name: "Base de control",
      intent: "aprender patrones, aterrizar estable y preparar rodilla/cadera/hombro.",
      load: "Media",
    };
  }
  if (index < 15) {
    return {
      name: "Fuerza transferible",
      intent: "subir carga en sentadillas, bisagras, empujes, remos y core anti-rotacion.",
      load: "Media-alta",
    };
  }
  return {
    name: "Potencia de pista",
    intent: "convertir fuerza en saltos, lanzamientos y cambios de direccion mas rapidos.",
    load: "Alta",
  };
}

function accessorySuggestions(weekIndex) {
  const mobility = accessoryWorkouts.filter((workout) => workout.category === "mobility");
  const recovery = accessoryWorkouts.filter((workout) => workout.category === "recovery");
  const tests = accessoryWorkouts.filter((workout) => workout.category === "test");
  const suggestions = [];
  if (mobility.length) suggestions.push(mobility[weekIndex % mobility.length]);
  if (weekIndex % 2 === 1 && recovery.length) suggestions.push(recovery[weekIndex % recovery.length]);
  if (weekIndex % 4 === 0 && tests.length) suggestions.push(tests[weekIndex % tests.length]);
  return suggestions;
}

function currentWeek() {
  return plan.weeks[state.selectedWeek] || plan.weeks[0];
}

function currentSession() {
  const week = currentWeek();
  if (!week) return null;
  const selected = week.sessions.find((session) => session.id === state.selectedSessionId);
  return selected || week.sessions[0] || null;
}

function ensureSelection() {
  if (!plan.weeks.length) return;
  if (!plan.weeks[state.selectedWeek]) state.selectedWeek = 0;
  const week = currentWeek();
  if (!week.sessions.some((session) => session.id === state.selectedSessionId)) {
    const incomplete = week.sessions.find((session) => !state.progress[session.id]?.completed);
    state.selectedSessionId = (incomplete || week.sessions[0])?.id || "";
  }
}

function routineInsight(workout, session) {
  const title = normalize(workout.title);
  const goal = goalProfiles[state.config.goal] || goalProfiles.padel;
  const equipment = equipmentSummary(workout.exercises || []);
  let improves = "fuerza usable, estabilidad y control de movimiento";
  let padel = "mejora frenadas, salidas y tolerancia fisica durante puntos largos";
  let caution = "manten tecnica limpia antes de subir carga";

  if (/fb1|fb2|fb3/.test(title)) {
    improves = "base de fuerza, movilidad y control de rodilla";
    padel = "ayuda a sostener cambios de direccion sin colapsar postura";
    caution = "controla cada aterrizaje y prioriza rango comodo";
  } else if (/fb4|fb5|fb6/.test(title)) {
    improves = "fuerza submaxima en piernas, torso y espalda";
    padel = "te da mas estabilidad al defender bolas bajas y empujar hacia la red";
    caution = "descansa lo suficiente para que las series principales salgan solidas";
  } else if (/fb7|fb8|fb9/.test(title)) {
    improves = "fuerza avanzada, potencia lateral y velocidad de aplicacion";
    padel = "transfiere a split-step, salidas explosivas, smash y recuperacion tras defensa";
    caution = "si baja la velocidad, corta la serie o reduce carga";
  }

  return [
    { label: "Mejora", value: improves },
    { label: "Padel", value: padel },
    { label: "Enfoque", value: goal.focus },
    { label: "Carga", value: `${session.phase.load} - ${session.phase.name}` },
    { label: "Equipo", value: equipment || "peso corporal y material basico" },
    { label: "Foco", value: caution },
  ];
}

function exerciseInsight(exercise) {
  const name = normalize(exercise.name);
  const block = normalize(exercise.block);
  const combined = `${name} ${block}`;
  const equipment = equipmentFor(combined);
  const intensity = intensityFor(combined, exercise.prescription);
  const improves = improvesFor(combined);
  const transfer = transferFor(combined);
  const cue = cueFor(combined);
  const alternative = alternativeFor(combined, equipment);

  return {
    improves,
    transfer,
    cue,
    equipment,
    intensity,
    alternative,
    text: `${improves} ${transfer} ${cue} ${equipment} ${intensity} ${alternative}`,
  };
}

function equipmentFor(text) {
  const items = [];
  if (/db|dumbbell|mancuerna/.test(text)) items.push("mancuernas");
  if (/barbell|barra|landmine/.test(text)) items.push("barra");
  if (/cable|polea/.test(text)) items.push("polea");
  if (/band|banda|goma/.test(text)) items.push("banda");
  if (/foam|roller|miofascial/.test(text)) items.push("foam roller");
  if (/mb|medicine|medicinal|pelota/.test(text)) items.push("pelota medicinal");
  if (/bike|bicicleta/.test(text)) items.push("bicicleta");
  if (/wall|pared/.test(text)) items.push("pared");
  return items.length ? uniqueBy(items, (item) => item).join(", ") : "peso corporal";
}

function intensityFor(text, prescriptionText) {
  const prescription = normalize(prescriptionText);
  if (/jump|bound|pogo|saltar|lanzar|slam|throw|speed|hiit|emom/.test(text)) return "alta";
  if (/rpe 8|rpe 9|heavy|principal|sentadilla|squat|deadlift|rdl|bench|press/.test(`${text} ${prescription}`)) return "media-alta";
  if (/movilidad|stretch|recovery|foam|regeneration/.test(text)) return "suave";
  return "media";
}

function improvesFor(text) {
  if (/movilidad|stretch|90\/90|dorsiflex|cossack|openers|flexion|transitions/.test(text)) return "movilidad de cadera, tobillo y hombro";
  if (/plank|pallof|dead.?bug|bird.?dog|core|chop|anti/.test(text)) return "core estable y control anti-rotacion";
  if (/squat|sentadilla|lunge|zancada|split|leg extension|wall sit/.test(text)) return "fuerza de piernas y control de rodilla";
  if (/deadlift|rdl|hinge|hip thrust|glute|bridge|hamstring/.test(text)) return "cadena posterior, gluteo e isquios";
  if (/jump|bound|pogo|drop|cmj|saltar/.test(text)) return "potencia elastica y aterrizajes estables";
  if (/throw|slam|lanzar|mb|medicine/.test(text)) return "potencia de torso y transferencia de fuerza";
  if (/row|remo|pulldown|jalon|face pull|ytwl/.test(text)) return "espalda fuerte y hombros mas estables";
  if (/press|push|bench|triceps/.test(text)) return "empuje de tren superior y estabilidad escapular";
  if (/bike|esd|finisher|hiit|emom|skipping|burpee/.test(text)) return "resistencia especifica y capacidad de repetir esfuerzos";
  if (/foam|miofascial|regeneration|recovery/.test(text)) return "recuperacion, circulacion y descarga muscular";
  return "control corporal, fuerza general y coordinacion";
}

function transferFor(text) {
  if (/movilidad|stretch|dorsiflex|cossack/.test(text)) return "en padel permite llegar mas bajo a bolas abiertas y defender sin compensar";
  if (/plank|pallof|chop|dead.?bug|core/.test(text)) return "en padel ayuda a golpear y frenar sin que el tronco se desarme";
  if (/squat|sentadilla|lunge|zancada|split|wall sit/.test(text)) return "en padel mejora split-step, frenadas y salidas laterales";
  if (/deadlift|rdl|hip thrust|glute|bridge/.test(text)) return "en padel aporta empuje para arrancar, recuperar posicion y saltar";
  if (/jump|bound|pogo|drop|cmj|saltar/.test(text)) return "en padel transfiere a reactividad, cambios de ritmo y recuperaciones explosivas";
  if (/throw|slam|lanzar|mb|medicine/.test(text)) return "en padel conecta piernas, cadera y torso para bandeja, vibora y smash";
  if (/row|remo|pulldown|jalon|face pull|ytwl/.test(text)) return "en padel protege hombro y mejora control de pala en golpes repetidos";
  if (/press|push|bench/.test(text)) return "en padel ayuda a sostener golpes ofensivos y estabilidad del hombro";
  if (/bike|esd|finisher|hiit|emom|burpee/.test(text)) return "en padel mejora recuperacion entre puntos y tolerancia a rallies largos";
  return "en padel mejora la calidad general del movimiento y reduce gestos compensados";
}

function cueFor(text) {
  if (/jump|bound|pogo|drop|cmj|saltar/.test(text)) return "aterriza suave, rodilla alineada y pausa antes de repetir";
  if (/squat|sentadilla|lunge|zancada|split/.test(text)) return "empuja el suelo, torso firme y rodilla siguiendo la punta del pie";
  if (/deadlift|rdl|hinge|hip thrust/.test(text)) return "bisagra desde cadera, espalda larga y tension en gluteo/isquios";
  if (/row|remo|pulldown|jalon/.test(text)) return "inicia desde escapula y evita encoger hombros";
  if (/press|push|bench/.test(text)) return "costillas abajo, hombro estable y recorrido controlado";
  if (/movilidad|stretch|foam|recovery/.test(text)) return "respira lento y busca rango sin dolor";
  if (/plank|pallof|dead.?bug|bird.?dog|core/.test(text)) return "bloquea costillas y pelvis; el movimiento no debe mover tu columna";
  return "muevete controlado y detente si aparece dolor agudo";
}

function alternativeFor(text, equipment) {
  if (equipment.includes("polea")) return "usa banda elastica anclada si no tienes polea";
  if (equipment.includes("mancuernas")) return "reduce carga o usa botella/mochila si entrenas en casa";
  if (equipment.includes("barra")) return "cambia por mancuerna o version goblet";
  if (equipment.includes("pelota medicinal")) return "hazlo con banda o baja velocidad sin lanzamiento";
  if (/jump|bound|pogo|drop|cmj|saltar/.test(text)) return "haz step-and-stick sin salto";
  return "reduce rango, repeticiones o velocidad para mantener tecnica";
}

function equipmentSummary(exercises) {
  const equipment = uniqueBy(
    exercises.map((exercise) => equipmentFor(`${normalize(exercise.name)} ${normalize(exercise.block)}`)),
    (item) => item
  ).filter(Boolean);
  return equipment.slice(0, 4).join(" - ");
}

function matchesQuery(exercise, query) {
  if (!query) return true;
  const insight = exerciseInsight(exercise);
  const haystack = [
    exercise.name,
    exercise.block,
    exercise.prescription,
    exercise.rest,
    exercise.instructions,
    exercise.notes?.join(" "),
    exercise.workout?.title,
    insight.text,
  ].join(" ");
  return normalize(haystack).includes(normalize(query));
}

function applyFilters(exercises) {
  return exercises.filter((exercise) => {
    const blockOk = state.block === "all" || exercise.block === state.block;
    return blockOk && matchesQuery(exercise, state.query);
  });
}

function renderStats() {
  els.statsPanel.innerHTML = `
    <span class="metric-pill"><strong>${programWorkouts.length}</strong><em>sesiones</em></span>
    <span class="metric-pill"><strong>${plan.weeks.length}</strong><em>semanas</em></span>
    <span class="metric-pill"><strong>${uniqueExercises.length}</strong><em>ejercicios</em></span>
    <span class="metric-pill"><strong>${uniqueVideos.length}</strong><em>videos</em></span>
  `;
}

function renderAccountPanel() {
  if (!els.accountPanel) return;
  const firebase = state.firebase;
  const user = firebase.user;
  const initials = user?.displayName
    ? user.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
    : "4P";

  if (!firebase.configured) {
    els.accountPanel.innerHTML = `
      <span class="sync-chip is-local">
        <i></i>
        <strong>Local</strong>
      </span>
    `;
    return;
  }

  if (!firebase.ready) {
    els.accountPanel.innerHTML = `
      <span class="sync-chip is-loading">
        <i></i>
        <strong>Conectando</strong>
      </span>
    `;
    return;
  }

  if (!user) {
    els.accountPanel.innerHTML = `
      <button class="auth-button" type="button" data-auth-sign-in>
        <span class="sync-avatar">G</span>
        <strong>Guardar progreso</strong>
      </button>
    `;
    return;
  }

  els.accountPanel.innerHTML = `
    <div class="user-chip" title="${escapeHtml(user.email || user.displayName || "Cuenta conectada")}">
      <span class="sync-avatar">${escapeHtml(initials)}</span>
      <span>
        <strong>${escapeHtml(user.displayName || user.email || "Cuenta")}</strong>
        <em>${escapeHtml(firebase.message || "Sincronizado")}</em>
      </span>
    </div>
    <button class="signout-button" type="button" data-auth-sign-out aria-label="Cerrar sesion">Salir</button>
  `;
}

function renderPlanner() {
  const duration = plan.weeks.length;
  const goal = goalProfiles[state.config.goal] || goalProfiles.padel;

  if (!state.profile.name && !state.profile.introStarted) {
    els.appStepPanel.innerHTML = "";
    return;
  }

  if (!state.profile.name) {
    els.appStepPanel.innerHTML = `
      <form class="onboarding-form" data-name-form>
        <div class="panel-heading">
          <span>Paso 1</span>
          <strong>Bienvenido</strong>
        </div>
        <div>
          <h2>Primero, como te llamas?</h2>
          <p>Guardamos tu nombre solo en este navegador para personalizar el plan y el progreso.</p>
        </div>
        <label>
          <span class="field-label">Nombre</span>
          <input class="date-input" name="athleteName" autocomplete="name" placeholder="Tu nombre" required>
        </label>
        <button class="primary-action" type="submit">Continuar</button>
      </form>
    `;
    return;
  }

  els.appStepPanel.innerHTML = `
    <div class="panel-heading">
      <span>${state.profile.planStarted ? "Plan activo" : "Paso 2"}</span>
      <strong>${duration} semanas</strong>
    </div>
    <div class="profile-strip">
      <div>
        <span class="field-label">Jugador</span>
        <strong>${escapeHtml(state.profile.name)}</strong>
      </div>
      <button class="secondary-action" type="button" data-edit-name>Editar</button>
    </div>

    <label class="field-label" for="startDateInput">Fecha de inicio</label>
    <input id="startDateInput" class="date-input" type="date" value="${escapeHtml(state.config.startDate)}">

    <div class="field-label">Entrenamientos por semana</div>
    <div class="segmented-control" id="frequencyControl" role="radiogroup" aria-label="Entrenamientos por semana">
      ${[2, 3, 4].map((frequency) => `
        <button type="button" data-frequency="${frequency}" class="${Number(state.config.frequency) === frequency ? "is-active" : ""}">${frequency}</button>
      `).join("")}
    </div>

    <div class="field-label">Enfoque</div>
    <div class="goal-grid" id="goalControl" role="radiogroup" aria-label="Enfoque del plan">
      ${Object.entries(goalProfiles).map(([key, profile]) => `
        <button type="button" data-goal="${escapeHtml(key)}" class="${state.config.goal === key ? "is-active" : ""}">${escapeHtml(profile.label)}</button>
      `).join("")}
    </div>

    <div class="planner-summary">
      <div class="summary-row"><span>Inicio</span><strong>${escapeHtml(formatLongDate(plan.start))}</strong></div>
      <div class="summary-row"><span>Frecuencia</span><strong>${state.config.frequency} sesiones/semana</strong></div>
      <div class="summary-row"><span>Enfoque</span><strong>${escapeHtml(goal.label)}</strong></div>
      <div class="summary-row"><span>Guia</span><strong>${escapeHtml(goal.cue)}</strong></div>
    </div>

    <button class="primary-action setup-submit" type="button" data-start-plan>
      ${state.profile.planStarted ? "Actualizar calendario" : "Crear mi calendario"}
    </button>
    ${state.profile.planStarted ? `<button class="secondary-action" type="button" data-reset-progress>Reiniciar progreso</button>` : ""}
  `;
}

function renderProgress() {
  const total = plan.sessions.length;
  const completed = plan.completedCount;
  const current = currentSession();
  const percent = total ? Math.round((completed / total) * 100) : 0;
  els.calendarSummary.textContent = `${state.profile.name}, selecciona una rutina para ver su preview antes de comenzar.`;
  els.progressBand.innerHTML = `
    <div class="progress-item"><span>Completadas</span><strong>${completed}</strong></div>
    <div class="progress-item"><span>Restantes</span><strong>${Math.max(total - completed, 0)}</strong></div>
    <div class="progress-meter">
      <span class="section-label">Progreso total - ${percent}%</span>
      <div class="meter-track"><div class="meter-fill" style="width:${percent}%"></div></div>
    </div>
    <div class="progress-item"><span>Siguiente</span><strong>${escapeHtml(current?.workout?.title?.replace(" (RODILLA)", "") || "Lista")}</strong></div>
  `;
}

function renderWeekRail() {
  els.weekRail.innerHTML = plan.weeks.map((week) => {
    const completed = week.sessions.filter((session) => state.progress[session.id]?.completed).length;
    return `
      <article class="calendar-week ${week.index === state.selectedWeek ? "is-active" : ""}">
        <button class="week-button" type="button" data-week="${week.index}">
          <span>${escapeHtml(week.range)}</span>
          <strong>${escapeHtml(week.title)}</strong>
          <span>${completed}/${week.sessions.length} sesiones completas</span>
        </button>
        <div class="calendar-sessions">
          ${week.sessions.map((session) => calendarSessionButton(session)).join("")}
        </div>
      </article>
    `;
  }).join("");
}

function calendarSessionButton(session) {
  const progress = state.progress[session.id] || {};
  return `
    <button class="calendar-session ${session.id === state.selectedSessionId ? "is-current" : ""} ${progress.completed ? "is-complete" : ""}" type="button" data-preview-session="${escapeHtml(session.id)}">
      <span>${escapeHtml(formatDate(session.scheduledDate))}</span>
      <strong>${escapeHtml(session.workout.title.replace(" (RODILLA)", ""))}</strong>
      <em>${progress.completed ? "Completa" : "Comenzar"}</em>
    </button>
  `;
}

function renderBlockFilters() {
  const sourceExercises = getFilterSourceExercises();
  const blocks = Array.from(new Set(sourceExercises.map((exercise) => exercise.block).filter(Boolean)));
  els.blockFilters.innerHTML = [
    `<button class="chip ${state.block === "all" ? "is-active" : ""}" type="button" data-block="all">Todos</button>`,
    ...blocks.map((block) => `<button class="chip ${state.block === block ? "is-active" : ""}" type="button" data-block="${escapeHtml(block)}">${escapeHtml(block)}</button>`),
  ].join("");
}

function getFilterSourceExercises() {
  if (state.view === "library") return uniqueExercises;
  if (state.view === "videos") return uniqueVideos;
  const session = currentSession();
  return session?.workout?.exercises?.map((exercise) => ({ ...exercise, workout: session.workout })) || [];
}

function stagesForSession(session) {
  const workout = session.workout;
  const blocks = workout.blocks?.length
    ? workout.blocks
    : Array.from(new Set((workout.exercises || []).map((exercise) => exercise.block).filter(Boolean))).map((name) => ({ name, description: "" }));

  return blocks.map((block, index) => {
    const exercises = (workout.exercises || [])
      .filter((exercise) => exercise.block === block.name)
      .map((exercise) => ({ ...exercise, workout }));
    return {
      rawName: block.name || `Etapa ${index + 1}`,
      name: stageName(block.name || `Etapa ${index + 1}`, index),
      description: stageDescription(block.name || "", block.description || ""),
      exercises,
    };
  }).filter((stage) => stage.exercises.length);
}

function stageName(name, index) {
  const text = normalize(name);
  if (/movilidad|mobility|warm/.test(text)) return "Movilidad";
  if (/prep|activation|activacion|prepar/.test(text)) return "Preparacion";
  if (/jump|bound|saltar|lanzar|throw|power|potencia/.test(text)) return "Saltar y lanzar";
  if (/lift|principal|strength|fuerza/.test(text)) return "Lift principal";
  if (/accessory|accesorio|core|finisher|esd|conditioning/.test(text)) return "Accesorios";
  return `Etapa ${index + 1}`;
}

function stageDescription(name, fallback) {
  const text = normalize(`${name} ${fallback}`);
  if (/movilidad|mobility/.test(text)) return "Abre rango de movimiento y prepara cadera, tobillo, columna y hombro antes de cargar.";
  if (/prep|activation|activacion|prepar/.test(text)) return "Activa patrones clave para llegar al bloque fuerte con control y buena postura.";
  if (/jump|bound|saltar|lanzar|throw|power|potencia/.test(text)) return "Convierte fuerza en reactividad: saltos, aterrizajes y lanzamientos con intencion.";
  if (/lift|principal|strength|fuerza/.test(text)) return "Bloque principal de fuerza. Prioriza tecnica, descanso y repeticiones solidas.";
  if (/accessory|accesorio|core|finisher|esd|conditioning/.test(text)) return "Trabajo complementario para core, resistencia especifica y tolerancia a puntos largos.";
  return fallback || "Avanza con control, respira bien y conserva tecnica limpia.";
}

function renderPlanView() {
  const week = currentWeek();
  const session = currentSession();
  if (!week || !session) {
    els.contentArea.innerHTML = renderEmpty("No hay sesiones disponibles", "El archivo no contiene rutinas FB suficientes para construir un plan.");
    return;
  }

  els.contentArea.innerHTML = `
    <section class="plan-list" aria-label="Sesiones de la semana">
      ${week.sessions.map(planCard).join("")}
    </section>
    ${state.sessionMode === "workout" ? renderGuidedSession(session) : renderSessionPreview(session)}
    ${week.accessories.length ? renderAccessories(week.accessories) : ""}
  `;

  bindDynamicControls();
}

function planCard(session) {
  const progress = state.progress[session.id] || {};
  return `
    <article class="plan-card ${session.id === state.selectedSessionId ? "is-selected" : ""} ${progress.completed ? "is-complete" : ""}">
      <span>${escapeHtml(formatDate(session.scheduledDate))} - Sesion ${session.number}</span>
      <h3>${escapeHtml(session.workout.title)}</h3>
      <p class="card-meta">${escapeHtml(session.phase.name)} - ${session.workout.exercises.length} ejercicios</p>
      <button class="secondary-action" type="button" data-session="${escapeHtml(session.id)}">Comenzar</button>
    </article>
  `;
}

function renderSessionPreview(session) {
  const workout = session.workout;
  const insights = routineInsight(workout, session);
  const stages = stagesForSession(session);
  const progress = state.progress[session.id] || {};
  return `
    <article class="session-panel session-preview">
      <header class="session-header">
        <div>
          <span class="section-label">Preview de rutina - ${escapeHtml(formatLongDate(session.scheduledDate))}</span>
          <h2>${escapeHtml(workout.title)}</h2>
          <div class="session-meta">
            <span>${escapeHtml(session.phase.name)}</span>
            <span>${workout.exercises.length} ejercicios</span>
            <span>${stages.length} etapas</span>
            <span>${progress.completed ? "Completada" : "Pendiente"}</span>
          </div>
        </div>
        <div class="session-actions">
          <button class="primary-action" type="button" data-start-session="${escapeHtml(session.id)}">Comenzar rutina</button>
        </div>
      </header>

      <section class="routine-education" aria-label="Informacion didactica de la rutina">
        ${insights.map((item) => `
          <div class="insight-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `).join("")}
      </section>

      <p class="routine-note">${escapeHtml(workout.description || session.phase.intent)}</p>

      <section class="stage-preview-list" aria-label="Etapas de la rutina">
        ${stages.map((stage, index) => `
          <button class="stage-preview ${index === 0 ? "is-current" : ""}" type="button" data-stage-preview="${index}">
            <span>Etapa ${index + 1}</span>
            <strong>${escapeHtml(stage.name)}</strong>
            <em>${stage.exercises.length} ejercicios</em>
          </button>
        `).join("")}
      </section>
    </article>
  `;
}

function renderGuidedSession(session) {
  const workout = session.workout;
  const stages = stagesForSession(session);
  const progress = state.progress[session.id] || {};
  const savedIndex = Number.isInteger(progress.stageIndex) ? progress.stageIndex : state.activeStageIndex || 0;
  const activeIndex = Math.min(savedIndex, Math.max(stages.length - 1, 0));
  const stage = stages[activeIndex] || stages[0];
  const percent = stages.length ? Math.round(((activeIndex + 1) / stages.length) * 100) : 0;

  return `
    <article class="session-panel guided-session">
      <header class="session-header">
        <div>
          <span class="section-label">Rutina guiada - Etapa ${activeIndex + 1} de ${stages.length}</span>
          <h2>${escapeHtml(workout.title)}</h2>
          <div class="session-meta">
            <span>${escapeHtml(stage?.name || "Etapa")}</span>
            <span>${stage?.exercises.length || 0} ejercicios</span>
            <span>${percent}% de la rutina</span>
          </div>
        </div>
        <div class="session-actions">
          <button class="secondary-action" type="button" data-back-preview="${escapeHtml(session.id)}">Ver preview</button>
          <button class="complete-button ${progress.completed ? "is-complete" : ""}" type="button" data-complete="${escapeHtml(session.id)}">
            ${progress.completed ? "Completada" : "Finalizar rutina"}
          </button>
        </div>
      </header>

      <section class="stage-tracker" aria-label="Progreso por etapas">
        <div class="meter-track"><div class="meter-fill" style="width:${percent}%"></div></div>
        <div class="stage-steps">
          ${stages.map((item, index) => `
            <button class="stage-step ${index === activeIndex ? "is-current" : ""} ${index < activeIndex || progress.completed ? "is-done" : ""}" type="button" data-jump-stage="${index}">
              <span>${index + 1}</span>
              <strong>${escapeHtml(item.name)}</strong>
            </button>
          `).join("")}
        </div>
      </section>

      <section class="routine-note stage-focus">
        <span class="section-label">Foco de esta etapa</span>
        <p>${escapeHtml(stage?.description || "Manten tecnica limpia y avanza sin dolor.")}</p>
      </section>

      ${renderSessionNotes(session, progress)}

      <section class="exercise-section">
        <div class="section-title">
          <span>${escapeHtml(stage?.name || "Etapa")}</span>
          <i></i>
        </div>
        <div class="exercise-grid">
          ${(stage?.exercises || []).map(exerciseCard).join("")}
        </div>
      </section>

      <footer class="stage-controls">
        <button class="secondary-action" type="button" data-prev-stage="${escapeHtml(session.id)}" ${activeIndex === 0 ? "disabled" : ""}>Etapa anterior</button>
        <button class="primary-action" type="button" data-next-stage="${escapeHtml(session.id)}">
          ${activeIndex >= stages.length - 1 ? "Finalizar rutina" : "Siguiente etapa"}
        </button>
      </footer>
    </article>
  `;
}

function renderAccessories(accessories) {
  return `
    <section class="session-panel">
      <header class="session-header">
        <div>
          <span class="section-label">Complementos recomendados</span>
          <h2>Movilidad, recovery o tests para esta semana</h2>
          <div class="session-meta">
            ${accessories.map((workout) => `<span>${escapeHtml(workout.title)}</span>`).join("")}
          </div>
        </div>
      </header>
    </section>
  `;
}

function renderSession(session) {
  const workout = session.workout;
  const visibleExercises = applyFilters((workout.exercises || []).map((exercise) => ({ ...exercise, workout })));
  const progress = state.progress[session.id] || {};
  const insights = routineInsight(workout, session);

  return `
    <article class="session-panel">
      <header class="session-header">
        <div>
          <span class="section-label">${escapeHtml(formatLongDate(session.scheduledDate))} - Sesion ${session.number}</span>
          <h2>${escapeHtml(workout.title)}</h2>
          <div class="session-meta">
            <span>${escapeHtml(session.phase.name)}</span>
            <span>${workout.exercises.length} ejercicios</span>
            <span>${workout.exercises.filter((exercise) => exercise.video_url).length} videos</span>
            <span>${escapeHtml(session.phase.load)} carga</span>
          </div>
        </div>
        <div class="session-actions">
          <button class="complete-button ${progress.completed ? "is-complete" : ""}" type="button" data-complete="${escapeHtml(session.id)}">
            ${progress.completed ? "Completada" : "Marcar completa"}
          </button>
        </div>
      </header>

      <section class="routine-education" aria-label="Informacion didactica de la rutina">
        ${insights.map((item) => `
          <div class="insight-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `).join("")}
      </section>

      <p class="routine-note">${escapeHtml(workout.description || session.phase.intent)}</p>

      ${renderSessionNotes(session, progress)}

      ${visibleExercises.length ? renderWorkoutBlocks(workout, visibleExercises) : renderEmpty("Sin ejercicios visibles", "Cambia el filtro o la busqueda para volver a ver la sesion.")}
    </article>
  `;
}

function renderSessionNotes(session, progress) {
  return `
    <section class="session-notes" aria-label="Notas personales de sesion">
      <div>
        <div class="prescription-row">
          <label>
            <span class="field-label">RPE</span>
            <input class="date-input" id="rpeInput" type="number" min="1" max="10" placeholder="1-10" value="${escapeHtml(progress.rpe || "")}">
          </label>
          <label>
            <span class="field-label">Duracion</span>
            <input class="date-input" id="durationInput" type="text" placeholder="60 min" value="${escapeHtml(progress.duration || "")}">
          </label>
        </div>
        <label>
          <span class="field-label">Nota</span>
          <textarea class="note-input" id="noteInput" placeholder="Carga usada, molestias, sensaciones o ajustes">${escapeHtml(progress.note || "")}</textarea>
        </label>
      </div>
      <button class="secondary-action" type="button" data-save-note="${escapeHtml(session.id)}">Guardar nota</button>
    </section>
  `;
}

function renderWorkoutBlocks(workout, visibleExercises) {
  const visibleSet = new Set(visibleExercises.map((exercise) => String(exercise.order)));
  const blocks = workout.blocks?.length
    ? workout.blocks
    : Array.from(new Set((workout.exercises || []).map((exercise) => exercise.block).filter(Boolean))).map((name) => ({ name, description: "" }));

  return blocks.map((block) => {
    const exercises = (workout.exercises || [])
      .filter((exercise) => exercise.block === block.name && visibleSet.has(String(exercise.order)))
      .map((exercise) => ({ ...exercise, workout }));
    if (!exercises.length) return "";
    return `
      <section class="exercise-section">
        <div class="section-title">
          <span>${escapeHtml(block.name || "Sin bloque")}</span>
          <i></i>
        </div>
        ${block.description ? `<p class="block-description">${escapeHtml(block.description)}</p>` : ""}
        <div class="exercise-grid">
          ${exercises.map(exerciseCard).join("")}
        </div>
      </section>
    `;
  }).join("");
}

function exerciseCard(exercise) {
  const thumbnail = exercise.youtube_thumbnail_url || "";
  const instructions = clean(exercise.instructions);
  const notes = exercise.notes?.filter(Boolean) || [];
  const insight = exerciseInsight(exercise);
  return `
    <article class="exercise-card">
      ${thumbnail ? `
        <a class="thumb-link" href="${escapeHtml(exercise.video_url || "#")}" target="_blank" rel="noreferrer">
          <img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(exercise.name)}" loading="lazy">
          <span class="play-badge">${iconPlay} Video</span>
        </a>
      ` : `<div class="thumb-link no-thumb"><span>Sin video</span></div>`}
      <div class="exercise-body">
        <div class="exercise-kicker">
          <span>${escapeHtml(exercise.block || "Sin bloque")}</span>
          <span>#${escapeHtml(exercise.order)}</span>
        </div>
        <h4>${escapeHtml(exercise.name)}</h4>
        <div class="prescription-row">
          <div class="mini-metric">
            <span>Prescripcion</span>
            <strong>${escapeHtml(exercise.prescription || "sin dato")}</strong>
          </div>
          <div class="mini-metric">
            <span>Descanso</span>
            <strong>${escapeHtml(exercise.rest || "sin dato")}</strong>
          </div>
        </div>
        <div class="exercise-insights">
          <div class="insight-line"><span>Mejora</span><strong>${escapeHtml(insight.improves)}</strong></div>
          <div class="insight-line"><span>Padel</span><strong>${escapeHtml(insight.transfer)}</strong></div>
          <div class="insight-line"><span>Foco</span><strong>${escapeHtml(insight.cue)}</strong></div>
          <div class="insight-line"><span>Equipo</span><strong>${escapeHtml(insight.equipment)} - ${escapeHtml(insight.intensity)}</strong></div>
          <div class="insight-line"><span>Alterna</span><strong>${escapeHtml(insight.alternative)}</strong></div>
        </div>
        ${notes.length ? `<p class="note-line">${escapeHtml(notes.join(" - "))}</p>` : ""}
        <details>
          <summary>Instrucciones originales</summary>
          <div class="instructions">${instructions ? escapeHtml(instructions) : "Sin instrucciones adicionales en el archivo original."}</div>
        </details>
        <div class="card-actions">
          ${exercise.video_url ? `<a class="external-link" href="${escapeHtml(exercise.video_url)}" target="_blank" rel="noreferrer">${iconExternal} Video</a>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderLibraryView() {
  const exercises = applyFilters(uniqueExercises);
  els.contentArea.innerHTML = `
    <section class="session-panel">
      <header class="session-header">
        <div>
          <span class="section-label">Biblioteca didactica</span>
          <h2>Ejercicios unicos con transferencia a padel</h2>
          <div class="session-meta">
            <span>${exercises.length} visibles</span>
            <span>${uniqueExercises.length} ejercicios unicos</span>
          </div>
        </div>
      </header>
      <div class="exercise-section">
        ${exercises.length ? `<div class="library-grid">${exercises.map((exercise) => exerciseCard({ ...exercise, order: exercise.order || "lib" })).join("")}</div>` : renderEmpty("Sin resultados", "No hay ejercicios que coincidan con la busqueda.")}
      </div>
    </section>
  `;
}

function renderVideosView() {
  const filtered = applyFilters(uniqueVideos);
  els.contentArea.innerHTML = `
    <section class="session-panel">
      <header class="session-header">
        <div>
          <span class="section-label">Biblioteca audiovisual</span>
          <h2>Videos unicos de ejercicios</h2>
          <div class="session-meta">
            <span>${filtered.length} visibles</span>
            <span>${uniqueVideos.length} videos unicos</span>
          </div>
        </div>
      </header>
      <div class="exercise-section">
        ${filtered.length ? `<div class="video-grid">${filtered.map(videoCard).join("")}</div>` : renderEmpty("Sin videos", "Cambia los filtros para ver mas videos.")}
      </div>
    </section>
  `;
}

function videoCard(exercise) {
  const insight = exerciseInsight(exercise);
  return `
    <article class="video-card">
      <a class="thumb-link" href="${escapeHtml(exercise.video_url)}" target="_blank" rel="noreferrer">
        <img src="${escapeHtml(exercise.youtube_thumbnail_url)}" alt="${escapeHtml(exercise.name)}" loading="lazy">
        <span class="play-badge">${iconPlay} YouTube</span>
      </a>
      <div class="exercise-body">
        <div class="exercise-kicker">
          <span>${escapeHtml(exercise.block || "Sin bloque")}</span>
          <span>${escapeHtml(insight.intensity)}</span>
        </div>
        <h4>${escapeHtml(exercise.name)}</h4>
        <p class="card-meta">${escapeHtml(insight.transfer)}</p>
        <div class="card-actions">
          <a class="external-link" href="${escapeHtml(exercise.video_url)}" target="_blank" rel="noreferrer">${iconExternal} Abrir video</a>
        </div>
      </div>
    </article>
  `;
}

function renderArchiveView() {
  const events = (data.events || []).filter((event) => {
    if (!state.query) return true;
    return normalize(`${event.date} ${event.title} ${event.type} ${event.source_type}`).includes(normalize(state.query));
  });

  els.contentArea.innerHTML = `
    <section class="session-panel">
      <header class="session-header">
        <div>
          <span class="section-label">Archivo original</span>
          <h2>Fechas historicas y datos del programa</h2>
          <p class="archive-summary">La experiencia principal usa una progresion nueva; esta vista conserva el contexto original del scrape.</p>
          <div class="session-meta">
            <span>${events.length} eventos visibles</span>
            <span>${data.stats?.earliest_event?.slice(0, 10) || "sin fecha"} a ${data.stats?.latest_event?.slice(0, 10) || "sin fecha"}</span>
          </div>
        </div>
      </header>
      <div class="exercise-section">
        <div class="archive-list">
          ${events.map((event) => `
            <div class="archive-row">
              <span>${escapeHtml(event.date)}</span>
              <span>${escapeHtml(event.type)}</span>
              <strong>${escapeHtml(event.title)}</strong>
            </div>
          `).join("")}
        </div>
      </div>
    </section>
    <section class="text-panel">
      <span class="section-label">Export</span>
      <h2>Archivos tecnicos</h2>
      <div class="source-actions">
        <a class="external-link" href="./rutinas-limpias.md">${iconExternal} Markdown limpio</a>
        <a class="external-link" href="./rutinas-completas.json">${iconExternal} JSON completo</a>
      </div>
    </section>
  `;
}

function renderSupportView() {
  const user = state.firebase.user;
  const configured = state.firebase.configured;
  const selected = currentSession();
  const statusMessage = state.support.status || state.firebase.error || "";

  els.contentArea.innerHTML = `
    <section class="session-panel support-panel">
      <header class="session-header">
        <div>
          <span class="section-label">Soporte</span>
          <h2>Seguimiento para jugadores</h2>
          <div class="session-meta">
            <span>${configured ? "Firebase activo" : "Modo local"}</span>
            <span>${user ? "Cuenta conectada" : "Sin cuenta"}</span>
          </div>
        </div>
        <div class="session-actions">
          ${configured && !user ? `<button class="primary-action" type="button" data-auth-sign-in>Iniciar con Google</button>` : ""}
        </div>
      </header>

      <div class="support-grid">
        <article class="support-card">
          <span class="section-label">Cuenta</span>
          <strong>${user ? escapeHtml(user.displayName || user.email || "Cuenta conectada") : "Progreso local"}</strong>
          <p>${user ? "Tu plan, notas y rutinas completadas se sincronizan con tu cuenta." : "Puedes usar la app sin cuenta; inicia sesion para guardar progreso y enviar soporte."}</p>
        </article>

        <article class="support-card">
          <span class="section-label">Estado</span>
          <strong>${escapeHtml(state.firebase.message || "Listo")}</strong>
          <p>${configured ? "El progreso se guarda por usuario bajo tu sesion de Google." : "Firebase se activa automaticamente en el despliegue configurado."}</p>
        </article>
      </div>

      <form class="support-form" data-support-form>
        <div>
          <label>
            <span class="field-label">Tema</span>
            <select class="date-input" name="topic" ${!configured || !user ? "disabled" : ""}>
              <option value="rutina">Rutina o ejercicio</option>
              <option value="dolor">Molestia o dolor</option>
              <option value="progreso">Progreso o calendario</option>
              <option value="cuenta">Cuenta o sincronizacion</option>
              <option value="otro">Otro</option>
            </select>
          </label>

          <label>
            <span class="field-label">Rutina relacionada</span>
            <select class="date-input" name="sessionId" ${!configured || !user ? "disabled" : ""}>
              <option value="">General</option>
              ${plan.sessions.map((session) => `
                <option value="${escapeHtml(session.id)}" ${selected?.id === session.id ? "selected" : ""}>
                  Sesion ${session.number} - ${escapeHtml(session.workout.title)}
                </option>
              `).join("")}
            </select>
          </label>
        </div>

        <label>
          <span class="field-label">Mensaje</span>
          <textarea class="note-input" name="message" placeholder="Describe que paso, en que ejercicio, sensaciones y que necesitas revisar." ${!configured || !user ? "disabled" : ""}>${escapeHtml(state.support.message || "")}</textarea>
        </label>

        <div class="support-actions">
          <button class="primary-action" type="submit" ${!configured || !user || state.support.sending ? "disabled" : ""}>
            ${state.support.sending ? "Enviando" : "Enviar soporte"}
          </button>
          ${statusMessage ? `<p class="sync-message">${escapeHtml(statusMessage)}</p>` : ""}
        </div>
      </form>
    </section>
  `;
}

function renderEmpty(title = "Sin resultados", message = "No hay elementos que coincidan con la busqueda y el filtro seleccionado.") {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderContent() {
  if (!isPlanReady()) {
    els.contentArea.innerHTML = "";
    return;
  }
  if (state.view === "library") renderLibraryView();
  else if (state.view === "videos") renderVideosView();
  else if (state.view === "support") renderSupportView();
  else if (state.view === "archive") renderArchiveView();
  else renderPlanView();
}

function syncTabs() {
  els.viewTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
}

function rebuildPlan() {
  writeStorage(CONFIG_KEY, state.config);
  plan = buildPlan();
  ensureSelection();
  render();
}

function isPlanReady() {
  return Boolean(state.profile.name && state.profile.planStarted);
}

function syncAppVisibility() {
  const ready = isPlanReady();
  const introOnly = !state.profile.name && !state.profile.introStarted;
  document.body.classList.toggle("is-intro-only", introOnly);
  if (els.appStepPanel) els.appStepPanel.hidden = introOnly;
  [els.dashboardBoard, els.controlDock, els.filterBand, els.contentArea, els.sourceStrip].forEach((element) => {
    if (element) element.hidden = !ready;
  });
}

function render() {
  ensureSelection();
  renderStats();
  renderAccountPanel();
  renderPlanner();
  syncAppVisibility();
  if (!isPlanReady()) return;
  renderProgress();
  renderWeekRail();
  renderBlockFilters();
  syncTabs();
  renderContent();
}

function bindDynamicControls() {
  els.contentArea.querySelectorAll("[data-session]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSessionId = button.dataset.session;
      state.view = "plan";
      state.sessionMode = "preview";
      state.activeStageIndex = 0;
      render();
      document.querySelector("#sesion").scrollIntoView({ block: "start" });
    });
  });

  els.contentArea.querySelectorAll("[data-start-session]").forEach((button) => {
    button.addEventListener("click", () => {
      const sessionId = button.dataset.startSession;
      state.selectedSessionId = sessionId;
      state.view = "plan";
      state.sessionMode = "workout";
      state.activeStageIndex = state.progress[sessionId]?.stageIndex || 0;
      render();
      document.querySelector("#sesion").scrollIntoView({ block: "start" });
    });
  });

  els.contentArea.querySelectorAll("[data-back-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSessionId = button.dataset.backPreview;
      state.sessionMode = "preview";
      render();
    });
  });

  els.contentArea.querySelectorAll("[data-stage-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeStageIndex = Number(button.dataset.stagePreview) || 0;
      state.sessionMode = "workout";
      render();
      document.querySelector("#sesion").scrollIntoView({ block: "start" });
    });
  });

  els.contentArea.querySelectorAll("[data-jump-stage]").forEach((button) => {
    button.addEventListener("click", () => {
      const session = currentSession();
      if (!session) return;
      const index = Number(button.dataset.jumpStage) || 0;
      state.activeStageIndex = index;
      state.progress[session.id] = {
        ...(state.progress[session.id] || {}),
        stageIndex: index,
      };
      writeStorage(PROGRESS_KEY, state.progress);
      render();
    });
  });

  els.contentArea.querySelectorAll("[data-prev-stage]").forEach((button) => {
    button.addEventListener("click", () => moveStage(button.dataset.prevStage, -1));
  });

  els.contentArea.querySelectorAll("[data-next-stage]").forEach((button) => {
    button.addEventListener("click", () => moveStage(button.dataset.nextStage, 1));
  });

  els.contentArea.querySelectorAll("[data-complete]").forEach((button) => {
    button.addEventListener("click", () => {
      const sessionId = button.dataset.complete;
      const current = state.progress[sessionId] || {};
      state.progress[sessionId] = {
        ...current,
        completed: !current.completed,
        completedAt: !current.completed ? new Date().toISOString() : "",
      };
      writeStorage(PROGRESS_KEY, state.progress);
      plan = buildPlan();
      render();
    });
  });

  els.contentArea.querySelectorAll("[data-save-note]").forEach((button) => {
    button.addEventListener("click", () => {
      const sessionId = button.dataset.saveNote;
      const current = state.progress[sessionId] || {};
      state.progress[sessionId] = {
        ...current,
        rpe: document.querySelector("#rpeInput")?.value || "",
        duration: document.querySelector("#durationInput")?.value || "",
        note: document.querySelector("#noteInput")?.value || "",
      };
      writeStorage(PROGRESS_KEY, state.progress);
      render();
    });
  });
}

function moveStage(sessionId, direction) {
  const session = plan.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  const stages = stagesForSession(session);
  const current = state.progress[sessionId] || {};
  const currentIndex = Number.isInteger(current.stageIndex) ? current.stageIndex : state.activeStageIndex;
  const nextIndex = currentIndex + direction;

  if (nextIndex >= stages.length) {
    state.progress[sessionId] = {
      ...current,
      completed: true,
      completedAt: new Date().toISOString(),
      stageIndex: Math.max(stages.length - 1, 0),
    };
  } else {
    state.progress[sessionId] = {
      ...current,
      stageIndex: Math.max(nextIndex, 0),
    };
  }

  state.activeStageIndex = state.progress[sessionId].stageIndex || 0;
  writeStorage(PROGRESS_KEY, state.progress);
  plan = buildPlan();
  render();
}

function handleFirebaseStatus(event) {
  const status = event.detail?.status || {};
  state.firebase.configured = Boolean(status.configured);
  state.firebase.ready = Boolean(status.ready);
  state.firebase.message = status.message || state.firebase.message;
  state.firebase.error = status.error || "";
  renderAccountPanel();
  if (state.view === "support") renderContent();
}

function handleFirebaseAuth(event) {
  state.firebase.user = event.detail?.user || null;
  state.firebase.configured = Boolean(event.detail?.status?.configured ?? state.firebase.configured);
  state.firebase.ready = true;
  state.firebase.cloudReady = false;
  state.firebase.status = state.firebase.user ? "loading" : "local";
  state.firebase.message = state.firebase.user ? "Cargando progreso" : "Progreso local";
  renderAccountPanel();
  if (state.view === "support") renderContent();
}

function handleFirebaseCloudState(event) {
  if (!state.firebase.user) return;
  const exists = Boolean(event.detail?.exists);
  const cloudState = event.detail?.data || null;
  state.firebase.cloudReady = true;

  if (!exists) {
    state.firebase.message = "Preparando sincronizacion";
    queueCloudSave(true);
    return;
  }

  const cloudUpdatedAt = cloudState.updatedAt || cloudState.localUpdatedAt || "";
  const localUpdatedAt = state.syncMeta.updatedAt || "";
  if (!localExperienceExists() || (cloudUpdatedAt && (!localUpdatedAt || cloudUpdatedAt > localUpdatedAt))) {
    state.firebase.message = "Sincronizado";
    state.firebase.status = "synced";
    applyCloudState(cloudState);
    return;
  }

  if (localUpdatedAt && (!cloudUpdatedAt || localUpdatedAt > cloudUpdatedAt)) {
    queueCloudSave(true);
    return;
  }

  state.firebase.status = "synced";
  state.firebase.message = "Sincronizado";
  renderAccountPanel();
}

function handleFirebaseError(event) {
  state.firebase.status = "error";
  state.firebase.message = "Firebase requiere atencion";
  state.firebase.error = event.detail?.message || "No se pudo completar la operacion.";
  renderAccountPanel();
  if (state.view === "support") renderContent();
}

async function signInWithFirebase() {
  try {
    state.firebase.message = "Abriendo Google";
    renderAccountPanel();
    await window.CuatroFirebase?.signIn();
  } catch (error) {
    state.firebase.error = error.message || "No se pudo iniciar sesion.";
    state.firebase.message = "No se pudo iniciar sesion";
    renderAccountPanel();
  }
}

async function signOutFromFirebase() {
  try {
    await window.CuatroFirebase?.signOut();
  } catch (error) {
    state.firebase.error = error.message || "No se pudo cerrar sesion.";
    renderAccountPanel();
  }
}

async function submitSupportRequest(form) {
  const message = clean(new FormData(form).get("message"));
  if (!message) return;

  const formData = new FormData(form);
  const sessionId = clean(formData.get("sessionId"));
  const session = plan.sessions.find((item) => item.id === sessionId);
  state.support.sending = true;
  state.support.status = "";
  state.support.message = message;
  renderSupportView();

  try {
    const ticketId = await window.CuatroFirebase.createSupportTicket({
      topic: clean(formData.get("topic")) || "rutina",
      message,
      sessionId,
      sessionTitle: session?.workout?.title || "",
      sessionNumber: session?.number || "",
      selectedWeek: state.selectedWeek,
      profile: state.profile,
      config: state.config,
      progressSummary: {
        completed: plan.completedCount,
        total: plan.sessions.length,
      },
      page: window.location.href,
      userAgent: navigator.userAgent,
    });
    state.support.status = `Solicitud enviada: ${ticketId}`;
    state.support.message = "";
  } catch (error) {
    state.support.status = error.message || "No se pudo enviar la solicitud.";
  }

  state.support.sending = false;
  renderSupportView();
}

els.appStepPanel.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-name-form]");
  if (!form) return;
  event.preventDefault();
  const name = clean(new FormData(form).get("athleteName"));
  if (!name) return;
  state.profile.name = name;
  state.profile.introStarted = true;
  state.profile.planStarted = false;
  writeStorage(PROFILE_KEY, state.profile);
  render();
});

els.appStepPanel.addEventListener("change", (event) => {
  if (event.target.matches("#startDateInput")) {
    state.config.startDate = event.target.value || defaultConfig.startDate;
    state.selectedWeek = 0;
    state.selectedSessionId = "";
    state.sessionMode = "preview";
    rebuildPlan();
  }
});

els.appStepPanel.addEventListener("click", (event) => {
  const nameButton = event.target.closest("[data-edit-name]");
  if (nameButton) {
    state.profile.name = "";
    state.profile.planStarted = false;
    state.profile.introStarted = true;
    writeStorage(PROFILE_KEY, state.profile);
    render();
    return;
  }

  const frequencyButton = event.target.closest("button[data-frequency]");
  if (frequencyButton) {
    state.config.frequency = Number(frequencyButton.dataset.frequency);
    state.selectedWeek = 0;
    state.selectedSessionId = "";
    state.sessionMode = "preview";
    rebuildPlan();
    return;
  }

  const goalButton = event.target.closest("button[data-goal]");
  if (goalButton) {
    state.config.goal = goalButton.dataset.goal;
    rebuildPlan();
    return;
  }

  const startButton = event.target.closest("[data-start-plan]");
  if (startButton) {
    state.profile.planStarted = true;
    state.profile.introStarted = true;
    writeStorage(PROFILE_KEY, state.profile);
    rebuildPlan();
    document.querySelector("#dashboard").scrollIntoView({ block: "start" });
    return;
  }

  const resetButton = event.target.closest("[data-reset-progress]");
  if (resetButton) {
    if (!confirm("Reiniciar progreso local de Cuatro Padel Performance?")) return;
    state.progress = {};
    writeStorage(PROGRESS_KEY, state.progress);
    plan = buildPlan();
    render();
  }
});

els.weekRail.addEventListener("click", (event) => {
  const sessionButton = event.target.closest("[data-preview-session]");
  if (sessionButton) {
    const session = plan.sessions.find((item) => item.id === sessionButton.dataset.previewSession);
    if (!session) return;
    state.selectedWeek = session.weekIndex;
    state.selectedSessionId = session.id;
    state.view = "plan";
    state.sessionMode = "preview";
    state.activeStageIndex = state.progress[session.id]?.stageIndex || 0;
    render();
    document.querySelector("#sesion").scrollIntoView({ block: "start" });
    return;
  }

  const button = event.target.closest("button[data-week]");
  if (!button) return;
  state.selectedWeek = Number(button.dataset.week);
  state.selectedSessionId = "";
  state.view = "plan";
  state.sessionMode = "preview";
  render();
  document.querySelector("#sesion").scrollIntoView({ block: "start" });
});

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderBlockFilters();
  renderContent();
});

els.blockFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-block]");
  if (!button) return;
  state.block = button.dataset.block;
  renderBlockFilters();
  renderContent();
});

els.viewTabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    state.block = "all";
    render();
  });
});

els.accountPanel.addEventListener("click", (event) => {
  if (event.target.closest("[data-auth-sign-in]")) {
    signInWithFirebase();
    return;
  }
  if (event.target.closest("[data-auth-sign-out]")) {
    signOutFromFirebase();
  }
});

els.contentArea.addEventListener("click", (event) => {
  if (event.target.closest("[data-auth-sign-in]")) {
    signInWithFirebase();
  }
});

els.contentArea.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-support-form]");
  if (!form) return;
  event.preventDefault();
  submitSupportRequest(form);
});

window.addEventListener("cuatro:firebase-status", handleFirebaseStatus);
window.addEventListener("cuatro:firebase-auth", handleFirebaseAuth);
window.addEventListener("cuatro:firebase-cloud-state", handleFirebaseCloudState);
window.addEventListener("cuatro:firebase-error", handleFirebaseError);

els.beginOnboardingButton.addEventListener("click", () => {
  if (!state.profile.name) {
    state.profile.introStarted = true;
    writeStorage(PROFILE_KEY, state.profile);
    render();
    document.querySelector("#appStepPanel").scrollIntoView({ block: "start" });
    return;
  }

  document.querySelector(isPlanReady() ? "#dashboard" : "#appStepPanel").scrollIntoView({ block: "start" });
});

els.printButton.addEventListener("click", () => window.print());

render();
