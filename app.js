import {
  watchUser,
  signIn,
  signUp,
  logOut,
  emailToUsername,
  watchItems,
  addItem,
  updateItem,
  deleteItem,
  importItem,
  watchCategories,
  addCategory,
  renameCategory,
  deleteCategory,
  restoreCategory,
  reorderCategories,
  changePassword,
  rememberName,
  watchHistory,
} from "./firebase.js";
import {
  initRecipes,
  startRecipes,
  stopRecipes,
  setRecipeItems,
  openRecipesView,
  closeRecipesView,
} from "./recipes.js";
import { initScan } from "./scan.js";
import { showIntro } from "./intro.js";

// Der varene lå lagret i nettleseren før vi tok i bruk Firebase
const LOCAL_KEY = "matlager";

// Visningsnavn for lagringsstedene
const LOCATIONS = {
  fryser: "Fryser",
  kjoleskap: "Kjøleskap",
  torrvarer: "Tørrvarer",
};

// Små ikoner (SVG) for lagringsstedene og knappene. Fargen styres av CSS.
const ICONS = {
  fryser: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 4l3 3 3-3M9 20l3-3 3 3"/></g></svg>`,
  kjoleskap: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M6 9h12M9 5v1.5M9 12v4"/></g></svg>`,
  minus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></g></svg>`,
  chevron: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  more: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></g></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  torrvarer: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M7 6h10a2 2 0 0 1 2 2v11a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a2 2 0 0 1 2-2z"/><path d="M5 13h14"/></g></svg>`,
};

// Sett inn ikonene der HTML-en har data-location-icon (fanene)
document.querySelectorAll("[data-location-icon]").forEach((el) => {
  el.innerHTML = ICONS[el.dataset.locationIcon];
});

// Alle varer: { id, name, location, quantity, unit, expires, added, note }
// added = tidspunkt varen ble lagt inn (mangler på varer fra før sortering kom)
// Bare name er påkrevd – quantity kan være null, unit og expires kan være ""
// Fylles fra Firebase når du er innlogget
let items = [];

// Varenavn du har brukt før: { name, unit, location } – brukes til å fylle inn enheten
let nameHistory = [];

// Kategorier: { id, name, location } – egne for hvert sted
let categories = [];

// Små innstillinger som huskes på denne enheten (fane og tema)
const TAB_KEY = "matlager-tab";
const THEME_KEY = "matlager-theme";
const SORT_KEY = "matlager-sort";

function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

// Kategorier som er lukket (pila ved overskriften) – huskes på denne enheten
const COLLAPSED_KEY = "matlager-collapsed";
let collapsed = new Set();
try {
  collapsed = new Set(JSON.parse(readSetting(COLLAPSED_KEY)) || []);
} catch {}

function toggleCollapsed(key) {
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  saveSetting(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  render();
}

// Fanen som er valgt nå – starter på den du var på sist
let current = LOCATIONS[readSetting(TAB_KEY)] ? readSetting(TAB_KEY) : "fryser";

// Elementer fra index.html vi trenger
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const sortButtons = document.querySelectorAll("#sort [data-sort]");
const searchClear = document.getElementById("search-clear");
// Tittellinjen over listen: "Fryser 12 varer" + menyen med sortering
const listHeader = document.getElementById("list-header");
const listIcon = document.getElementById("list-icon");
const listTitle = document.getElementById("list-title");
const listCount = document.getElementById("list-count");
const listMenu = document.getElementById("list-menu");
const offlineBanner = document.getElementById("offline");
const demoBanner = document.getElementById("demo-banner");

// Demobruker (se README): alle kan logge inn og se, ingen kan endre
const DEMO_USER = "demo";
let isDemo = false;

// Dagen demodataene ble lagt inn. For demobrukeren flyttes alle utløpsdatoer
// like mange dager fram som det har gått siden, så "går ut i morgen" alltid er
// i morgen. Endres hvis demodataene legges inn på nytt.
const DEMO_SEEDED = new Date(2026, 9, 28); // 28. oktober 2026 (måned 9 = oktober)

// Introduksjonen vises automatisk én gang per bruker på denne enheten for nye
// brukere (ingen varer ennå) – og for demobrukeren hver gang noen logger inn
const INTRO_KEY = "matlager-intro-";
let justSignedIn = false; // logget inn med skjemaet nå (ikke husket fra sist)

function maybeShowIntro(username) {
  const demoLogin = isDemo && justSignedIn;
  justSignedIn = false;
  if (demoLogin) {
    startIntro();
    return;
  }
  if (readSetting(INTRO_KEY + username)) return;
  if (!isDemo && items.length > 0) return; // har brukt appen før
  startIntro(() => saveSetting(INTRO_KEY + username, "1"));
}

// Introduksjonen lyser opp knapper i varevisningen – sørg for at den vises
function startIntro(done) {
  closeRecipesView();
  if (!wideScreen.matches && addCard.open) addCard.close();
  window.scrollTo(0, 0);
  showIntro({ demo: isDemo, done, openRecipes: openRecipesView, closeRecipes: closeRecipesView });
}

document.getElementById("show-intro").addEventListener("click", () => {
  menu.open = false;
  startIntro();
});

function shiftDemoDate(expires) {
  if (!expires) return expires;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSince = Math.round((today - DEMO_SEEDED) / 86400000);
  const [y, m, d] = expires.split("-").map(Number);
  const date = new Date(y, m - 1, d + daysSince);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const editDelete = document.getElementById("edit-delete");

// Varen som nettopp ble lagt til – lyser kort opp i listen
let highlightId = null;

// Tekst når en fane er tom
const EMPTY_TEXT = {
  fryser: "Fryseren er tom.",
  kjoleskap: "Kjøleskapet er tomt.",
  torrvarer: "Ingen tørrvarer ennå.",
};
const form = document.getElementById("add-form");
const addCard = document.getElementById("add-card"); // <dialog> med skjemaet
const addOpenBtn = document.getElementById("add-open");
const scanFab = document.getElementById("scan-fab"); // kameraknappen over + (mobil)
const addCloseBtn = document.getElementById("add-close");
const addConfirm = document.getElementById("add-confirm");
const locationButtons = document.querySelectorAll("[data-add-location]");
const nameInput = document.getElementById("name");
const qtyInput = document.getElementById("quantity");
const unitSelect = document.getElementById("unit");
const expiresInput = document.getElementById("expires");
const noteInput = document.getElementById("note");
const showDateBtn = document.getElementById("show-date");
const clearDateBtn = document.getElementById("clear-date");
const showNoteBtn = document.getElementById("show-note");
const dateSection = document.getElementById("date-section");
const searchInput = document.getElementById("search");
const expiringSection = document.getElementById("expiring");
const expiringCount = document.getElementById("expiring-count");
const expiringList = document.getElementById("expiring-list");
const expiringToggle = document.getElementById("expiring-toggle");
const tabs = document.querySelectorAll(".tab");

// Melding nederst ("… ble slettet – Angre")
const toast = document.getElementById("toast");
const toastText = document.getElementById("toast-text");
const toastButton = document.getElementById("toast-action");

// Meny og bytt passord
const menu = document.getElementById("menu");
const themeButtons = document.querySelectorAll("[data-theme-choice]");
const userInitial = document.getElementById("user-initial");
const userName = document.getElementById("user-name");
const changePasswordBtn = document.getElementById("change-password");
const passwordDialog = document.getElementById("password-dialog");
const passwordForm = document.getElementById("password-form");
const currentPasswordInput = document.getElementById("current-password");
const newPasswordInput = document.getElementById("new-password");
const repeatPasswordInput = document.getElementById("repeat-password");
const passwordError = document.getElementById("password-error");
const passwordCancel = document.getElementById("password-cancel");

// Redigeringsvinduet
const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editName = document.getElementById("edit-name");
const editQty = document.getElementById("edit-quantity");
const editUnit = document.getElementById("edit-unit");
const editLocation = document.getElementById("edit-location");
const editExpires = document.getElementById("edit-expires");
const editNote = document.getElementById("edit-note");
const editCategory = document.getElementById("edit-category");

// Kategorier
const newCategoryBtn = document.getElementById("new-category");
const showCategoryBtn = document.getElementById("show-category");
const categorySection = document.getElementById("category-section");
const categoryDialog = document.getElementById("category-dialog");
const categoryForm = document.getElementById("category-form");
const categoryTitle = document.getElementById("category-title");
const categoryNameInput = document.getElementById("category-name");
const categoryError = document.getElementById("category-error");
const categoryDeleteBtn = document.getElementById("category-delete");
const categoryCancel = document.getElementById("category-cancel");
const editCancel = document.getElementById("edit-cancel");

// Hvilken vare som redigeres nå
let editingId = null;

// Innlogging
const loadingEl = document.getElementById("loading");
const loginSection = document.getElementById("login");
const loginForm = document.getElementById("login-form");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginError = document.getElementById("login-error");
const loginTitle = document.getElementById("login-title");
const repeatLabel = document.getElementById("repeat-label");
const passwordRepeatInput = document.getElementById("password-repeat");
const loginSubmit = document.getElementById("login-submit");
const loginSwitch = document.getElementById("login-switch");
const appSection = document.getElementById("app");
const userLabel = document.getElementById("user-label");
const logoutBtn = document.getElementById("logout");

// Stopper lyttingen på varer og historikk (settes når man logger inn)
let stopWatchingItems = null;
let stopWatchingHistory = null;
let stopWatchingCategories = null;

// ---------- Flytte gamle varer ----------

// Varer som lå i nettleseren fra før lastes opp til kontoen én gang,
// og flyttes så til "matlager-backup" så de ikke lastes opp igjen.
function migrateLocalItems() {
  let oldItems;
  try {
    oldItems = JSON.parse(localStorage.getItem(LOCAL_KEY)) || [];
  } catch {
    return;
  }
  if (oldItems.length === 0) return;

  for (const item of oldItems) {
    importItem({ expires: "", ...item }).catch(showError);
  }
  localStorage.setItem(LOCAL_KEY + "-backup", JSON.stringify(oldItems));
  localStorage.removeItem(LOCAL_KEY);
}

// Vis feil ved lagring (f.eks. manglende tilgang)
function showError(error) {
  console.error(error);
  // Demobrukeren: Firestore sier nei til endringer – forklar i stedet for å vise en feil
  if (isDemo && error?.code === "permission-denied") {
    showToast("Dette er en demobruker – endringer lagres ikke");
    return;
  }
  alert("Noe gikk galt ved lagring: " + error.message);
}

// ---------- Visning ----------

// Tegn listen på nytt: søketreff fra alle steder, ellers valgt fane
function render() {
  updateCounts();
  listEl.innerHTML = "";

  const query = searchInput.value.trim().toLowerCase();
  const searching = query !== "";
  addCard.hidden = searching; // skjul "legg til" mens man søker
  addOpenBtn.hidden = searching;
  scanFab.hidden = searching;
  document.body.classList.toggle("searching", searching);

  const visible = items
    .filter((item) =>
      searching
        ? `${item.name} ${item.note || ""}`.toLowerCase().includes(query) // navn og notat
        : item.location === current
    )
    .sort(SORTERS[sortBy]);

  if (searching) {
    for (const item of visible) listEl.append(createItemRow(item, true));
  } else {
    renderGroups(visible);
  }
  markGroupEdges();

  // Tom liste, f.eks. "Ingen tørrvarer ennå."
  emptyEl.textContent = searching
    ? `Ingen treff på «${searchInput.value.trim()}».`
    : EMPTY_TEXT[current];
  // Har fanen kategorier, vises overskriftene selv om den er tom
  emptyEl.hidden = visible.length > 0 || (!searching && categoriesFor(current).length > 0);
  newCategoryBtn.hidden = searching;
  searchClear.hidden = !searching;
  renderListHeader(searching, visible.length);

  renderExpiring(searching);
  renderCategoryChips(); // kategoriene i "Legg til" kan ha endret seg
}

// Tittellinjen: "Fryser 12 varer" med stedets ikon og farge,
// eller "3 treff i alle steder" mens man søker
function renderListHeader(searching, count) {
  listHeader.dataset.location = searching ? "" : current;
  listHeader.classList.toggle("searching", searching);
  listIcon.innerHTML = searching ? "" : ICONS[current];
  listTitle.textContent = searching ? `${count} treff` : LOCATIONS[current];
  listCount.textContent = searching
    ? "i alle steder"
    : `${count} ${count === 1 ? "vare" : "varer"}`;
}

// Varene i hver gruppe vises som ett kort: første og siste rad får runde hjørner
function markGroupEdges() {
  let previous = null;
  for (const li of listEl.children) {
    const isRow = li.classList.contains("swipe-row");
    const previousIsRow = previous?.classList.contains("swipe-row");
    if (isRow && !previousIsRow) li.classList.add("first");
    if (previousIsRow && !isRow) previous.classList.add("last");
    previous = li;
  }
  if (previous?.classList.contains("swipe-row")) previous.classList.add("last");
}

// Kategoriene for et sted, i valgt rekkefølge (order). Kategorier uten
// order (fra før man kunne flytte dem) kommer først, alfabetisk.
function categoriesFor(location) {
  return categories
    .filter((c) => c.location === location)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "no"));
}

function categoryName(id) {
  const category = categories.find((c) => c.id === id);
  return category ? category.name : "";
}

// Listen gruppert: én overskrift per kategori, varer uten kategori under "Andre".
// Har fanen ingen kategorier, vises varene uten overskrifter (som før).
function renderGroups(visible) {
  const cats = categoriesFor(current);
  if (cats.length === 0) {
    for (const item of visible) listEl.append(createItemRow(item, false));
    return;
  }

  for (const cat of cats) {
    const inCategory = visible.filter((item) => item.category === cat.id);
    const isClosed = collapsed.has(cat.id);
    listEl.append(createCategoryHeading(cat, cat.id, inCategory.length, isClosed));
    if (isClosed) continue;
    if (inCategory.length === 0) {
      const empty = document.createElement("li");
      empty.className = "category-empty";
      empty.textContent = "Ingen varer ennå";
      empty.dataset.group = cat.id; // man kan slippe varer her
      listEl.append(empty);
    }
    for (const item of inCategory) {
      const row = createItemRow(item, false);
      row.dataset.group = cat.id;
      listEl.append(row);
    }
  }

  const ids = new Set(cats.map((c) => c.id));
  const others = visible.filter((item) => !ids.has(item.category));
  if (others.length > 0) {
    const key = `andre-${current}`; // "Andre" lukkes per sted
    const isClosed = collapsed.has(key);
    listEl.append(createCategoryHeading(null, key, others.length, isClosed));
    if (!isClosed) {
      for (const item of others) {
        const row = createItemRow(item, false);
        row.dataset.group = "";
        listEl.append(row);
      }
    }
  }
}

// Overskrift: [▾ NAVN antall] lukker/åpner, ⋯ = endre/slett, + = legg til vare.
// cat = null betyr "Andre" (varer uten kategori – kan ikke endres).
function createCategoryHeading(cat, key, count, isClosed) {
  const li = document.createElement("li");
  li.className = "category-heading";
  li.dataset.group = cat ? cat.id : ""; // slippmål ved dra og slipp
  if (isClosed) li.classList.add("closed");

  const label = cat ? cat.name : "Andre";

  // Pil + navn + antall: ett trykk lukker eller åpner kategorien
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "category-toggle";
  toggle.dataset.catAction = "toggle";
  toggle.dataset.catKey = key;
  toggle.setAttribute("aria-expanded", !isClosed);
  toggle.innerHTML = ICONS.chevron;
  const name = document.createElement("span");
  name.className = "category-name";
  name.textContent = label;
  const countEl = document.createElement("span");
  countEl.className = "category-count";
  countEl.textContent = count;
  toggle.append(name, countEl);

  const actions = document.createElement("div");
  actions.className = "category-actions";

  if (cat) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "category-icon";
    more.innerHTML = ICONS.more;
    more.dataset.catAction = "manage";
    more.dataset.catId = cat.id;
    more.setAttribute("aria-label", `Endre eller slett ${label}`);
    more.title = "Endre eller slett kategori";
    actions.append(more);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "category-icon";
  add.innerHTML = ICONS.plus;
  add.dataset.catAction = "add";
  add.dataset.catId = cat ? cat.id : "";
  add.setAttribute("aria-label", `Legg til vare i ${label}`);
  add.title = `Legg til vare i ${label}`;
  actions.append(add);

  li.append(toggle, actions);
  return li;
}

// Én rad i listen. searching = vis sted og kategori i infolinjen.
function createItemRow(item, searching) {
  // Ytre lag: rødt felt med søppelbøtte som kommer fram når man sveiper
  const li = document.createElement("li");
  li.className = "swipe-row";
  const swipeDelete = document.createElement("div");
  swipeDelete.className = "swipe-delete";
  swipeDelete.innerHTML = ICONS.trash;

  // Selve raden – ligger oppå, og flyttes med fingeren ved sveip
  const row = document.createElement("div");
  row.className = "item";
  row.dataset.id = item.id;
  row.dataset.action = "edit"; // trykk hvor som helst på raden for å redigere
  if (item.id === highlightId) row.classList.add("just-added");

  // Navn + infolinje
  const info = document.createElement("div");
  info.className = "item-info";

  const name = document.createElement("span");
  name.className = "item-name";
  name.textContent = item.name;
  info.append(name);

  // Går ut snart / har gått ut: farget merkelapp ved navnet, f.eks. "I morgen"
  const expiry = expiryInfo(item);
  if (expiry?.status) {
    row.classList.add(expiry.status);
    name.append(" ", createBadge(expiry));
  }

  // Notat (én linje, kuttes med … hvis det er langt)
  if (item.note) {
    const note = document.createElement("small");
    note.className = "item-note";
    note.textContent = item.note;
    info.append(note);
  }

  // Infolinje under navnet, f.eks. "24. okt." (datoen vises bare når den ikke er nær)
  const meta = [];
  if (searching) {
    meta.push(LOCATIONS[item.location]); // vis hvor varen ligger
    if (categoryName(item.category)) meta.push(categoryName(item.category));
  }
  if (expiry && !expiry.status) meta.push(expiry.date);
  if (meta.length) {
    const small = document.createElement("small");
    small.className = "item-meta";
    small.textContent = meta.join(" · ");
    info.append(small);
  }

  // Antallet – trykk for å skrive inn et nytt tall
  const qty = document.createElement("span");
  qty.className = "item-qty";
  qty.dataset.action = "qty";
  qty.textContent = formatQty(item);

  row.append(
    info,
    makeButton(ICONS.minus, "minus", "Én mindre"),
    qty,
    makeButton(ICONS.plus, "plus", "Én mer"),
    makeButton(ICONS.trash, "delete", "Slett") // vises bare ved hover på PC
  );
  li.append(swipeDelete, row);
  return li;
}

// Skriv antall varer på hver fane, f.eks. "Fryser (4)"
function updateCounts() {
  tabs.forEach((tab) => {
    const count = items.filter((i) => i.location === tab.dataset.location).length;
    tab.querySelector(".count").textContent = count ? `(${count})` : "";
  });
}

// Knapp med ikon. label leses opp av skjermlesere og vises ved hover.
function makeButton(icon, action, label) {
  const btn = document.createElement("button");
  btn.innerHTML = icon;
  btn.className = action;
  btn.dataset.action = action;
  btn.setAttribute("aria-label", label);
  btn.title = label;
  return btn;
}

// Tekst og fargestatus for utløpsdatoen (null hvis varen ikke har dato)
function expiryInfo(item) {
  if (!item.expires) return null;

  const [y, m, d] = item.expires.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((date - today) / 86400000); // ms per døgn
  const pretty = date.toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  // Kort dato under navnet: "24. okt." – året bare når det ikke er i år
  const shortDate = date.toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "short",
    ...(y !== today.getFullYear() && { year: "numeric" }),
  });

  // text = hele setningen, short = merkelappen ("I morgen"), date = kort dato
  const info = (text, short, status) => ({ text, short, status, daysLeft, date: shortDate });
  if (daysLeft === -1) return info("Gikk ut i går", "Gikk ut", "expired");
  if (daysLeft < 0) return info(`Gikk ut ${pretty}`, "Gikk ut", "expired");
  if (daysLeft === 0) return info("Går ut i dag", "I dag", "soon");
  if (daysLeft === 1) return info("Går ut i morgen", "I morgen", "soon");
  if (daysLeft <= EXPIRING_DAYS) return info(`Går ut ${pretty}`, `${daysLeft} dager`, "soon");
  return info(`Går ut ${pretty}`, shortDate, null);
}

// Farget merkelapp: rød "Gikk ut", gul "I dag" / "I morgen" / "2 dager"
function createBadge(expiry) {
  const badge = document.createElement("span");
  badge.className = `badge ${expiry.status}`;
  badge.textContent = expiry.short;
  badge.title = expiry.text;
  return badge;
}

// Hvor mange dager før utløp en vare regnes som "går snart ut" (gul farge)
const EXPIRING_DAYS = 3;

// Antall utgåtte varer nå (lagres sammen med valget ditt)
let expiredCount = 0;

// Om du selv har skjult/vist "Bruk snart": { open, expired } (null = ikke valgt)
const EXPIRING_KEY = "matlager-utlop";

function readExpiringChoice() {
  try {
    return JSON.parse(readSetting(EXPIRING_KEY));
  } catch {
    return null;
  }
}

function setExpiringOpen(open) {
  expiringSection.classList.toggle("closed", !open);
  expiringToggle.setAttribute("aria-expanded", open);
}

// Trykk på "Bruk snart": skjul/vis kortene og husk valget
expiringToggle.addEventListener("click", () => {
  const open = expiringSection.classList.contains("closed");
  setExpiringOpen(open);
  saveSetting(EXPIRING_KEY, JSON.stringify({ open, expired: expiredCount }));
});

// Tegn "Bruk snart": ett kort per vare fra alle steder – de som har gått ut
// først, så de som går ut innen EXPIRING_DAYS dager
function renderExpiring(searching) {
  const withDate = items.filter((item) => item.expires).sort(compareItems);
  const expired = withDate.filter((item) => expiryInfo(item).daysLeft < 0);
  const soon = withDate.filter((item) => {
    const days = expiryInfo(item).daysLeft;
    return days >= 0 && days <= EXPIRING_DAYS;
  });
  const total = expired.length + soon.length;

  expiringSection.hidden = searching || total === 0;
  expiringSection.classList.toggle("has-expired", expired.length > 0);

  // Har du selv skjult eller vist kortene, huskes det (også etter oppdatering av
  // siden) – helt til flere varer har gått ut enn da du valgte. Ellers vises de.
  const choice = readExpiringChoice();
  setExpiringOpen(choice && expired.length <= choice.expired ? choice.open : true);
  expiredCount = expired.length;
  expiringCount.textContent = `(${total})`;
  expiringList.innerHTML = "";

  for (const item of [...expired, ...soon]) {
    const expiry = expiryInfo(item);
    const li = document.createElement("li");
    const card = document.createElement("button");
    card.type = "button";
    card.className = `expiring-card ${expiry.status}`;
    card.dataset.id = item.id;
    card.dataset.location = item.location; // gir --loc til ikonet
    card.title = `${item.name} – ${LOCATIONS[item.location]} – ${expiry.text}`;

    const name = document.createElement("span");
    name.className = "expiring-name";
    name.textContent = item.name;

    // Nederst: lite stedsikon til venstre, merkelapp til høyre
    const footer = document.createElement("span");
    footer.className = "expiring-footer";
    const icon = document.createElement("span");
    icon.className = "loc-icon";
    icon.innerHTML = ICONS[item.location];
    footer.append(icon, createBadge(expiry));

    card.append(name, footer);
    li.append(card);
    expiringList.append(li);
  }
}

// Sortering: varer med dato først (snarest øverst), så resten alfabetisk
function compareItems(a, b) {
  if (a.expires && !b.expires) return -1;
  if (!a.expires && b.expires) return 1;
  if (a.expires && b.expires && a.expires !== b.expires) {
    return a.expires.localeCompare(b.expires);
  }
  return a.name.localeCompare(b.name, "no");
}

// ---------- Sortering ----------

// De ulike måtene listen kan sorteres på (valgt i "Sorter"-menyen)
const SORTERS = {
  expires: compareItems, // det som går ut snarest øverst
  name: (a, b) => a.name.localeCompare(b.name, "no"),
  // nyeste øverst – varer uten tidspunkt (fra før) havner nederst
  added: (a, b) => (b.added || 0) - (a.added || 0) || a.name.localeCompare(b.name, "no"),
};

// Valgt sortering – huskes på denne enheten
let sortBy = SORTERS[readSetting(SORT_KEY)] ? readSetting(SORT_KEY) : "expires";

// Den valgte sorteringen får en hake i menyen
function markSort() {
  sortButtons.forEach((btn) => btn.setAttribute("aria-pressed", btn.dataset.sort === sortBy));
}
markSort();

sortButtons.forEach((btn) =>
  btn.addEventListener("click", () => {
    sortBy = btn.dataset.sort;
    saveSetting(SORT_KEY, sortBy);
    markSort();
    listMenu.open = false;
    render();
  })
);

// "3 stk", "3" eller "" – viser bare det som er fylt ut
function formatQty(item) {
  if (item.quantity == null) return "";
  const number = item.quantity.toLocaleString("nb-NO"); // 0,5 i stedet for 0.5
  return `${number} ${item.unit || ""}`.trim();
}

// Hvor mye + og – endrer antallet, avhengig av enheten
function stepFor(unit) {
  if (unit === "g") return 100;
  if (unit === "kg") return 0.5;
  if (unit === "l") return 0.25;
  return 1;
}

// Unngå tall som 0.30000000000000004 (vanlig avrundingsfeil i datamaskiner)
function roundQty(number) {
  return Math.round(number * 100) / 100;
}

// Bytt ut antallet med et felt der man kan skrive inn et nytt tall.
// Enter eller trykk utenfor lagrer, Escape avbryter.
function editQtyInline(qtyEl, item) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "any";
  input.inputMode = "decimal";
  input.className = "qty-input";
  input.value = item.quantity ?? "";
  qtyEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  function finish(save) {
    if (done) return;
    done = true;
    if (save) {
      const quantity = input.value === "" ? null : Number(input.value);
      if (quantity !== item.quantity) updateItem(item.id, { quantity }).catch(showError);
    }
    render();
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

// ---------- Melding nederst (Angre / Vis) ----------

let toastTimer = null;
let toastAction = null;

// Vis en melding nederst i 6 sekunder. Med onAction vises en knapp
// (standard "Angre", men teksten kan endres, f.eks. til "Vis").
function showToast(text, onAction, actionLabel = "Angre") {
  toastText.textContent = text;
  toastAction = onAction || null;
  toastButton.textContent = actionLabel;
  toastButton.hidden = !onAction;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 6000);
}

toastButton.addEventListener("click", () => {
  if (toastAction) toastAction();
  toastAction = null;
  toast.hidden = true;
});

// Slett en vare, men la brukeren angre i 6 sekunder
function deleteWithUndo(item, text) {
  deleteItem(item.id).catch(showError);
  // Legg varen tilbake med samme id hvis man trykker Angre
  showToast(text, () => importItem({ ...item }).catch(showError));
}

// ---------- Kjente varer (fyller inn enhet automatisk) ----------

// Finn en vare du har hatt før med dette navnet (null hvis ingen)
function findKnown(name) {
  const lower = name.trim().toLowerCase();
  return (
    nameHistory.find((h) => h.name.toLowerCase() === lower) ||
    items.find((i) => i.name.toLowerCase() === lower) ||
    null
  );
}

// ---------- Hendelser ----------

// Marker fanen som er valgt
function markActiveTab() {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.location === current));
}
markActiveTab(); // når siden åpnes: fanen du var på sist

// Bytt fane (og husk den til neste gang). "Legg til"-skjemaet følger med.
function selectTab(location) {
  current = location;
  saveSetting(TAB_KEY, current);
  searchInput.value = ""; // bytte fane avslutter søket
  markActiveTab();
  setAddLocation(current);
  render();
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    selectTab(tab.dataset.location);
    closeRecipesView(); // menyen nederst: et sted tar deg tilbake til varene
  });
});

// Mobil: menyen nederst (stedene er vanlige faner, se over) og "Oppskrifter"
const bottomNav = document.getElementById("bottom-nav");
document.getElementById("nav-recipes").addEventListener("click", openRecipesView);

// ---------- "Legg til": vindu på mobil, fast kort på PC ----------

// Bred skjerm (PC) – samme grense som i style.css
const wideScreen = matchMedia("(min-width: 900px)");

// PC: skjemaet ligger alltid åpent i venstre kolonne (show = uten mørk bakgrunn).
// Mobil: skjemaet er lukket til man trykker "+ Legg til vare".
function placeAddForm() {
  if (addCard.open) addCard.close();
  if (wideScreen.matches) addCard.show();
}
placeAddForm();
wideScreen.addEventListener("change", placeAddForm); // f.eks. når vinduet gjøres smalere

// Mobil: åpne vinduet. Stedet følger fanen du står på.
addOpenBtn.addEventListener("click", () => {
  setAddLocation(current);
  setAddCategory("");
  addConfirm.hidden = true;
  resetAddExtras();
  addCard.showModal(); // nameInput har autofocus, så tastaturet kommer opp
});

addCloseBtn.addEventListener("click", () => addCard.close());

// Mobil: trykk på det mørke feltet utenfor vinduet lukker det
addCard.addEventListener("click", (event) => {
  if (wideScreen.matches) return;
  const box = addCard.getBoundingClientRect();
  const outside =
    event.clientX < box.left || event.clientX > box.right ||
    event.clientY < box.top || event.clientY > box.bottom;
  if (outside) addCard.close();
});

// Kort bekreftelse i skjemaet: "✓ Kjøttdeig lagt til i Fryser"
let confirmTimer = null;
function showAddConfirm(text) {
  addConfirm.textContent = text;
  addConfirm.hidden = false;
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => (addConfirm.hidden = true), 3000);
}

// ---------- Sted i "Legg til"-skjemaet ----------

// Hvor nye varer legges – alltid det samme som fanen du står på
let addTo = current;
// Valgt kategori i skjemaet ("" = ingen)
let addCategoryId = "";

function setAddLocation(location) {
  addTo = location;
  locationButtons.forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.addLocation === location);
  });
  renderCategoryChips(); // kategoriene hører til stedet
}

// ---------- Kategori i "Legg til" ----------

function setAddCategory(id) {
  addCategoryId = id;
  renderCategoryChips();
}

// Knapper for kategoriene på valgt sted, og "+ Ny"
function renderCategoryChips() {
  const cats = categoriesFor(addTo);
  // Valgt kategori finnes ikke her (annet sted, eller slettet)? Da ingen.
  if (!cats.some((c) => c.id === addCategoryId)) addCategoryId = "";

  categorySection.innerHTML = "";
  for (const cat of cats) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = cat.name;
    button.dataset.categoryId = cat.id;
    button.setAttribute("aria-pressed", cat.id === addCategoryId);
    categorySection.append(button);
  }
  const newButton = document.createElement("button");
  newButton.type = "button";
  newButton.className = "new-chip";
  newButton.textContent = "+ Ny";
  newButton.dataset.newCategory = "true";
  categorySection.append(newButton);

  updateCategoryButton();
}

// Kategoriknappen: navnet når en er valgt, "− Kategori" når åpen, ellers "+ Kategori"
function updateCategoryButton() {
  const name = categoryName(addCategoryId);
  const open = !categorySection.hidden;
  showCategoryBtn.textContent = name || (open ? "− Kategori" : "+ Kategori");
  showCategoryBtn.classList.toggle("has-value", Boolean(name));
  showCategoryBtn.classList.toggle("open", open && !name);
}

showCategoryBtn.addEventListener("click", () => {
  categorySection.hidden = !categorySection.hidden;
  updateCategoryButton();
});

// Velg (eller fjern) kategori, eller lag en ny
categorySection.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.newCategory) {
    openCategoryDialog(null, true);
    return;
  }
  const id = button.dataset.categoryId;
  setAddCategory(id === addCategoryId ? "" : id); // trykk på valgt = fjern
  categorySection.hidden = true;
  updateCategoryButton();
});

// + ved en overskrift: legg til vare rett i den kategorien
function startAddInCategory(id) {
  setAddLocation(current);
  setAddCategory(id);
  resetAddExtras();
  if (wideScreen.matches) {
    nameInput.focus(); // PC: skjemaet står allerede åpent
  } else {
    addConfirm.hidden = true;
    addCard.showModal();
  }
}
setAddLocation(current);

// Trykk på et sted i skjemaet: bytt fane også, så du ser hva som ligger der
locationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectTab(button.dataset.addLocation);
  });
});

// Kjent vare? Fyll inn enheten automatisk (hvis du ikke har valgt en selv).
// Stedet endres aldri automatisk – det følger fanen du står på.
nameInput.addEventListener("input", () => {
  const known = findKnown(nameInput.value);
  if (known && known.unit && unitSelect.value === "") {
    unitSelect.value = known.unit;
  }
  // Samme kategori som sist – men bare hvis den finnes på stedet du står
  if (known && known.category && !addCategoryId &&
      categoriesFor(addTo).some((c) => c.id === known.category)) {
    setAddCategory(known.category);
  }
});

// Søk: tegn listen på nytt for hver bokstav
searchInput.addEventListener("input", render);

// ✕ i søkefeltet tømmer søket
searchClear.addEventListener("click", () => {
  searchInput.value = "";
  render();
  searchInput.focus();
});

// Legg til ny vare
form.addEventListener("submit", (event) => {
  event.preventDefault(); // hindrer at siden lastes på nytt

  const name = nameInput.value.trim();
  // Tomt antall lagres som null (= ikke fylt ut)
  const quantity = qtyInput.value === "" ? null : Number(qtyInput.value);
  if (!name) return;

  const newItem = {
    name,
    location: addTo,
    quantity,
    unit: unitSelect.value,
    expires: expiresInput.value, // "" hvis ingen dato
    note: noteInput.value.trim(), // "" hvis ikke fylt ut
    category: addCategoryId, // "" hvis ingen
    added: Date.now(), // til sorteringen "Sist lagt til"
  };
  // Listen oppdateres automatisk via watchItems. Den nye varen lyser kort opp.
  const { id, saved } = addItem(newItem);
  saved.catch(showError);
  highlightId = id;
  setTimeout(() => {
    if (highlightId === id) highlightId = null;
  }, 2000);
  rememberName(newItem).catch(showError); // husk enheten til neste gang

  showAddConfirm(`✓ ${name} lagt til i ${LOCATIONS[addTo]}`);

  // Klar for neste vare: tomt skjema (vinduet blir stående åpent)
  form.reset();
  resetAddExtras(); // lukk utløpsdato og notat igjen
  nameInput.focus();
});

// +, –, slett og rediger (ett felles lytteroppsett for hele listen)
listEl.addEventListener("click", (event) => {
  // Rett etter et sveip: ikke åpne redigering
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  // Overskrift: navnet = endre/slett kategori, + = legg til vare i den
  const catTarget = event.target.closest("[data-cat-action]");
  if (catTarget) {
    const catAction = catTarget.dataset.catAction;
    if (catAction === "toggle") {
      toggleCollapsed(catTarget.dataset.catKey);
    } else if (catAction === "manage") {
      openCategoryDialog(categories.find((c) => c.id === catTarget.dataset.catId), false);
    } else {
      startAddInCategory(catTarget.dataset.catId);
    }
    return;
  }
  // Finn nærmeste element med en handling (så klikk på teksten inni også virker)
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  const id = target.closest(".item").dataset.id;
  const item = items.find((i) => i.id === id);
  if (!item) return;

  if (action === "edit") {
    openEdit(item);
    return;
  }
  if (action === "qty") {
    editQtyInline(target, item);
    return;
  }

  // Endringene sendes til Firebase – listen oppdateres automatisk via watchItems
  const step = stepFor(item.unit);
  if (action === "delete") {
    deleteWithUndo(item, `${item.name} ble slettet`);
    return;
  }

  if (action === "plus") {
    // tomt antall blir ett steg (f.eks. 1 stk eller 100 g)
    const quantity = roundQty((item.quantity ?? 0) + step);
    updateItem(id, { quantity }).catch(showError);
  } else if (action === "minus") {
    if (item.quantity == null) return; // ingenting å trekke fra
    const quantity = roundQty(Math.max(0, item.quantity - step));
    if (quantity === 0) {
      deleteWithUndo(item, `${item.name} er tom og ble slettet`);
    } else {
      updateItem(id, { quantity }).catch(showError);
    }
  }
});

// ---------- Sveip mot venstre for å slette (mobil) ----------

// Hvor langt (andel av bredden) man må sveipe før varen slettes
const SWIPE_DELETE = 0.35;
let swipe = null; // pågående sveip: { row, pointerId, startX, startY, dx, active }
let suppressClick = false;

listEl.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse") return; // på PC brukes søppelbøtta
  const row = event.target.closest(".item");
  if (!row || event.target.closest("button, input")) return;
  swipe = {
    row,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    dx: 0,
    active: false,
  };
});

listEl.addEventListener("pointermove", (event) => {
  if (drag || !swipe || event.pointerId !== swipe.pointerId) return;
  const dx = event.clientX - swipe.startX;
  const dy = event.clientY - swipe.startY;

  if (!swipe.active) {
    if (Math.abs(dy) > 10) {
      swipe = null; // fingeren beveger seg opp/ned: det er bla, ikke sveip
      return;
    }
    if (Math.abs(dx) < 10) return; // for lite til å avgjøre ennå
    swipe.active = true;
    swipe.row.setPointerCapture(event.pointerId);
    swipe.row.parentElement.classList.add("swiping"); // vis det røde feltet
  }

  swipe.dx = Math.min(0, dx); // bare mot venstre
  swipe.row.style.transform = `translateX(${swipe.dx}px)`;
});

function endSwipe(cancelled) {
  if (!swipe) return;
  const { row, dx, active } = swipe;
  swipe = null;
  if (!active) return;

  // Fingeren slippes: ikke la det telle som et trykk på raden
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 400);

  const li = row.parentElement;
  row.style.transition = "transform 0.2s ease-out";

  if (!cancelled && -dx > row.offsetWidth * SWIPE_DELETE) {
    // Langt nok: skyv raden ut og slett (med "Angre")
    row.style.transform = "translateX(-100%)";
    const item = items.find((i) => i.id === row.dataset.id);
    setTimeout(() => {
      if (item) deleteWithUndo(item, `${item.name} ble slettet`);
    }, 200);
  } else {
    // Ikke langt nok: gli tilbake
    row.style.transform = "";
    setTimeout(() => {
      row.style.transition = "";
      li.classList.remove("swiping");
    }, 200);
  }
}

listEl.addEventListener("pointerup", () => endSwipe(false));
listEl.addEventListener("pointercancel", () => endSwipe(true));

// ---------- Hold inne og dra for å flytte en vare til en annen kategori ----------

const LONG_PRESS_MS = 450; // så lenge må man holde inne på mobil
let press = null; // trykk som kan bli en flytting: { kind, el, item/categoryId, pointerId, startX, startY, isMouse, timer }
let drag = null; // pågående flytting: { kind, el, …, ghost, height, offsetY, lastY, group, before, tempAndre }

// Flytting gir bare mening i en fane med kategorier, og ikke under søk
function canDrag() {
  return searchInput.value.trim() === "" && categoriesFor(current).length > 0;
}

// Hold inne (mobil) eller dra med musa (PC) på:
//  - en vare: flytt den til en annen kategori
//  - en overskrift: endre rekkefølgen på kategoriene
listEl.addEventListener("pointerdown", (event) => {
  if (!canDrag() || event.button > 0) return;

  const heading = event.target.closest(".category-heading");
  let target;
  if (heading) {
    // "Andre" kan ikke flyttes, og ⋯/+ er vanlige knapper
    if (!heading.dataset.group || event.target.closest(".category-icon")) return;
    target = { kind: "category", el: heading, categoryId: heading.dataset.group };
  } else {
    const row = event.target.closest(".item");
    if (!row || event.target.closest("button, input")) return;
    const item = items.find((i) => i.id === row.dataset.id);
    if (!item) return;
    target = { kind: "item", el: row, item };
  }

  press = {
    ...target,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    isMouse: event.pointerType === "mouse",
  };
  // Mobil: hold inne en liten stund. PC: start når musa dras (se under).
  if (!press.isMouse) {
    press.timer = setTimeout(() => startDrag(press.startY), LONG_PRESS_MS);
  }
});

function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}

// Følg fingeren/musa i hele vinduet (også utenfor listen)
addEventListener("pointermove", (event) => {
  if (drag && event.pointerId === drag.pointerId) {
    moveDrag(event.clientY);
    return;
  }
  if (!press || event.pointerId !== press.pointerId) return;
  const dx = event.clientX - press.startX;
  const dy = event.clientY - press.startY;
  if (press.isMouse) {
    // PC: dra opp/ned med museknappen nede
    if (Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx)) startDrag(event.clientY);
  } else if (Math.hypot(dx, dy) > 8) {
    cancelPress(); // fingeren beveget seg før tiden: det er bla eller sveip
  }
});

addEventListener("pointerup", (event) => {
  if (drag && event.pointerId === drag.pointerId) endDrag(false);
  cancelPress();
});

addEventListener("pointercancel", () => {
  if (drag) endDrag(true);
  cancelPress();
});

// Mens man drar: ikke la siden bla av seg selv
document.addEventListener(
  "touchmove",
  (event) => {
    if (drag) event.preventDefault();
  },
  { passive: false }
);

// Hold inne skal ikke åpne nettleserens egen meny
listEl.addEventListener("contextmenu", (event) => {
  if (event.target.closest(".item, .category-heading")) event.preventDefault();
});

function startDrag(y) {
  const p = press;
  cancelPress();
  if (!p || !p.el.isConnected) return;
  swipe = null; // ikke sveip samtidig

  // En kopi av raden/overskriften som følger fingeren
  const rect = p.el.getBoundingClientRect();
  const ghost = p.el.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.append(ghost);
  p.el.classList.add("drag-source");
  document.body.classList.add("dragging");

  // Flytte vare: "Andre" må alltid være et slippmål, også når den er tom
  let tempAndre = null;
  if (p.kind === "item" && !listEl.querySelector('.category-heading[data-group=""]')) {
    tempAndre = createCategoryHeading(null, `andre-${current}`, 0, false);
    listEl.append(tempAndre);
  }

  drag = {
    ...p,
    ghost,
    height: rect.height,
    offsetY: y - rect.top, // hvor man tok tak
    lastY: y,
    group: null, // vare: kategorien man er over
    before: undefined, // kategori: settes inn før denne (null = nederst)
    tempAndre,
  };
  if (navigator.vibrate) navigator.vibrate(30); // kort vibrering der det støttes
  moveDrag(y);
  requestAnimationFrame(autoScroll);
}

// Flytt kopien, og vis hvor det havner.
// PC: kopien følger musa der man tok tak (ingen hopp).
// Mobil: kopien ligger litt over fingeren, så fingeren ikke skjuler den.
function moveDrag(y) {
  drag.lastY = y;
  const top = drag.isMouse ? y - drag.offsetY : y - drag.height - 12;
  drag.ghost.style.top = `${top}px`;

  if (drag.kind === "item") {
    const group = groupAt(y);
    if (group !== drag.group) {
      drag.group = group;
      // Marker hele kategorien: overskriften og varene i den
      listEl.querySelectorAll("li[data-group]").forEach((li) => {
        li.classList.toggle("drop-zone", li.dataset.group === group);
      });
    }
  } else {
    const before = categoryBefore(y);
    if (before !== drag.before) {
      drag.before = before;
      // Grønn strek der kategorien havner
      listEl.querySelectorAll(".insert-before").forEach((h) => h.classList.remove("insert-before"));
      const mark = before === null
        ? listEl.querySelector('.category-heading[data-group=""]') // over "Andre"
        : listEl.querySelector(`.category-heading[data-group="${before}"]`);
      if (mark) mark.classList.add("insert-before");
      listEl.classList.toggle("insert-at-end", !mark);
    }
  }
}

// Vare: hvilken kategori hører høyden y til? Alt fra en overskrift og ned
// til neste overskrift (også mellomrommene mellom radene) hører til den.
function groupAt(y) {
  let group = null;
  for (const li of listEl.querySelectorAll("li[data-group]")) {
    if (li.getBoundingClientRect().top > y) break;
    group = li.dataset.group;
  }
  return group;
}

// Kategori: hvilken kategori skal den settes inn foran? (null = nederst)
// Den første overskriften som ligger under midten av fingeren.
function categoryBefore(y) {
  for (const cat of categoriesFor(current)) {
    if (cat.id === drag.categoryId) continue;
    const heading = listEl.querySelector(`.category-heading[data-group="${cat.id}"]`);
    if (!heading) continue;
    const rect = heading.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return cat.id;
  }
  return null;
}

// Bla automatisk når man drar nær toppen eller bunnen av skjermen
function autoScroll() {
  if (!drag) return;
  let step = 0;
  if (drag.lastY < 110) step = -8; // litt ekstra plass til topplinjen
  else if (drag.lastY > innerHeight - 70) step = 8;
  if (step) {
    scrollBy(0, step);
    moveDrag(drag.lastY);
  }
  requestAnimationFrame(autoScroll);
}

function endDrag(cancelled) {
  const d = drag;
  drag = null;
  d.ghost.remove();
  d.el.classList.remove("drag-source");
  if (d.tempAndre) d.tempAndre.remove();
  document.body.classList.remove("dragging");
  listEl.classList.remove("insert-at-end");
  listEl.querySelectorAll(".drop-zone").forEach((li) => li.classList.remove("drop-zone"));
  listEl.querySelectorAll(".insert-before").forEach((h) => h.classList.remove("insert-before"));

  // Slippet skal ikke telle som et trykk (f.eks. lukke kategorien)
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 400);
  if (cancelled) return;

  if (d.kind === "category") {
    // Ny rekkefølge: ta ut kategorien og sett den inn på ny plass
    const ids = categoriesFor(current).map((c) => c.id);
    const newIds = ids.filter((id) => id !== d.categoryId);
    const index = d.before ? newIds.indexOf(d.before) : newIds.length;
    newIds.splice(index, 0, d.categoryId);
    if (newIds.join() === ids.join()) return; // samme plass

    // Vis med en gang, og lagre
    categories = categories.map((c) =>
      newIds.includes(c.id) ? { ...c, order: newIds.indexOf(c.id) } : c
    );
    render();
    reorderCategories(newIds).catch(showError);
    return;
  }

  // Vare: kategori som ikke finnes her, regnes som "Andre"
  const known = categoriesFor(current).some((c) => c.id === d.item.category);
  const oldGroup = known ? d.item.category : "";
  if (d.group === null || d.group === oldGroup) return;

  const oldCategory = d.item.category || "";
  updateItem(d.item.id, { category: d.group }).catch(showError);
  const name = d.group ? categoryName(d.group) : "Andre";
  showToast(`${d.item.name} flyttet til ${name}`, () =>
    updateItem(d.item.id, { category: oldCategory }).catch(showError)
  );
}

// Trykk på en vare i "Går snart ut" åpner redigeringsvinduet
expiringList.addEventListener("click", (event) => {
  const card = event.target.closest(".expiring-card");
  if (!card) return;
  const item = items.find((i) => i.id === card.dataset.id);
  if (item) openEdit(item);
});

// ---------- Utløpsdato og notat i "Legg til" (skjult til man trenger dem) ----------

// "2026-10-25" -> "25. okt."
function prettyDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}

// Datoknappen: "Går ut 25. okt." (+ egen ✕-knapp) når dato er valgt,
// "− Utløpsdato" mens kalenderen er åpen, ellers "+ Utløpsdato"
function updateDateButton() {
  const hasDate = expiresInput.value !== "";
  const open = !dateSection.hidden;
  showDateBtn.textContent = hasDate
    ? `Går ut ${prettyDate(expiresInput.value)}`
    : open ? "− Utløpsdato" : "+ Utløpsdato";
  showDateBtn.classList.toggle("has-value", hasDate);
  showDateBtn.classList.toggle("open", open && !hasDate);
  clearDateBtn.hidden = !hasDate;
}

// Notatknappen: "− Notat" når feltet er åpent, "Notat ✓" når det er lukket
// med tekst i, ellers "+ Notat"
function updateNoteButton() {
  const open = !noteInput.hidden;
  const hasText = noteInput.value.trim() !== "";
  showNoteBtn.textContent = open ? "− Notat" : hasText ? "Notat ✓" : "+ Notat";
  showNoteBtn.classList.toggle("has-value", !open && hasText);
  showNoteBtn.classList.toggle("open", open);
}

// Lukk utløpsdato og notat (etter "Legg til", og når vinduet åpnes)
function resetAddExtras() {
  categorySection.hidden = true;
  updateCategoryButton();
  dateSection.hidden = true;
  expiresInput.hidden = true;
  noteInput.hidden = true;
  updateDateButton();
  updateNoteButton();
}

// Vis datofeltet og åpne kalenderen
function openCalendar() {
  expiresInput.hidden = false;
  expiresInput.focus();
  try {
    expiresInput.showPicker(); // åpner kalenderen direkte (de fleste nettlesere)
  } catch {}
}

// "+ Utløpsdato" (eller "Går ut 25. okt."): åpne kalenderen.
// "− Utløpsdato" (kalenderen er åpen uten dato): lukk igjen.
showDateBtn.addEventListener("click", () => {
  if (!dateSection.hidden && !expiresInput.value) {
    closeDateSection();
    return;
  }
  dateSection.hidden = false;
  updateDateButton();
  openCalendar();
});

// ✕: fjern datoen
clearDateBtn.addEventListener("click", () => {
  expiresInput.value = "";
  dateSection.hidden = true;
  expiresInput.hidden = true;
  updateDateButton();
});

// Lukk datofeltet og vis datoen på knappen ("Går ut 25. okt.")
function closeDateSection() {
  dateSection.hidden = true;
  expiresInput.hidden = true;
  updateDateButton();
}

// Dato valgt. Kalenderen på mobil sier fra om endringer mens man fortsatt
// velger (f.eks. når man ruller i hjulet på iPhone) – da lukkes den ikke ennå.
expiresInput.addEventListener("change", updateDateButton);
// Kalenderen er lukket. Vent litt før datodelen lukkes: trykket som fjernet
// fokuset (f.eks. på "Legg til") må rekke å treffe knappen før den flytter seg opp.
expiresInput.addEventListener("blur", () => setTimeout(closeDateSection, 300));

// "+ Notat" / "− Notat": vis eller skjul notatfeltet (teksten blir liggende)
showNoteBtn.addEventListener("click", () => {
  noteInput.hidden = !noteInput.hidden;
  if (!noteInput.hidden) noteInput.focus();
  updateNoteButton();
});

// ---------- Redigering ----------

// Fyll vinduet med varens verdier og vis det
function openEdit(item) {
  editingId = item.id;
  editName.value = item.name;
  editQty.value = item.quantity ?? "";
  editUnit.value = item.unit || "";
  editLocation.value = item.location;
  editExpires.value = item.expires || "";
  editNote.value = item.note || "";
  fillEditCategories(item.location, item.category || "");
  editDialog.showModal();
}

// Lagre endringene
editForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const item = items.find((i) => i.id === editingId);
  if (item) {
    const changes = {
      name: editName.value.trim() || item.name,
      quantity: editQty.value === "" ? null : Number(editQty.value),
      unit: editUnit.value,
      location: editLocation.value,
      expires: editExpires.value,
      note: editNote.value.trim(),
      category: editCategory.value,
    };
    updateItem(item.id, changes).catch(showError);
    rememberName(changes).catch(showError);
  }
  editDialog.close();
});

editCancel.addEventListener("click", () => editDialog.close());

// Slett varen (med "Angre" i noen sekunder)
editDelete.addEventListener("click", () => {
  const item = items.find((i) => i.id === editingId);
  editDialog.close();
  if (item) deleteWithUndo(item, `${item.name} ble slettet`);
});

// ---------- Uten nett ----------

// Vis en stripe øverst når enheten er uten nett
function updateOnlineStatus() {
  offlineBanner.hidden = navigator.onLine;
}
addEventListener("online", updateOnlineStatus);
addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// Kategorivalget i redigeringsvinduet: kategoriene for valgt lagringssted
function fillEditCategories(location, selectedId) {
  const cats = categoriesFor(location);
  editCategory.innerHTML = "";
  editCategory.append(new Option("Ingen", ""));
  for (const cat of cats) editCategory.append(new Option(cat.name, cat.id));
  editCategory.value = cats.some((c) => c.id === selectedId) ? selectedId : "";
}

// Flytter man varen til et annet sted, beholdes kategorien hvis det finnes
// en med samme navn der (f.eks. "Kjøtt" i både fryser og kjøleskap)
editLocation.addEventListener("change", () => {
  const currentName = categoryName(editCategory.value).toLowerCase();
  const match = categoriesFor(editLocation.value).find(
    (c) => c.name.toLowerCase() === currentName
  );
  fillEditCategories(editLocation.value, match ? match.id : "");
});

// ---------- Kategorivindu: ny / gi nytt navn / slett ----------

let editingCategory = null; // null = ny kategori
let newCategoryForAddForm = false; // ny kategori laget fra "Legg til"? Velg den der.

function openCategoryDialog(category, forAddForm) {
  editingCategory = category || null;
  newCategoryForAddForm = forAddForm;
  const location = forAddForm ? addTo : current;
  categoryTitle.textContent = category ? "Endre kategori" : `Ny kategori i ${LOCATIONS[location]}`;
  categoryNameInput.value = category ? category.name : "";
  categoryDeleteBtn.hidden = !category;
  categoryError.hidden = true;
  categoryDialog.showModal();
  categoryNameInput.focus();
}

newCategoryBtn.addEventListener("click", () => {
  listMenu.open = false;
  openCategoryDialog(null, false);
});
categoryCancel.addEventListener("click", () => categoryDialog.close());

categoryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = categoryNameInput.value.trim();
  if (!name) return;

  const location = editingCategory
    ? editingCategory.location
    : newCategoryForAddForm ? addTo : current;

  // Samme navn to ganger på samme sted blir forvirrende
  const taken = categoriesFor(location).some(
    (c) => c.id !== editingCategory?.id && c.name.toLowerCase() === name.toLowerCase()
  );
  if (taken) {
    categoryError.textContent = "Det finnes allerede en kategori med det navnet her.";
    categoryError.hidden = false;
    return;
  }

  if (editingCategory) {
    renameCategory(editingCategory.id, name).catch(showError);
  } else {
    const order = Date.now(); // stort tall = havner nederst
    const { id, saved } = addCategory({ name, location, order });
    saved.catch(showError);
    // Vis den med en gang (Firebase sier fra like etterpå)
    categories = [...categories, { id, name, location, order }];
    if (newCategoryForAddForm) {
      setAddCategory(id);
      categorySection.hidden = true;
      updateCategoryButton();
    }
    render();
  }
  categoryDialog.close();
});

// Slett kategori: varene flyttes til "Andre". Kan angres.
categoryDeleteBtn.addEventListener("click", () => {
  const category = editingCategory;
  if (!category) return;
  const itemIds = items.filter((i) => i.category === category.id).map((i) => i.id);
  categoryDialog.close();
  deleteCategory(category.id, itemIds).catch(showError);
  showToast(`Kategorien «${category.name}» ble slettet`, () =>
    restoreCategory(category, itemIds).catch(showError)
  );
});

// ---------- Varer fra bilde (scan.js) ----------

initScan({
  locations: LOCATIONS,
  categoriesFor,
  findKnown,
  currentLocation: () => current,
  // Mobil: lukk "Legg til"-vinduet når varene er lagt inn
  closeAddCard: () => {
    if (!wideScreen.matches && addCard.open) addCard.close();
  },
  showToast,
  showError,
});

// ---------- Oppskrifter (recipes.js) ----------

// Oppskriftene trenger noen av hjelpefunksjonene her
initRecipes({
  locations: LOCATIONS,
  isSoon: (item) => {
    const expiry = expiryInfo(item);
    return Boolean(expiry && expiry.daysLeft <= EXPIRING_DAYS);
  },
  expiryText: (item) => expiryInfo(item)?.text || "",
  formatQty,
  stepFor,
  roundQty,
  showToast,
  showError,
  readSetting,
  saveSetting,
});

// ---------- Innlogging ----------

// Kjører når siden åpnes, og hver gang noen logger inn eller ut
watchUser((user) => {
  loadingEl.hidden = true;

  // Slutt å lytte på forrige brukers varer og historikk
  if (stopWatchingItems) {
    stopWatchingItems();
    stopWatchingItems = null;
  }
  if (stopWatchingHistory) {
    stopWatchingHistory();
    stopWatchingHistory = null;
  }
  if (stopWatchingCategories) {
    stopWatchingCategories();
    stopWatchingCategories = null;
  }

  if (user) {
    loginSection.hidden = true;
    appSection.hidden = false;
    menu.hidden = false;
    bottomNav.hidden = false;
    const username = emailToUsername(user.email);
    userLabel.textContent = username;
    userInitial.textContent = username.charAt(0).toUpperCase(); // "arve" -> "A"
    userName.textContent = username;

    // Demobrukeren kan bare se – Firestore-reglene stopper alle endringer
    isDemo = username === DEMO_USER;
    demoBanner.hidden = !isDemo;
    changePasswordBtn.hidden = isDemo;

    if (!isDemo) migrateLocalItems();
    let firstItems = true;
    stopWatchingItems = watchItems((newItems) => {
      items = isDemo
        ? newItems.map((item) => ({ ...item, expires: shiftDemoDate(item.expires) }))
        : newItems;
      render();
      setRecipeItems(items); // oppskriftene sjekkes mot varene
      if (firstItems) {
        firstItems = false;
        // Litt pause, så kategoriene og "Bruk snart" er tegnet før de lyses opp
        setTimeout(() => maybeShowIntro(username), 600);
      }
    }, showError);
    stopWatchingHistory = watchHistory((newHistory) => {
      nameHistory = newHistory;
    });
    stopWatchingCategories = watchCategories((newCategories) => {
      categories = newCategories;
      render();
    }, showError);
    startRecipes();
  } else {
    stopRecipes();
    items = [];
    nameHistory = [];
    categories = [];
    render();
    appSection.hidden = true;
    menu.hidden = true;
    bottomNav.hidden = true;
    isDemo = false;
    demoBanner.hidden = true;
    menu.open = false;
    loginSection.hidden = false;
  }
});

// Hent og sjekk brukernavn/passord fra skjemaet (null hvis noe er galt)
function readCredentials() {
  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!/^[a-z0-9._-]+$/.test(username)) {
    showLoginError("Brukernavnet kan bare inneholde a–z, 0–9, punktum, _ og - (ikke æ, ø, å).");
    return null;
  }
  if (password.length < 6) {
    showLoginError("Passordet må ha minst 6 tegn.");
    return null;
  }
  return { username, password };
}

function showLoginError(message) {
  loginError.textContent = message;
  loginError.hidden = false;
}

// Oversett Firebase sine feilkoder til norsk
function authErrorMessage(error) {
  switch (error.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Feil brukernavn eller passord.";
    case "auth/email-already-in-use":
      return "Brukernavnet er tatt. Velg et annet.";
    case "auth/weak-password":
      return "Passordet må ha minst 6 tegn.";
    case "auth/too-many-requests":
      return "For mange forsøk. Vent litt og prøv igjen.";
    case "auth/network-request-failed":
      return "Ingen nettforbindelse.";
    case "auth/operation-not-allowed":
      return "Innlogging med passord er ikke slått på i Firebase.";
    default:
      return "Noe gikk galt: " + error.code;
  }
}

// Innloggingsskjermen har to moduser: "Logg inn" og "Lag ny bruker"
let signupMode = false;

function setSignupMode(on) {
  signupMode = on;
  loginTitle.textContent = on ? "Lag ny bruker" : "Logg inn";
  loginSubmit.textContent = on ? "Lag ny bruker" : "Logg inn";
  loginSwitch.textContent = on ? "Jeg har allerede en bruker" : "Lag ny bruker";
  repeatLabel.hidden = !on;
  passwordRepeatInput.required = on;
  // Hjelper nettleserens passordlagring å forstå om passordet er nytt
  passwordInput.autocomplete = on ? "new-password" : "current-password";
  loginError.hidden = true;
}

// Bytt mellom "Logg inn" og "Lag ny bruker"
loginSwitch.addEventListener("click", () => {
  setSignupMode(!signupMode);
  usernameInput.focus();
});

// Grønn knapp (eller Enter): logg inn, eller lag ny bruker
loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loginError.hidden = true;
  const credentials = readCredentials();
  if (!credentials) return;

  if (signupMode) {
    if (passwordRepeatInput.value !== credentials.password) {
      showLoginError("Passordene er ikke like.");
      return;
    }
    // Lag ny bruker (logger inn automatisk etterpå)
    signUp(credentials.username, credentials.password)
      .then(() => {
        loginForm.reset();
        setSignupMode(false);
      })
      .catch((error) => showLoginError(authErrorMessage(error)));
  } else {
    justSignedIn = true; // settes før, fordi innloggingen meldes før .then
    signIn(credentials.username, credentials.password)
      .then(() => loginForm.reset())
      .catch((error) => {
        justSignedIn = false;
        showLoginError(authErrorMessage(error));
      });
  }
});

// Logg ut
logoutBtn.addEventListener("click", () => {
  logOut();
});

// ---------- Meny ----------

// Lukk menyene når man trykker utenfor dem
document.addEventListener("click", (event) => {
  if (menu.open && !menu.contains(event.target)) menu.open = false;
  if (listMenu.open && !listMenu.contains(event.target)) listMenu.open = false;
});

// ---------- Tema (Auto / Lys / Mørk) ----------

// Statuslinjefarge på mobil for lyst og mørkt tema
const THEME_COLORS = { light: "#f7f5ef", dark: "#141a17" };

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme; // auto: følg enheten
  }
  // Statuslinjen: fast farge ved valgt tema, ellers lys/mørk etter enheten
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const followsDevice = meta.media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light;
    meta.content = THEME_COLORS[theme] || followsDevice;
  });
}

// Velg tema ("light", "auto" eller "dark"), husk det på denne enheten
// og marker riktig knapp i tema-bryteren
function setTheme(theme) {
  saveSetting(THEME_KEY, theme);
  applyTheme(theme);
  themeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.themeChoice === theme);
  });
}

const savedTheme = readSetting(THEME_KEY);
setTheme(savedTheme === "light" || savedTheme === "dark" ? savedTheme : "auto");

themeButtons.forEach((button) => {
  button.addEventListener("click", () => setTheme(button.dataset.themeChoice));
});

// ---------- Bytt passord ----------

changePasswordBtn.addEventListener("click", () => {
  menu.open = false;
  passwordForm.reset();
  document.getElementById("password-username").value = userLabel.textContent;
  passwordError.hidden = true;
  passwordDialog.showModal();
});

passwordCancel.addEventListener("click", () => passwordDialog.close());

passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  passwordError.hidden = true;

  const newPassword = newPasswordInput.value;
  if (newPassword.length < 6) return showPasswordError("Det nye passordet må ha minst 6 tegn.");
  if (newPassword !== repeatPasswordInput.value) return showPasswordError("De nye passordene er ikke like.");

  changePassword(currentPasswordInput.value, newPassword)
    .then(() => {
      passwordDialog.close();
      showToast("Passordet er endret");
    })
    .catch((error) => {
      const wrongPassword =
        error.code === "auth/invalid-credential" || error.code === "auth/wrong-password";
      showPasswordError(wrongPassword ? "Nåværende passord er feil." : authErrorMessage(error));
    });
});

function showPasswordError(message) {
  passwordError.textContent = message;
  passwordError.hidden = false;
}

// ---------- PWA ----------

// Start service workeren (sw.js), som gjør at appen kan installeres
// og åpnes uten nett
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
