// One-time import of trips that the earlier, browser-only version of the site
// saved in IndexedDB. Nothing is deleted locally; once an import finishes,
// a flag in localStorage stops the offer from showing again.

const LOCAL_DB_NAME = "travel-scrapbook";
const IMPORT_DONE_KEY = "memora-imported";
const IMPORTED_TRIPS_KEY = "memora-imported-trips"; // local trip ids already uploaded, so a retry skips them

function importedTripIds() {
  try { return JSON.parse(localStorage.getItem(IMPORTED_TRIPS_KEY)) || []; } catch { return []; }
}

// Resolves to { trips, photos } from the old local database, or null if none.
async function readLocalTrips() {
  try {
    if (localStorage.getItem(IMPORT_DONE_KEY)) return null;
    const dbs = await indexedDB.databases?.();
    if (!dbs?.some((d) => d.name === LOCAL_DB_NAME)) return null;
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const req = indexedDB.open(LOCAL_DB_NAME);
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      const stores = ["trips", "photos"].filter((n) => db.objectStoreNames.contains(n));
      if (!stores.includes("photos")) { db.close(); resolve(null); return; }

      const out = { trips: [], photos: [] };
      const t = db.transaction(stores, "readonly");
      for (const name of stores) {
        t.objectStore(name).getAll().onsuccess = (e) => { out[name] = e.target.result; };
      }
      t.oncomplete = () => {
        db.close();
        resolve(out.trips.length || out.photos.length ? out : null);
      };
      t.onerror = () => resolve(null);
    };
  });
}

// Uploads every local trip and photo; calls onProgress(done, total) per photo.
async function importLocalTrips({ trips: localTrips, photos }, onProgress) {
  const groups = localTrips.map((trip) => ({ key: trip.id, trip, photos: photos.filter((p) => p.tripId === trip.id) }));
  const orphans = photos.filter((p) => p.tripId == null);
  if (orphans.length) groups.push({ key: "orphans", trip: { title: "Earlier photos" }, photos: orphans });

  const imported = importedTripIds();
  const todo = groups.filter((g) => !imported.includes(g.key));
  const total = todo.reduce((n, g) => n + g.photos.length, 0);
  let done = 0;
  for (const { key, trip, photos: list } of todo) {
    list.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    const saved = await saveTrip(null, {
      title: trip.title || "Untitled trip",
      startDate: trip.startDate || "",
      endDate: trip.endDate || "",
      date: trip.date || "",
      description: trip.description || "",
      tags: trip.tags || [],
    }, trip.cover || list.find((p) => p.blob)?.blob || null);
    trips = [...trips, saved];

    for (const p of list) {
      const title = p.title || p.caption || "Untitled memory";
      memories = [...memories, await saveMemory(null, { tripId: saved.id, title, note: p.note || "" }, p.blob || null)];
      onProgress(++done, total);
    }
    imported.push(key);
    localStorage.setItem(IMPORTED_TRIPS_KEY, JSON.stringify(imported));
  }
  localStorage.setItem(IMPORT_DONE_KEY, "1");
}
