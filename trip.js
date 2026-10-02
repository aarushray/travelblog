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

  $("memory-grid").replaceChildren(...list.map(memoryCard));
  $("memories-empty").hidden = list.length > 0;
  $("memories-none").hidden = list.length > 0;

  renderPager();
}
onDataChange = render;

function memoryCard(m) {
  return h("button", { class: "memory-card", type: "button", onclick: () => openViewer(m) },
    m.photoUrl
      ? h("img", { class: "memory-media", src: m.photoUrl, alt: m.title, loading: "lazy" })
      : h("span", { class: "memory-media" }),
    h("span", { class: "memory-title" }, m.title || "Untitled memory"),
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
  if (m.photoUrl) img.src = m.photoUrl;
  else img.removeAttribute("src");
  img.alt = m.title;
  viewer.classList.toggle("no-photo", !m.photoUrl);

  $("viewer-count").textContent = viewList.length > 1 ? `Memory ${viewIndex + 1} of ${viewList.length}` : "Memory";
  $("viewer-trip").textContent = [trip.title, rangeLabel(trip)].filter(Boolean).join(" · ");
  $("viewer-title").textContent = m.title || "Untitled memory";
  $("viewer-note").textContent = m.note || "";
  $("viewer-note").hidden = !m.note;
  $("viewer-no-note").textContent = canEditTrip(trip)
    ? "No description yet. Use “Edit memory” to add one."
    : "No description for this memory.";
  $("viewer-no-note").hidden = !!m.note;

  const several = viewList.length > 1;
  $("viewer-prev").hidden = !several;
  $("viewer-next").hidden = !several;
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
