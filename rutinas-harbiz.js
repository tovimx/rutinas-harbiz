const data = window.HARBIZ_RUTINAS_DATA || { events: [], workouts: [], stats: {} };

const CONFIG_KEY = "cuatro-padel-performance.config.v1";
const PROGRESS_KEY = "cuatro-padel-performance.progress.v1";

const defaultConfig = {
  startDate: nextMondayValue(),
  frequency: 3,
  goal: "padel",
};

const state = {
  config: { ...defaultConfig, ...readStorage(CONFIG_KEY, {}) },
  progress: readStorage(PROGRESS_KEY, {}),
  view: "plan",
  selectedWeek: 0,
  selectedSessionId: "",
  query: "",
  block: "all",
};

const els = {
  statsPanel: document.querySelector("#statsPanel"),
  startDateInput: document.querySelector("#startDateInput"),
  frequencyControl: document.querySelector("#frequencyControl"),
  goalControl: document.querySelector("#goalControl"),
  planDurationLabel: document.querySelector("#planDurationLabel"),
  plannerSummary: document.querySelector("#plannerSummary"),
  progressBand: document.querySelector("#progressBand"),
  weekRail: document.querySelector("#weekRail"),
  searchInput: document.querySelector("#searchInput"),
  blockFilters: document.querySelector("#blockFilters"),
  contentArea: document.querySelector("#sesion"),
  printButton: document.querySelector("#printButton"),
  resetProgressButton: document.querySelector("#resetProgressButton"),
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
    <span><strong>${programWorkouts.length}</strong> sesiones</span>
    <span><strong>${plan.weeks.length}</strong> semanas</span>
    <span><strong>${uniqueExercises.length}</strong> ejercicios</span>
    <span><strong>${uniqueVideos.length}</strong> videos</span>
  `;
}

function renderPlanner() {
  const duration = plan.weeks.length;
  const goal = goalProfiles[state.config.goal] || goalProfiles.padel;
  els.startDateInput.value = state.config.startDate;
  els.planDurationLabel.textContent = `${duration} semanas`;
  els.frequencyControl.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.frequency) === Number(state.config.frequency));
  });
  els.goalControl.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.goal === state.config.goal);
  });
  els.plannerSummary.innerHTML = `
    <div class="summary-row"><span>Inicio</span><strong>${escapeHtml(formatLongDate(plan.start))}</strong></div>
    <div class="summary-row"><span>Frecuencia</span><strong>${state.config.frequency} sesiones/semana</strong></div>
    <div class="summary-row"><span>Enfoque</span><strong>${escapeHtml(goal.label)}</strong></div>
    <div class="summary-row"><span>Guia</span><strong>${escapeHtml(goal.cue)}</strong></div>
  `;
}

function renderProgress() {
  const total = plan.sessions.length;
  const completed = plan.completedCount;
  const current = currentSession();
  const percent = total ? Math.round((completed / total) * 100) : 0;
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
      <button class="week-button ${week.index === state.selectedWeek ? "is-active" : ""}" type="button" data-week="${week.index}">
        <span>${escapeHtml(week.range)}</span>
        <strong>${escapeHtml(week.title)}</strong>
        <span>${completed}/${week.sessions.length} sesiones completas</span>
      </button>
    `;
  }).join("");
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
    ${renderSession(session)}
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
      <button class="secondary-action" type="button" data-session="${escapeHtml(session.id)}">Abrir sesion</button>
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
          <summary>Instrucciones Harbiz</summary>
          <div class="instructions">${instructions ? escapeHtml(instructions) : "Sin instrucciones adicionales en el archivo original."}</div>
        </details>
        <div class="card-actions">
          ${exercise.video_url ? `<a class="external-link" href="${escapeHtml(exercise.video_url)}" target="_blank" rel="noreferrer">${iconExternal} Video</a>` : ""}
          ${exercise.internal_link ? `<a class="external-link" href="${escapeHtml(exercise.internal_link)}" target="_blank" rel="noreferrer">${iconExternal} Harbiz</a>` : ""}
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
          <h2>Fechas historicas y datos fuente</h2>
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
        <a class="external-link" href="./harbiz-rutinas-limpio.md">${iconExternal} Markdown limpio</a>
        <a class="external-link" href="./harbiz-rutinas-scrape.json">${iconExternal} JSON completo</a>
      </div>
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
  if (state.view === "library") renderLibraryView();
  else if (state.view === "videos") renderVideosView();
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

function render() {
  ensureSelection();
  renderStats();
  renderPlanner();
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
      render();
      document.querySelector("#sesion").scrollIntoView({ block: "start" });
    });
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

els.startDateInput.addEventListener("change", (event) => {
  state.config.startDate = event.target.value || defaultConfig.startDate;
  state.selectedWeek = 0;
  state.selectedSessionId = "";
  rebuildPlan();
});

els.frequencyControl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-frequency]");
  if (!button) return;
  state.config.frequency = Number(button.dataset.frequency);
  state.selectedWeek = 0;
  state.selectedSessionId = "";
  rebuildPlan();
});

els.goalControl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-goal]");
  if (!button) return;
  state.config.goal = button.dataset.goal;
  rebuildPlan();
});

els.weekRail.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-week]");
  if (!button) return;
  state.selectedWeek = Number(button.dataset.week);
  state.selectedSessionId = "";
  state.view = "plan";
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

els.resetProgressButton.addEventListener("click", () => {
  if (!confirm("Reiniciar progreso local de Cuatro Padel Performance?")) return;
  state.progress = {};
  writeStorage(PROGRESS_KEY, state.progress);
  plan = buildPlan();
  render();
});

els.printButton.addEventListener("click", () => window.print());

render();
