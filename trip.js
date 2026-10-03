// Trip page (trip.html?id=N): one trip's cover, details and memories.

const tripId = Number(new URLSearchParams(location.search).get("id"));
const viewer = $("memory-viewer");
let trip = null;
let viewList = [];   // the trip's memories, in the viewer's order
let viewIndex = 0;   // which one the viewer shows

function render() {
  trip = trips.find((t) => t.id === tripId);
  $("trip-content").hidden = !trip;
  $("not-found").hidden = !!trip;
  if (!trip) return;

  document.title = `${trip.title} · memora`;
  // Owner or admin sees this trip's edit controls (.editor-only).
  document.body.classList.toggle("can-edit", canEditTrip(trip));

  const cover = coverOf(trip);
  const coverImg = $("trip-cover");
  if (cover) coverImg.src = cover;
  else coverImg.removeAttribute("src");
  coverImg.hidden = !cover;

  $("trip-when").textContent = whenLabel(trip);
  $("trip-title").textContent = trip.title;
  $("trip-range").textContent = rangeLabel(trip);

  const list = memoriesOf(trip.id);
  const days = tripDays(trip);
  $("stat-days").textContent = days ? pad2(days) : "—";
  $("stat-days-label").textContent = days === 1 ? "Day" : "Days";
  $("stat-memories").textContent = pad2(list.length);
  $("stat-country").textContent = countryOf(trip);

  $("trip-desc").textContent = trip.description || "";
  $("trip-desc").hidden = !trip.description;
  $("trip-tags").replaceChildren(...(trip.tags || []).map((t) => h("li", {}, t)));

  renderMemoryGrid(list);
  $("memories-empty").hidden = list.length > 0;
  $("memories-none").hidden = list.length > 0;

  renderPager();
}
onDataChange = render;

// Columns are filled left to right (1st memory in column 1, 2nd in column 2, …)
// so the trip still reads in order while each photo keeps its own shape.
// The breakpoints match the .memory-grid rules in styles.css.
const WIDE = matchMedia("(min-width: 901px)");
const MEDIUM = matchMedia("(min-width: 641px)");

function renderMemoryGrid(list) {
  const count = WIDE.matches ? 3 : MEDIUM.matches ? 2 : 1;
  const columns = Array.from({ length: count }, () => h("div", { class: "memory-col" }));
  list.forEach((m, i) => columns[i % count].append(memoryCard(m, i)));
  $("memory-grid").replaceChildren(...(list.length ? columns : []));
}
for (const query of [WIDE, MEDIUM]) {
  query.addEventListener("change", () => trip && renderMemoryGrid(memoriesOf(trip.id)));
}

function memoryCard(m, i) {
  const caption = h("span", { class: "memory-caption" },
    h("span", { class: "memory-num" }, pad2(i + 1)),
    h("span", { class: "memory-title" }, m.title || "Untitled memory"));
  const open = () => openViewer(m);

  // No photo: the note itself is the picture.
  if (!m.photoUrl) {
    return h("button", { class: "memory-card is-note", type: "button", onclick: open },
      h("span", { class: "memory-quote" }, m.note || m.title || "Untitled memory"),
      caption);
  }
  return h("button", { class: "memory-card", type: "button", onclick: open },
    h("span", { class: "memory-frame" },
      h("img", { class: "memory-media", src: m.photoUrl, alt: m.title, loading: "lazy" })),
    caption,
    m.note && h("span", { class: "memory-note" }, m.note));
}

// Links to the next newer / older trip.
function renderPager() {
  const list = sortedTrips();
  const i = list.findIndex((t) => t.id === tripId);
  const link = (t, label, dir) => h("a", { class: `pager-link ${dir}`, href: tripUrl(t) },
    h("span", { class: "eyebrow" }, label),
    h("span", { class: "pager-title" }, dir === "prev" ? `← ${t.title}` : `${t.title} →`));
  const newer = list[i - 1];
  const older = list[i + 1];
  $("trip-pager").replaceChildren(
    newer ? link(newer, "Newer trip", "prev") : h("span"),
    older ? link(older, "Older trip", "next") : h("span"));
  $("trip-pager").hidden = !newer && !older;
}

// ---------- Memory viewer ----------

function openViewer(m) {
  viewList = memoriesOf(tripId);
  viewIndex = Math.max(0, viewList.findIndex((x) => x.id === m.id));
  showViewerMemory();
  viewer.showModal();
}

function showViewerMemory() {
  const m = viewList[viewIndex];
  const img = $("viewer-img");
  if (m.photoUrl && img.getAttribute("src") !== m.photoUrl) {
    img.src = m.photoUrl;
    img.classList.remove("changing");
    void img.offsetWidth; // restart the fade-in
    img.classList.add("changing");
  } else if (!m.photoUrl) {
    img.removeAttribute("src");
  }
  img.alt = m.title;
  viewer.classList.toggle("no-photo", !m.photoUrl);

  $("viewer-count").textContent = viewList.length > 1 ? `Memory ${viewIndex + 1} of ${viewList.length}` : "Memory";
  $("viewer-trip").textContent = [trip.title, rangeLabel(trip)].filter(Boolean).join(" · ");
  $("viewer-title").textContent = m.title || "Untitled memory";
  $("viewer-note").textContent = m.note || "";
  $("viewer-note").hidden = !m.note;
  // Only editors get a hint; visitors just see the photo and title.
  $("viewer-no-note").textContent = "No description yet. Use “Edit memory” to add one.";
  $("viewer-no-note").hidden = !!m.note || !canEditTrip(trip);

  const several = viewList.length > 1;
  $("viewer-prev").hidden = !several;
  $("viewer-next").hidden = !several;
  renderStrip(several);

  // Load the neighbours now so stepping to them is instant.
  for (const d of [-1, 1]) {
    const near = viewList[(viewIndex + d + viewList.length) % viewList.length];
    if (near.photoUrl) new Image().src = near.photoUrl;
  }
}

function renderStrip(several) {
  const strip = $("viewer-strip");
  strip.hidden = !several;
  if (!several) return;
  strip.replaceChildren(...viewList.map((m, i) => h("button", {
    type: "button",
    "aria-label": m.title || `Memory ${i + 1}`,
    "aria-current": i === viewIndex ? "true" : null,
    onclick: () => { viewIndex = i; showViewerMemory(); },
  }, m.photoUrl ? h("img", { src: m.photoUrl, alt: "" }) : "\u201C")));
  strip.children[viewIndex].scrollIntoView({ block: "nearest", inline: "center" });
}

function stepViewer(delta) {
  viewIndex = (viewIndex + delta + viewList.length) % viewList.length;
  showViewerMemory();
}

$("viewer-prev").addEventListener("click", () => stepViewer(-1));
$("viewer-next").addEventListener("click", () => stepViewer(1));
viewer.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea")) return;
  if (e.key === "ArrowLeft") stepViewer(-1);
  if (e.key === "ArrowRight") stepViewer(1);
});

// Clicking the dark space around the photo closes the viewer.
$("viewer-stage").addEventListener("click", (e) => {
  if (e.target.matches(".viewer-stage, .viewer-photo")) viewer.close();
});

// Swipe left / right on phones.
let touchX = null;
$("viewer-stage").addEventListener("touchstart", (e) => {
  touchX = e.touches.length === 1 ? e.touches[0].clientX : null;
}, { passive: true });
$("viewer-stage").addEventListener("touchend", (e) => {
  if (touchX == null || viewList.length < 2) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1);
});

$("viewer-edit").addEventListener("click", () => {
  const memory = viewList[viewIndex];
  viewer.close();
  openMemoryForm({ memory });
});

// ---------- Actions ----------

const addHere = () => openMemoryForm({ tripId });
$("add-memory-btn").addEventListener("click", addHere); // falls back to one of your own trips
$("add-memory-here").addEventListener("click", addHere);
$("memories-empty").addEventListener("click", addHere);
$("edit-trip").addEventListener("click", () => openTripForm(trip));

$("delete-trip").addEventListener("click", async () => {
  if (!confirm(`Delete "${trip.title}" and all of its memories?`)) return;
  try {
    await deleteTrip(trip, memoriesOf(trip.id));
  } catch (err) {
    alert(friendlyError(err));
    return;
  }
  location.href = "index.html";
});

loadData().then(render);
