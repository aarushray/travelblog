// Shared by every page: loaded data, sign-in, formatting helpers, and the
// trip + memory forms. Each page sets `onDataChange` to its own render function.

let trips = [];
let memories = [];
// The signed-in account (see supabase/schema.sql for what each role may do).
let me = { user: null, status: null, isAdmin: false };
let onDataChange = () => {};

const $ = (id) => document.getElementById(id);

async function loadData() {
  try {
    ({ trips, memories } = await loadAll());
  } catch (err) {
    showLoadError(err);
  }
  await refreshAccount();
}

function showLoadError(err) {
  console.error(err);
  const missingTables = /schema cache|does not exist/i.test(err.message || "");
  document.querySelector("main").prepend(h("div", { class: "load-error" },
    h("strong", {}, "Couldn't load your trips. "),
    missingTables
      ? "The database isn't set up yet: run supabase/schema.sql in the Supabase SQL Editor."
      : err.message || "Check your internet connection and refresh."));
}

// ---------- Helpers ----------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const PLURALS = { memory: "memories", trip: "trips", day: "days" };

const pad2 = (n) => String(n).padStart(2, "0");
const countText = (n, word = "memory") => `${n} ${n === 1 ? word : PLURALS[word]}`;

// Builds an element: h("p", { class: "x", onclick: fn }, "text", childNode)
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false && c !== ""));
  return node;
}

function parseDay(s) {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// "April 2025" (trips imported from the old site may only have a free-text date)
function whenLabel(trip) {
  const d = parseDay(trip.startDate);
  return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : trip.date || "";
}

// "24 April — 02 May"
function rangeLabel(trip) {
  const s = parseDay(trip.startDate);
  const e = parseDay(trip.endDate);
  if (!s) return trip.date || "";
  const crossYear = e && e.getFullYear() !== s.getFullYear();
  const fmt = (d, year) => `${pad2(d.getDate())} ${MONTHS[d.getMonth()]}${year ? " " + d.getFullYear() : ""}`;
  if (!e || +e === +s) return fmt(s, true);
  return `${fmt(s, crossYear)} — ${fmt(e, crossYear)}`;
}

// "Apr 2025"
function shortWhen(trip) {
  const d = parseDay(trip.startDate);
  return d ? `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` : trip.date || "No date";
}

// Number of days, counting both the first and last day; null if no dates.
function tripDays(trip) {
  const s = parseDay(trip.startDate);
  if (!s) return null;
  const e = parseDay(trip.endDate) || s;
  return Math.round((e - s) / 86400000) + 1;
}

const tripTime = (trip) => parseDay(trip.startDate)?.getTime() ?? trip.createdAt ?? 0;
const sortedTrips = () => [...trips].sort((a, b) => tripTime(b) - tripTime(a)); // newest first
const tripUrl = (trip) => `trip.html?id=${trip.id}`;

// "Kyoto, Japan" → "Japan"
const countryOf = (trip) => trip.title.split(",").pop().trim();

const memoriesOf = (tripId) =>
  memories.filter((m) => m.tripId === tripId).sort((a, b) => a.addedAt - b.addedAt);

// Cover = the trip's cover photo, else the first photo uploaded to it.
const coverOf = (trip) => trip.coverUrl || memoriesOf(trip.id).find((m) => m.photoUrl)?.photoUrl || null;

const replaceById = (list, item) => list.map((x) => (x.id === item.id ? item : x));

// ---------- Permissions (mirrors the database rules) ----------

const isMember = () => !!me.user && (me.isAdmin || me.status === "approved");
const canEditTrip = (trip) => !!trip && isMember() && (me.isAdmin || trip.ownerId === me.user.id);
const editableTrips = () => sortedTrips().filter(canEditTrip);

// ---------- Dialogs (same on every page) ----------

document.body.insertAdjacentHTML("beforeend", `
  <dialog id="trip-form-modal" class="sheet" aria-labelledby="trip-form-title">
    <form id="trip-form" novalidate>
      <h2 id="trip-form-title">New trip</h2>
      <label id="cover-field" class="photo-field">
        <input type="file" accept="image/*" hidden>
        <img alt="">
        <span class="photo-field-empty"><span class="add-circle">+</span><span>Choose a cover photo</span></span>
        <span class="photo-field-change">Change photo</span>
      </label>
      <label class="field">
        <span>Place</span>
        <input name="title" type="text" maxlength="60" placeholder="e.g. Kyoto, Japan" autocomplete="off">
      </label>
      <div class="field-row">
        <label class="field"><span>From</span><input name="startDate" type="date"></label>
        <label class="field"><span>To</span><input name="endDate" type="date"></label>
      </div>
      <label class="field">
        <span>Short description</span>
        <textarea name="description" maxlength="200" rows="2" placeholder="Quiet mornings, tiny ramen shops…"></textarea>
      </label>
      <label class="field">
        <span>Tags <em>(comma separated)</em></span>
        <input name="tags" type="text" maxlength="80" placeholder="Spring, Food, Temples" autocomplete="off">
      </label>
      <p id="trip-form-error" class="form-error" hidden></p>
      <div class="form-actions">
        <button type="button" class="pill-btn light" data-close>Cancel</button>
        <button type="submit" class="pill-btn dark">Save trip</button>
      </div>
    </form>
  </dialog>

  <dialog id="memory-form-modal" class="sheet" aria-labelledby="memory-form-title">
    <form id="memory-form" novalidate>
      <h2 id="memory-form-title">New memory</h2>
      <label id="memory-photo-field" class="photo-field">
        <input type="file" accept="image/*" hidden>
        <img alt="">
        <span class="photo-field-empty"><span class="add-circle">+</span><span>Add a photo <em>(optional)</em></span></span>
        <span class="photo-field-change">Change photo</span>
      </label>
      <label class="field">
        <span>Trip</span>
        <select name="tripId"></select>
      </label>
      <label class="field">
        <span>Title</span>
        <input name="title" type="text" maxlength="60" placeholder="e.g. Morning in Gion" autocomplete="off">
      </label>
      <label class="field">
        <span>Note</span>
        <textarea name="note" maxlength="400" rows="3" placeholder="What happened? Who were you with?"></textarea>
      </label>
      <p id="memory-form-error" class="form-error" hidden></p>
      <div class="form-actions">
        <button id="memory-delete" type="button" class="text-btn danger">Delete memory</button>
        <span class="spacer"></span>
        <button type="button" class="pill-btn light" data-close>Cancel</button>
        <button type="submit" class="pill-btn dark">Save memory</button>
      </div>
    </form>
  </dialog>

  <dialog id="signin-modal" class="sheet" aria-labelledby="signin-title">
    <form id="signin-form" novalidate>
      <h2 id="signin-title">Sign in</h2>
      <p id="signin-hint" class="form-hint">Sign in to add and edit your trips.</p>
      <label class="field">
        <span>Email</span>
        <input name="email" type="email" autocomplete="email">
      </label>
      <label class="field">
        <span>Password</span>
        <input name="password" type="password" autocomplete="current-password" minlength="6">
      </label>
      <p id="signin-error" class="form-error" hidden></p>
      <div class="form-actions">
        <button id="signup-btn" type="button" class="text-btn">Create account instead</button>
        <span class="spacer"></span>
        <button type="button" class="pill-btn light" data-close>Cancel</button>
        <button type="submit" class="pill-btn dark">Sign in</button>
      </div>
    </form>
  </dialog>

  <dialog id="members-modal" class="sheet" aria-labelledby="members-title">
    <div class="sheet-body">
      <div class="members-head">
        <h2 id="members-title">Members</h2>
        <button type="button" class="pill-btn light" data-close>Done</button>
      </div>
      <p class="form-hint">New accounts wait here until you approve them. Approved members can add trips and edit their own; you can edit everything.</p>
      <p id="members-error" class="form-error" hidden></p>
      <ul id="members-list" class="members-list"></ul>
    </div>
  </dialog>
`);

// Header: "Members" (admin only, with a count of people waiting) before Sign in / out.
$("account-btn").before(h("button", { id: "members-btn", class: "text-btn admin-only", type: "button" },
  "Members", h("span", { id: "members-badge", class: "badge", hidden: true })));

// Message for accounts that can't add anything yet.
document.querySelector("main").prepend(h("div", { id: "account-notice", class: "notice", hidden: true }));

function showError(el, message) {
  el.textContent = message || "";
  el.hidden = !message;
}

// Disables a form's submit button while `work` runs; shows any error.
async function submitting(form, errorEl, busyText, work) {
  const btn = form.querySelector("[type=submit]");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
  showError(errorEl, "");
  try {
    await work();
  } catch (err) {
    console.error(err);
    showError(errorEl, friendlyError(err));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (/row-level security|violates|permission|0 rows|no\) rows/i.test(msg)) {
    return "This account isn't allowed to make changes.";
  }
  if (/failed to fetch|network/i.test(msg)) return "Couldn't reach the server. Check your connection.";
  if (/email not confirmed/i.test(msg)) return "Confirm your email first: open the link we sent to your inbox.";
  if (/invalid login credentials/i.test(msg)) return "That email and password don't match.";
  if (/already registered/i.test(msg)) return "There's already an account with that email. Sign in instead.";
  return msg;
}

// ---------- Accounts ----------

const accountBtn = $("account-btn");
const signinModal = $("signin-modal");
const signinForm = $("signin-form");
const signinError = $("signin-error");
let creatingAccount = false;

function showNotice(text) {
  $("account-notice").textContent = text || "";
  $("account-notice").hidden = !text;
}

async function refreshAccount() {
  const user = await currentUser();
  me = { user, status: null, isAdmin: false };
  if (user) [me.status, me.isAdmin] = await Promise.all([myStatus(user.id), isAdmin()]);

  document.body.classList.toggle("is-member", isMember());
  document.body.classList.toggle("is-admin", me.isAdmin);
  accountBtn.textContent = user ? "Sign out" : "Sign in";
  accountBtn.title = user ? `Signed in as ${user.email}` : "";

  if (user && !isMember()) {
    showNotice(me.status === "rejected"
      ? "Your account request wasn't approved, so you can browse but not add trips."
      : "Thanks for signing up! Your account is waiting for the admin's approval. You can browse in the meantime.");
  } else {
    showNotice("");
  }
  if (me.isAdmin) updateMembersBadge();
}

function setSigninMode(create) {
  creatingAccount = create;
  $("signin-title").textContent = create ? "Create an account" : "Sign in";
  $("signin-hint").textContent = create
    ? "New accounts need the admin's approval before they can add trips."
    : "Sign in to add and edit your trips.";
  $("signup-btn").textContent = create ? "I already have an account" : "Create account instead";
  signinForm.querySelector("[type=submit]").textContent = create ? "Create account" : "Sign in";
  signinForm.elements.password.autocomplete = create ? "new-password" : "current-password";
}

accountBtn.addEventListener("click", async () => {
  if (await currentUser()) {
    await signOut();
    await refreshAccount();
    onDataChange();
    return;
  }
  signinForm.reset();
  showError(signinError, "");
  setSigninMode(false);
  signinModal.showModal();
  signinForm.elements.email.focus();
});

$("signup-btn").addEventListener("click", () => setSigninMode(!creatingAccount));

signinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = signinForm.elements.email.value.trim();
  const password = signinForm.elements.password.value;
  if (!email || password.length < 6) {
    return showError(signinError, "Enter your email and a password of at least 6 characters.");
  }
  submitting(signinForm, signinError, creatingAccount ? "Creating…" : "Signing in…", async () => {
    if (creatingAccount) {
      const { session } = await signUp(email, password);
      if (!session) {
        signinModal.close();
        showNotice(`Almost there: we sent a confirmation link to ${email}. After you confirm, the admin will review your account.`);
        return;
      }
    } else {
      await signIn(email, password);
    }
    await refreshAccount();
    signinModal.close();
    onDataChange();
  });
});

// ---------- Members (admin) ----------

const membersModal = $("members-modal");
const membersError = $("members-error");

async function updateMembersBadge() {
  try {
    const pending = (await listMembers()).filter((m) => m.status === "pending").length;
    $("members-badge").textContent = pending;
    $("members-badge").hidden = !pending;
  } catch {
    $("members-badge").hidden = true;
  }
}

async function renderMembers() {
  let list;
  try {
    list = await listMembers();
  } catch (err) {
    return showError(membersError, friendlyError(err));
  }
  showError(membersError, "");
  const order = { pending: 0, approved: 1, rejected: 2 };
  list.sort((a, b) => order[a.status] - order[b.status] || a.created_at.localeCompare(b.created_at));

  const decide = (m, status) => async () => {
    try {
      await setMemberStatus(m.id, status);
    } catch (err) {
      return showError(membersError, friendlyError(err));
    }
    renderMembers();
    updateMembersBadge();
  };
  const joined = (iso) => {
    const d = new Date(iso);
    return `Joined ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  };

  const rows = list.map((m) => {
    const isMe = m.id === me.user.id;
    const label = isMe ? "Admin" : { pending: "Waiting", approved: "Approved", rejected: "Declined" }[m.status];
    const actions = isMe ? [] : {
      pending: [h("button", { class: "text-btn", type: "button", onclick: decide(m, "rejected") }, "Decline"),
                h("button", { class: "pill-btn dark", type: "button", onclick: decide(m, "approved") }, "Approve")],
      approved: [h("button", { class: "text-btn danger", type: "button", onclick: decide(m, "rejected") }, "Remove access")],
      rejected: [h("button", { class: "pill-btn light", type: "button", onclick: decide(m, "approved") }, "Approve")],
    }[m.status];
    return h("li", { class: "member-row" },
      h("div", { class: "member-info" },
        h("span", { class: "member-email" }, m.email || "(no email)"),
        h("span", { class: "member-meta" }, joined(m.created_at))),
      h("span", { class: `status-chip ${isMe ? "admin" : m.status}` }, label),
      h("div", { class: "member-actions" }, actions));
  });
  $("members-list").replaceChildren(...(rows.length ? rows : [h("li", { class: "member-row" }, "No accounts yet.")]));
}

$("members-btn").addEventListener("click", () => {
  membersModal.showModal();
  renderMembers();
});

// ---------- Photo picker fields ----------

function photoField(root) {
  const input = root.querySelector("input[type=file]");
  const img = root.querySelector("img");
  let file = null;     // newly chosen file
  let existing = null; // URL of the photo already saved
  let previewUrl = null;

  function show(src) {
    if (previewUrl && src !== previewUrl) URL.revokeObjectURL(previewUrl);
    if (src) img.src = src;
    else img.removeAttribute("src");
    root.classList.toggle("has-photo", !!src);
  }

  input.addEventListener("change", () => {
    const chosen = [...input.files].find((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    input.value = "";
    if (!chosen) return;
    file = chosen;
    show((previewUrl = URL.createObjectURL(chosen)));
  });

  return {
    get file() { return file; },
    get hasPhoto() { return !!(file || existing); },
    set(url) { file = null; existing = url || null; show(existing); },
  };
}

const coverField = photoField($("cover-field"));
const memoryPhotoField = photoField($("memory-photo-field"));

// ---------- Trip form ----------

const tripFormModal = $("trip-form-modal");
const tripForm = $("trip-form");
const tripFormError = $("trip-form-error");
let editingTrip = null;

function openTripForm(trip = null) {
  editingTrip = trip;
  tripForm.reset();
  showError(tripFormError, "");
  $("trip-form-title").textContent = trip ? "Edit trip" : "New trip";
  const f = tripForm.elements;
  if (trip) {
    f.title.value = trip.title;
    f.startDate.value = trip.startDate || "";
    f.endDate.value = trip.endDate || "";
    f.description.value = trip.description || "";
    f.tags.value = (trip.tags || []).join(", ");
  }
  coverField.set(trip ? coverOf(trip) : null);
  tripFormModal.showModal();
  f.title.focus();
}

tripForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = tripForm.elements;
  const title = f.title.value.trim();
  let startDate = f.startDate.value;
  let endDate = f.endDate.value;

  if (!coverField.hasPhoto) return showError(tripFormError, "Choose a cover photo for this trip.");
  if (!title) return showError(tripFormError, "Give the trip a place name, like “Kyoto, Japan”.");
  if (startDate && endDate && endDate < startDate) [startDate, endDate] = [endDate, startDate];
  if (!startDate && endDate) [startDate, endDate] = [endDate, ""];

  const fields = {
    title,
    startDate,
    endDate,
    description: f.description.value.trim(),
    tags: f.tags.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 6),
  };
  submitting(tripForm, tripFormError, "Saving…", async () => {
    const saved = await saveTrip(editingTrip, fields, coverField.file);
    trips = editingTrip ? replaceById(trips, saved) : [...trips, saved];
    tripFormModal.close();
    onDataChange();
  });
});

// ---------- Memory form ----------

const memoryFormModal = $("memory-form-modal");
const memoryForm = $("memory-form");
const memoryFormError = $("memory-form-error");
let editingMemory = null;

function openMemoryForm({ memory = null, tripId = null } = {}) {
  const choices = editableTrips();
  if (!memory && !choices.length) { openTripForm(); return; } // a memory needs a trip

  editingMemory = memory;
  memoryForm.reset();
  showError(memoryFormError, "");
  $("memory-form-title").textContent = memory ? "Edit memory" : "New memory";
  $("memory-delete").hidden = !memory;

  const f = memoryForm.elements;
  f.tripId.replaceChildren(...choices.map((t) => h("option", { value: t.id }, t.title)));
  f.tripId.value = memory?.tripId ?? (choices.some((t) => t.id === tripId) ? tripId : choices[0].id);
  if (memory) {
    f.title.value = memory.title;
    f.note.value = memory.note || "";
  }
  memoryPhotoField.set(memory?.photoUrl);
  memoryFormModal.showModal();
  f.title.focus();
}

memoryForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = memoryForm.elements;
  const title = f.title.value.trim();
  if (!title) return showError(memoryFormError, "Give this memory a title.");

  const fields = { tripId: Number(f.tripId.value), title, note: f.note.value.trim() };
  submitting(memoryForm, memoryFormError, "Saving…", async () => {
    const saved = await saveMemory(editingMemory, fields, memoryPhotoField.file);
    memories = editingMemory ? replaceById(memories, saved) : [...memories, saved];
    memoryFormModal.close();
    onDataChange();
  });
});

$("memory-delete").addEventListener("click", async () => {
  if (!editingMemory || !confirm("Delete this memory?")) return;
  try {
    await deleteMemory(editingMemory);
  } catch (err) {
    return showError(memoryFormError, friendlyError(err));
  }
  memories = memories.filter((m) => m.id !== editingMemory.id);
  memoryFormModal.close();
  onDataChange();
});

// ---------- Dialog plumbing (all dialogs on the page) ----------

for (const btn of document.querySelectorAll("[data-close]")) {
  btn.addEventListener("click", () => btn.closest("dialog").close());
}
// Clicking the dark backdrop closes a dialog.
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
}
