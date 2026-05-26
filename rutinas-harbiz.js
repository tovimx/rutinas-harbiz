const data = window.HARBIZ_RUTINAS_DATA || { events: [], workouts: [] };

const state = {
  selectedWeek: 0,
  selectedDay: "",
  query: "",
  block: "all",
  view: "week",
};

const els = {
  statsPanel: document.querySelector("#statsPanel"),
  weekHero: document.querySelector("#weekHero"),
  weekTabs: document.querySelector("#semanas"),
  dayTabs: document.querySelector("#dayTabs"),
  searchInput: document.querySelector("#searchInput"),
  blockFilters: document.querySelector("#blockFilters"),
  contentArea: document.querySelector("#rutina"),
  printButton: document.querySelector("#printButton"),
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

const monthMap = new Map([
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

const baseYear = Number(
  data.workouts.find((workout) => workout.scheduled_date)?.scheduled_date?.split("/")[2]
) || new Date().getFullYear();

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

function parseScheduledDate(value) {
  const parts = clean(value).split("/").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[2], parts[1] - 1, parts[0], 12);
}

function parseListingDate(value) {
  const normalized = normalize(value).replace(/[.,]/g, "");
  const parts = normalized.split(/\s+/);
  const day = Number(parts.find((part) => /^\d+$/.test(part)));
  const month = parts.map((part) => monthMap.get(part)).find((part) => Number.isInteger(part));
  if (!day || month === undefined) return null;
  return new Date(baseYear, month, day, 12);
}

function dateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function weekStart(date) {
  const start = new Date(date);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  start.setHours(12, 0, 0, 0);
  return start;
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function formatDay(date) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatShortDay(date) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(date);
}

function formatWeek(start) {
  const end = addDays(start, 6);
  const startText = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(start);
  const endText = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(end);
  return `${startText} - ${endText}`;
}

const workouts = data.workouts.map((workout, index) => {
  const date = parseScheduledDate(workout.scheduled_date) || parseListingDate(workout.listing_date);
  const enriched = {
    ...workout,
    index,
    date,
    dateKey: dateKey(date),
    weekKey: date ? dateKey(weekStart(date)) : "sin-fecha",
  };
  enriched.exercises = (workout.exercises || []).map((exercise) => ({
    ...exercise,
    workout: enriched,
    workoutIndex: index,
  }));
  return enriched;
});

const events = data.events.map((event, index) => {
  const date = parseListingDate(event.date);
  return {
    ...event,
    index,
    date,
    dateKey: dateKey(date),
    weekKey: date ? dateKey(weekStart(date)) : "sin-fecha",
  };
});

const allExercises = workouts.flatMap((workout) => workout.exercises);
const allBlocks = Array.from(new Set(allExercises.map((exercise) => exercise.block).filter(Boolean)));
const uniqueVideos = Array.from(
  new Map(
    allExercises
      .filter((exercise) => exercise.video_url)
      .map((exercise) => [exercise.video_url, exercise])
  ).values()
);

const weeks = buildWeeks();

function buildWeeks() {
  const map = new Map();

  workouts.forEach((workout) => {
    if (!map.has(workout.weekKey)) {
      const start = workout.date ? weekStart(workout.date) : null;
      map.set(workout.weekKey, { key: workout.weekKey, start, workouts: [], events: [] });
    }
    map.get(workout.weekKey).workouts.push(workout);
  });

  events.forEach((event) => {
    if (!map.has(event.weekKey)) {
      const start = event.date ? weekStart(event.date) : null;
      map.set(event.weekKey, { key: event.weekKey, start, workouts: [], events: [] });
    }
    map.get(event.weekKey).events.push(event);
  });

  return Array.from(map.values())
    .map((week) => {
      const dayMap = new Map();
      const ensureDay = (date, key) => {
        if (!dayMap.has(key)) dayMap.set(key, { key, date, workouts: [], events: [] });
        return dayMap.get(key);
      };

      week.workouts.forEach((workout) => ensureDay(workout.date, workout.dateKey).workouts.push(workout));
      week.events.forEach((event) => ensureDay(event.date, event.dateKey).events.push(event));

      const days = Array.from(dayMap.values()).sort((a, b) => a.date - b.date);
      const exercises = week.workouts.flatMap((workout) => workout.exercises);
      const videos = new Set(exercises.map((exercise) => exercise.video_url).filter(Boolean)).size;
      return {
        ...week,
        label: week.start ? `Semana ${formatWeek(week.start)}` : "Semana sin fecha",
        days,
        exercises,
        videos,
      };
    })
    .sort((a, b) => b.start - a.start);
}

function currentWeek() {
  return weeks[state.selectedWeek] || weeks[0];
}

function currentDay() {
  const week = currentWeek();
  return week?.days.find((day) => day.key === state.selectedDay) || week?.days[0];
}

function ensureSelectedDay() {
  const week = currentWeek();
  if (!week) return;
  const existing = week.days.some((day) => day.key === state.selectedDay);
  if (!existing) state.selectedDay = week.days.find((day) => day.workouts.length)?.key || week.days[0]?.key || "";
}

function matchesQuery(exercise, query) {
  if (!query) return true;
  const haystack = [
    exercise.name,
    exercise.block,
    exercise.prescription,
    exercise.rest,
    exercise.instructions,
    exercise.notes?.join(" "),
    exercise.workout?.title,
    exercise.workout?.listing_date,
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
    <span><strong>${weeks.length}</strong> semanas</span>
    <span><strong>${workouts.length}</strong> rutinas</span>
    <span><strong>${allExercises.length}</strong> ejercicios</span>
    <span><strong>${uniqueVideos.length}</strong> videos</span>
  `;
}

function renderHero() {
  const week = currentWeek();
  const day = currentDay();
  const images = week.exercises
    .filter((exercise) => exercise.youtube_thumbnail_url)
    .slice(0, 4);
  const blockNames = Array.from(new Set(week.exercises.map((exercise) => exercise.block).filter(Boolean)));
  const selectedTitle = day?.workouts.map((workout) => workout.title).join(" + ") || "Agenda sin rutina asignada";

  els.weekHero.innerHTML = `
    <div class="hero-copy">
      <p class="hero-label">Rutinas semanales extraidas de Harbiz</p>
      <h1>${escapeHtml(week.label)}</h1>
      <p class="hero-summary">
        ${escapeHtml(selectedTitle)}. ${week.workouts.length} rutinas, ${week.exercises.length} ejercicios y ${week.videos} videos listos para consultar por dia.
      </p>
      <div class="hero-actions">
        <a class="primary-action" href="#rutina">Ver rutina del dia</a>
        <button class="secondary-action" type="button" data-view-jump="videos">Abrir videos</button>
      </div>
      <div class="hero-meta">
        <span><strong>${week.days.length}</strong> dias con agenda</span>
        <span><strong>${week.workouts.length}</strong> sesiones</span>
        <span><strong>${blockNames.length}</strong> bloques</span>
      </div>
    </div>
    <div class="hero-media" aria-label="Videos destacados de la semana">
      ${images.map((exercise, index) => `
        <a class="hero-frame ${index === 0 ? "is-large" : ""}" href="${escapeHtml(exercise.video_url || "#")}" target="_blank" rel="noreferrer">
          <img src="${escapeHtml(exercise.youtube_thumbnail_url)}" alt="${escapeHtml(exercise.name)}" loading="lazy">
          <span>${escapeHtml(exercise.name)}</span>
        </a>
      `).join("")}
    </div>
  `;

  els.weekHero.querySelectorAll("[data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.viewJump;
      state.block = "all";
      syncTabs();
      render();
      document.querySelector("#biblioteca").scrollIntoView({ block: "start" });
    });
  });
}

function renderWeekTabs() {
  els.weekTabs.innerHTML = weeks.map((week, index) => `
    <button class="week-tab ${index === state.selectedWeek ? "is-active" : ""}" type="button" data-week="${index}">
      <span class="week-tab-range">${escapeHtml(week.label)}</span>
      <strong>${week.workouts.length} rutinas</strong>
      <span>${week.exercises.length} ejercicios · ${week.videos} videos</span>
    </button>
  `).join("");

  els.weekTabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedWeek = Number(button.dataset.week);
      state.block = "all";
      state.view = "week";
      ensureSelectedDay();
      syncTabs();
      render();
      document.querySelector("#semanas").scrollIntoView({ block: "start" });
    });
  });
}

function renderDayTabs() {
  const week = currentWeek();
  els.dayTabs.innerHTML = week.days.map((day) => {
    const exerciseCount = day.workouts.reduce((total, workout) => total + workout.exercises.length, 0);
    const label = day.workouts.map((workout) => workout.title).join(" + ") || day.events.map((event) => event.title).join(" + ");
    return `
      <button class="day-tab ${day.key === state.selectedDay ? "is-active" : ""}" type="button" data-day="${escapeHtml(day.key)}">
        <span class="day-date">${escapeHtml(formatShortDay(day.date))}</span>
        <strong>${escapeHtml(label || "Sin titulo")}</strong>
        <span>${exerciseCount ? `${exerciseCount} ejercicios` : `${day.events.length} eventos`}</span>
      </button>
    `;
  }).join("");

  els.dayTabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDay = button.dataset.day;
      state.block = "all";
      state.view = "week";
      syncTabs();
      render();
      document.querySelector("#rutina").scrollIntoView({ block: "start" });
    });
  });
}

function renderBlockFilters() {
  const week = currentWeek();
  const sourceExercises = state.view === "all" || state.view === "videos" ? allExercises : week.exercises;
  const blocks = Array.from(new Set(sourceExercises.map((exercise) => exercise.block).filter(Boolean)));
  els.blockFilters.innerHTML = [
    `<button class="chip ${state.block === "all" ? "is-active" : ""}" type="button" data-block="all">Todos</button>`,
    ...blocks.map((block) => `<button class="chip ${state.block === block ? "is-active" : ""}" type="button" data-block="${escapeHtml(block)}">${escapeHtml(block)}</button>`),
  ].join("");

  els.blockFilters.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.block = button.dataset.block;
      renderContent();
      renderBlockFilters();
    });
  });
}

function renderWeekView() {
  const day = currentDay();
  const filteredExercises = applyFilters(day.workouts.flatMap((workout) => workout.exercises));

  els.contentArea.innerHTML = `
    <div class="day-header">
      <div>
        <span class="section-label">${escapeHtml(formatDay(day.date))}</span>
        <h2>${escapeHtml(day.workouts.map((workout) => workout.title).join(" + ") || "Agenda del dia")}</h2>
      </div>
      <span class="day-pill">${filteredExercises.length} ejercicios visibles</span>
    </div>
    ${renderEvents(day.events)}
    ${day.workouts.length ? day.workouts.map((workout) => renderWorkout(workout, filteredExercises)).join("") : renderNoWorkout(day)}
  `;
}

function renderEvents(dayEvents) {
  if (!dayEvents.length) return "";
  return `
    <div class="event-strip">
      ${dayEvents.map((event) => `
        <article class="event-item" data-type="${escapeHtml(event.type)}">
          <span>${escapeHtml(event.type)}</span>
          <strong>${escapeHtml(event.title)}</strong>
          ${event.metrics && Object.keys(event.metrics).length ? `<p>${escapeHtml(Object.entries(event.metrics).map(([key, value]) => `${key}: ${value}`).join(" · "))}</p>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function renderNoWorkout(day) {
  return `
    <div class="empty-state">
      <h3>No hay rutina detallada en este dia</h3>
      <p>La agenda extraida contiene actividad o metricas, pero no una rutina con ejercicios enlazados.</p>
    </div>
  `;
}

function renderWorkout(workout, visibleExercises) {
  const blocks = workout.blocks || [];
  const visibleSet = new Set(visibleExercises.map((exercise) => `${exercise.workoutIndex}-${exercise.order}`));
  const workoutVisible = visibleExercises.filter((exercise) => exercise.workoutIndex === workout.index);

  return `
    <article class="workout-panel">
      <header class="workout-header">
        <div>
          <span class="section-label">${escapeHtml(workout.listing_date)} · ${escapeHtml(workout.scheduled_date || "sin fecha")}</span>
          <h3>${escapeHtml(workout.title || workout.listing_title)}</h3>
        </div>
        <div class="workout-counts">
          <span>${workout.exercises.length} ejercicios</span>
          <span>${workout.exercises.filter((exercise) => exercise.video_url).length} videos</span>
        </div>
      </header>
      ${workout.description ? `<p class="workout-description">${escapeHtml(workout.description)}</p>` : ""}
      ${workoutVisible.length ? blocks.map((block) => renderBlockSection(block, workout, visibleSet)).join("") : renderEmpty()}
      <footer class="source-panel">
        ${workout.internal_link ? `<a class="external-link" href="${escapeHtml(workout.internal_link)}" target="_blank" rel="noreferrer">${iconExternal} Abrir en Harbiz</a>` : ""}
      </footer>
    </article>
  `;
}

function renderBlockSection(block, workout, visibleSet) {
  const exercises = workout.exercises.filter((exercise) => exercise.block === block.name && visibleSet.has(`${exercise.workoutIndex}-${exercise.order}`));
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
}

function exerciseCard(exercise) {
  const thumbnail = exercise.youtube_thumbnail_url || "";
  const instructions = clean(exercise.instructions);
  const notes = exercise.notes?.filter(Boolean) || [];
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
        ${notes.length ? `<p class="note-line">${escapeHtml(notes.join(" · "))}</p>` : ""}
        <details>
          <summary>Instrucciones</summary>
          <div class="instructions">${instructions ? escapeHtml(instructions) : "Sin instrucciones adicionales en Harbiz."}</div>
        </details>
        <div class="card-actions">
          ${exercise.video_url ? `<a class="external-link" href="${escapeHtml(exercise.video_url)}" target="_blank" rel="noreferrer">${iconExternal} Abrir video</a>` : ""}
          ${exercise.internal_link ? `<a class="external-link" href="${escapeHtml(exercise.internal_link)}" target="_blank" rel="noreferrer">${iconExternal} Link Harbiz</a>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderAllView() {
  const exercises = applyFilters(allExercises);
  els.contentArea.innerHTML = `
    <div class="day-header">
      <div>
        <span class="section-label">Biblioteca completa</span>
        <h2>Todos los ejercicios extraidos</h2>
      </div>
      <span class="day-pill">${exercises.length} de ${allExercises.length}</span>
    </div>
    ${exercises.length ? `<div class="exercise-grid">${exercises.map((exercise) => exerciseCard({ ...exercise, order: `${exercise.workoutIndex + 1}.${exercise.order}` })).join("")}</div>` : renderEmpty()}
  `;
}

function renderVideosView() {
  const filtered = applyFilters(uniqueVideos);
  els.contentArea.innerHTML = `
    <div class="day-header">
      <div>
        <span class="section-label">Biblioteca audiovisual</span>
        <h2>Videos unicos de ejercicios</h2>
      </div>
      <span class="day-pill">${filtered.length} de ${uniqueVideos.length}</span>
    </div>
    ${filtered.length ? `<div class="video-grid">${filtered.map(videoCard).join("")}</div>` : renderEmpty()}
  `;
}

function videoCard(exercise) {
  return `
    <article class="video-card">
      <a class="thumb-link" href="${escapeHtml(exercise.video_url)}" target="_blank" rel="noreferrer">
        <img src="${escapeHtml(exercise.youtube_thumbnail_url)}" alt="${escapeHtml(exercise.name)}" loading="lazy">
        <span class="play-badge">${iconPlay} YouTube</span>
      </a>
      <div class="exercise-body">
        <div class="exercise-kicker">
          <span>${escapeHtml(exercise.block || "Sin bloque")}</span>
          <span>${escapeHtml(exercise.workout?.listing_date || "")}</span>
        </div>
        <h4>${escapeHtml(exercise.name)}</h4>
        <p class="card-meta">${escapeHtml(exercise.workout?.title || "")}</p>
        <div class="card-actions">
          <a class="external-link" href="${escapeHtml(exercise.video_url)}" target="_blank" rel="noreferrer">${iconExternal} Abrir video</a>
        </div>
      </div>
    </article>
  `;
}

function renderTextView() {
  const week = currentWeek();
  const rawText = week.workouts.map((workout) => `# ${workout.title}\n\n${workout.raw_text || ""}`).join("\n\n---\n\n");
  els.contentArea.innerHTML = `
    <section class="text-panel">
      <h2>Texto original de la semana seleccionada</h2>
      <pre>${escapeHtml(rawText || "Sin texto original disponible.")}</pre>
    </section>
    <section class="text-panel">
      <h2>Agenda extraida</h2>
      <pre>${escapeHtml(week.events.map((event) => `${event.date} | ${event.type} | ${event.title}`).join("\n"))}</pre>
    </section>
    <section class="source-panel">
      <a class="external-link" href="./harbiz-rutinas-limpio.md">${iconExternal} Markdown limpio</a>
      <a class="external-link" href="./harbiz-rutinas-scrape.json">${iconExternal} JSON completo</a>
    </section>
  `;
}

function renderEmpty() {
  return `
    <div class="empty-state">
      <h3>Sin resultados</h3>
      <p>No hay ejercicios que coincidan con la busqueda y el bloque seleccionado.</p>
    </div>
  `;
}

function syncTabs() {
  els.viewTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
}

function renderContent() {
  if (state.view === "all") renderAllView();
  else if (state.view === "videos") renderVideosView();
  else if (state.view === "text") renderTextView();
  else renderWeekView();
}

function render() {
  ensureSelectedDay();
  renderStats();
  renderHero();
  renderWeekTabs();
  renderDayTabs();
  renderBlockFilters();
  renderContent();
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderContent();
});

els.viewTabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    if (state.view === "text") state.block = "all";
    syncTabs();
    render();
  });
});

els.printButton.addEventListener("click", () => window.print());

render();
