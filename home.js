// Landing page: My memories / Places / Timeline views. Clicking a trip goes
// to its own page (trip.html).

function render() {
  renderStats();
  renderTravels();
  renderPlaces();
  renderTimeline();
  updateImportBanner();
}
onDataChange = render;

function renderStats() {
  $("stat-trips").textContent = pad2(trips.length);
  $("stat-memories").textContent = pad2(memories.length);
  const countries = new Set(trips.map((t) => countryOf(t).toLowerCase()).filter(Boolean));
  $("stat-countries").textContent = pad2(countries.size);
}

function tripCard(trip) {
  const cover = coverOf(trip);
  const when = whenLabel(trip);
  return h("a", { class: "trip-card", href: tripUrl(trip) },
    h("div", { class: "trip-card-media" },
      cover && h("img", { src: cover, alt: "", loading: "lazy" }),
      h("div", { class: "trip-card-label" },
        when && h("span", { class: "trip-card-when" }, when),
        h("h3", { class: "trip-card-title" }, trip.title))),
    h("div", { class: "trip-card-body" },
      trip.description && h("p", { class: "trip-card-desc" }, trip.description),
      h("div", { class: "trip-card-foot" },
        h("ul", { class: "tags" }, (trip.tags || []).map((t) => h("li", {}, t))),
        h("span", { class: "count" }, countText(memoriesOf(trip.id).length)))));
}

function addTripCard() {
  return h("button", { class: "add-trip-card", type: "button", onclick: () => openTripForm() },
    h("span", { class: "add-circle" }, "+"),
    h("strong", {}, "Add a trip"),
    h("span", {}, "Start keeping another memory"));
}

function renderTravels() {
  const cards = sortedTrips().map(tripCard);
  if (isMember()) cards.push(addTripCard());
  else if (!cards.length) cards.push(h("p", { class: "view-empty grid-empty" }, "No trips here yet."));
  $("trip-grid").replaceChildren(...cards);
}

function renderPlaces() {
  const groups = new Map();
  for (const trip of sortedTrips()) {
    const country = countryOf(trip);
    if (!groups.has(country)) groups.set(country, []);
    groups.get(country).push(trip);
  }
  const rows = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([country, list]) => {
    const memoryCount = list.reduce((n, t) => n + memoriesOf(t.id).length, 0);
    return h("li", { class: "place-row" },
      h("div", { class: "place-name" },
        h("h3", {}, country),
        h("p", {}, `${countText(list.length, "trip")} · ${countText(memoryCount)}`)),
      h("div", { class: "place-trips" },
        list.map((t) => h("a", { class: "chip-btn", href: tripUrl(t) }, t.title))));
  });
  $("places-list").replaceChildren(...rows);
  $("places-empty").hidden = rows.length > 0;
}

function renderTimeline() {
  const items = sortedTrips().map((trip) => {
    const cover = coverOf(trip);
    return h("li", { class: "tl-item" },
      h("span", { class: "tl-date" }, shortWhen(trip)),
      h("a", { class: "tl-card", href: tripUrl(trip) },
        cover ? h("img", { class: "tl-thumb", src: cover, alt: "", loading: "lazy" }) : h("span", { class: "tl-thumb" }),
        h("span", { class: "tl-text" },
          h("span", { class: "tl-title" }, trip.title),
          h("span", { class: "tl-meta" },
            [rangeLabel(trip), countText(memoriesOf(trip.id).length)].filter(Boolean).join(" · ")))));
  });
  $("timeline-list").replaceChildren(...items);
  $("timeline-empty").hidden = items.length > 0;
}

// ---------- Views ----------

const VIEWS = ["memories", "places", "timeline"];

function showView() {
  const hash = location.hash.slice(1);
  const view = VIEWS.includes(hash) ? hash : "memories";
  for (const panel of document.querySelectorAll("[data-view-panel]")) {
    panel.hidden = panel.dataset.viewPanel !== view;
  }
  for (const link of document.querySelectorAll(".nav-links a")) {
    const active = link.dataset.view === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

window.addEventListener("hashchange", () => {
  showView();
  window.scrollTo(0, 0);
});

$("add-memory-btn").addEventListener("click", () => openMemoryForm());

// ---------- Import from the old browser-only version ----------

let localData;     // undefined = not checked yet
let importing = false;

async function updateImportBanner() {
  if (!isMember() || importing) return;
  if (localData === undefined) localData = await readLocalTrips();
  $("import-banner").hidden = !localData;
  if (!localData) return;
  const n = localData.trips.length || 1;
  $("import-text").textContent =
    `This browser still has ${countText(n, "trip")} and ${countText(localData.photos.length)} from before. Upload them to your site?`;
}

$("import-btn").addEventListener("click", async () => {
  importing = true;
  const btn = $("import-btn");
  btn.disabled = true;
  try {
    await importLocalTrips(localData, (done, total) => {
      $("import-text").textContent = `Uploading photos… ${done} of ${total}`;
    });
    localData = null;
    $("import-banner").hidden = true;
  } catch (err) {
    console.error(err);
    $("import-text").textContent = `The import stopped: ${friendlyError(err)} Trips uploaded so far are kept.`;
  } finally {
    importing = false;
    btn.disabled = false;
    render();
  }
});

loadData().then(() => {
  showView();
  render();
});
