// Storage for memora, backed by Supabase (tables + rules: supabase/schema.sql).
// Rows are mapped to the shapes the pages use:
//
// trip:   { id, ownerId, title, startDate, endDate, date, description, tags[], coverPath, coverUrl, createdAt }
// memory: { id, tripId, title, note, photoPath, photoUrl, addedAt }

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const BUCKET = "photos";

const photoUrl = (path) => (path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null);

function fromTripRow(r) {
  return {
    id: r.id,
    ownerId: r.owner,
    title: r.title,
    startDate: r.start_date || "",
    endDate: r.end_date || "",
    date: r.date_text || "",
    description: r.description || "",
    tags: r.tags || [],
    coverPath: r.cover_path,
    coverUrl: photoUrl(r.cover_path),
    createdAt: Date.parse(r.created_at),
  };
}

function fromMemoryRow(r) {
  return {
    id: r.id,
    tripId: r.trip_id,
    title: r.title,
    note: r.note || "",
    photoPath: r.photo_path,
    photoUrl: photoUrl(r.photo_path),
    addedAt: Date.parse(r.created_at),
  };
}

// Unwraps a Supabase response, throwing its error.
function check({ data, error }) {
  if (error) throw error;
  return data;
}

async function loadAll() {
  const [t, m] = await Promise.all([
    sb.from("trips").select("*"),
    sb.from("memories").select("*").order("created_at"),
  ]);
  return { trips: check(t).map(fromTripRow), memories: check(m).map(fromMemoryRow) };
}

// ---------- Photos ----------

const randomId = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// Shrinks large photos (longest side 2000px, JPEG) before upload. Falls back
// to the original if the browser can't decode it (e.g. HEIC outside Safari).
async function prepareImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return (await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85))) || file;
  } catch {
    return file;
  }
}

async function uploadPhoto(file) {
  const blob = await prepareImage(file);
  const type = blob.type || file.type || "image/jpeg";
  const ext = type === "image/jpeg" ? "jpg" : type.split("/")[1] || "img";
  const path = `${randomId()}.${ext}`;
  check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: "31536000" }));
  return path;
}

// Best effort: a leftover file is harmless, so failures are ignored.
async function removePhotos(paths) {
  const list = paths.filter(Boolean);
  if (list.length) await sb.storage.from(BUCKET).remove(list);
}

// ---------- Writes ----------

// Creates (trip = null) or updates a trip. `photo` is a newly chosen cover, if any.
async function saveTrip(trip, fields, photo) {
  const row = {
    title: fields.title,
    start_date: fields.startDate || null,
    end_date: fields.endDate || null,
    description: fields.description || null,
    tags: fields.tags || [],
    cover_path: photo ? await uploadPhoto(photo) : trip?.coverPath ?? null,
  };
  if ("date" in fields) row.date_text = fields.date || null;

  const query = trip ? sb.from("trips").update(row).eq("id", trip.id) : sb.from("trips").insert(row);
  const saved = fromTripRow(check(await query.select().single()));
  if (photo && trip?.coverPath) removePhotos([trip.coverPath]);
  return saved;
}

// Creates (memory = null) or updates a memory. `photo` is a newly chosen photo, if any.
async function saveMemory(memory, fields, photo) {
  const row = {
    trip_id: fields.tripId,
    title: fields.title,
    note: fields.note || null,
    photo_path: photo ? await uploadPhoto(photo) : memory?.photoPath ?? null,
  };
  const query = memory ? sb.from("memories").update(row).eq("id", memory.id) : sb.from("memories").insert(row);
  const saved = fromMemoryRow(check(await query.select().single()));
  if (photo && memory?.photoPath) removePhotos([memory.photoPath]);
  return saved;
}

async function deleteMemory(memory) {
  const deleted = check(await sb.from("memories").delete().eq("id", memory.id).select());
  if (!deleted.length) throw new Error("You don't have permission to delete this.");
  removePhotos([memory.photoPath]);
}

// Memories are removed by the database (on delete cascade).
async function deleteTrip(trip, tripMemories) {
  const deleted = check(await sb.from("trips").delete().eq("id", trip.id).select());
  if (!deleted.length) throw new Error("You don't have permission to delete this.");
  removePhotos([trip.coverPath, ...tripMemories.map((m) => m.photoPath)]);
}

// ---------- Accounts & members ----------

const isAdmin = async () => (await sb.rpc("is_admin")).data === true;

// "pending" | "approved" | "rejected" for the signed-in account.
async function myStatus(userId) {
  const { data } = await sb.from("profiles").select("status").eq("id", userId).maybeSingle();
  return data?.status || "pending";
}

// Admin only: every account, oldest first.
async function listMembers() {
  return check(await sb.from("profiles").select("*").order("created_at"));
}

async function setMemberStatus(id, status) {
  const updated = check(await sb.from("profiles")
    .update({ status, decided_at: new Date().toISOString() }).eq("id", id).select());
  if (!updated.length) throw new Error("Only the admin can approve accounts.");
}

const signIn = (email, password) => sb.auth.signInWithPassword({ email, password }).then(check);
// The confirmation email links back to this page.
const signUp = (email, password) => sb.auth.signUp({
  email,
  password,
  options: { emailRedirectTo: location.origin + location.pathname },
}).then(check);
const signOut = () => sb.auth.signOut();
const currentUser = async () => (await sb.auth.getSession()).data.session?.user ?? null;
