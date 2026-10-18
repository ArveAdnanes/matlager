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
  changePassword,
  rememberName,
  watchHistory,
} from "./firebase.js";

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

// Fanen som er valgt nå – starter på den du var på sist
let current = LOCATIONS[readSetting(TAB_KEY)] ? readSetting(TAB_KEY) : "fryser";

// Elementer fra index.html vi trenger
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const sortSelect = document.getElementById("sort");
const searchClear = document.getElementById("search-clear");
const searchInfo = document.getElementById("search-info");
const offlineBanner = document.getElementById("offline");
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
const pickDateBtn = document.getElementById("pick-date");
const searchInput = document.getElementById("search");
const expiringSection = document.getElementById("expiring");
const expiringCount = document.getElementById("expiring-count");
const expiringList = document.getElementById("expiring-list");
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
  document.body.classList.toggle("searching", searching);

  const visible = items
    .filter((item) =>
      searching
        ? `${item.name} ${item.note || ""}`.toLowerCase().includes(query) // navn og notat
        : item.location === current
    )
    .sort(SORTERS[sortBy]);

  for (const item of visible) {
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

    // Notat (én linje, kuttes med … hvis det er langt)
    if (item.note) {
      const note = document.createElement("small");
      note.className = "item-note";
      note.textContent = item.note;
      info.append(note);
    }

    // Infolinje under navnet, f.eks. "Går ut 24. okt"
    const meta = [];
    if (searching) meta.push(LOCATIONS[item.location]); // vis hvor varen ligger
    const expiry = expiryInfo(item);
    if (expiry) {
      meta.push(expiry.text);
      if (expiry.status) row.classList.add(expiry.status);
    }
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
    listEl.append(li);
  }

  // Tom liste, f.eks. "Ingen tørrvarer ennå."
  emptyEl.textContent = searching
    ? `Ingen treff på «${searchInput.value.trim()}».`
    : EMPTY_TEXT[current];
  emptyEl.hidden = visible.length > 0;

  // Søk: antall treff og knapp for å tømme
  searchClear.hidden = !searching;
  searchInfo.hidden = !searching || visible.length === 0;
  searchInfo.textContent = `${visible.length} treff i alle steder`;

  renderExpiring(searching);
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

  if (daysLeft === -1) return { text: "Gikk ut i går", status: "expired", daysLeft };
  if (daysLeft < 0) return { text: `Gikk ut ${pretty}`, status: "expired", daysLeft };
  if (daysLeft === 0) return { text: "Går ut i dag", status: "soon", daysLeft };
  if (daysLeft === 1) return { text: "Går ut i morgen", status: "soon", daysLeft };
  if (daysLeft <= EXPIRING_DAYS) return { text: `Går ut ${pretty}`, status: "soon", daysLeft };
  return { text: `Går ut ${pretty}`, status: null, daysLeft };
}

// Hvor mange dager før utløp en vare regnes som "går snart ut" (gul farge)
const EXPIRING_DAYS = 3;

// Hadde boksen utgåtte varer sist den ble tegnet? (null = ikke tegnet ennå)
let lastHasExpired = null;

// Tegn utløpsboksen: varer fra alle steder, delt i to grupper –
// "Har gått ut" og "Går snart ut" (innen EXPIRING_DAYS dager)
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

  // Åpne boksen når noe har gått ut, lukk den når alt er i orden igjen.
  // Endres bare når situasjonen endrer seg, så det du selv har valgt blir stående.
  const hasExpired = expired.length > 0;
  if (hasExpired !== lastHasExpired) {
    expiringSection.querySelector("details").open = hasExpired;
    lastHasExpired = hasExpired;
  }
  expiringCount.textContent = `(${total})`;
  expiringList.innerHTML = "";

  addExpiringGroup("Har gått ut", "expired", expired);
  addExpiringGroup("Går snart ut", "soon", soon);
}

// Én gruppe i utløpsboksen: overskrift + varer (hoppes over hvis tom)
function addExpiringGroup(title, status, groupItems) {
  if (groupItems.length === 0) return;

  const heading = document.createElement("li");
  heading.className = `expiring-heading ${status}`;
  heading.textContent = `${title} (${groupItems.length})`;
  expiringList.append(heading);

  for (const item of groupItems) {
    const expiry = expiryInfo(item);
    const li = document.createElement("li");
    li.className = "expiring-item";
    if (expiry.status) li.classList.add(expiry.status);
    li.dataset.id = item.id;

    const name = document.createElement("span");
    name.textContent = item.name;

    const meta = document.createElement("small");
    meta.textContent = `${LOCATIONS[item.location]} · ${expiry.text}`;

    li.append(name, meta);
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
sortSelect.value = sortBy;

sortSelect.addEventListener("change", () => {
  sortBy = sortSelect.value;
  saveSetting(SORT_KEY, sortBy);
  render();
});

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
  tab.addEventListener("click", () => selectTab(tab.dataset.location));
});

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

function setAddLocation(location) {
  addTo = location;
  locationButtons.forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.addLocation === location);
  });
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
  if (!swipe || event.pointerId !== swipe.pointerId) return;
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

// Trykk på en vare i "Går snart ut" åpner redigeringsvinduet
expiringList.addEventListener("click", (event) => {
  const li = event.target.closest(".expiring-item");
  if (!li) return;
  const item = items.find((i) => i.id === li.dataset.id);
  if (item) openEdit(item);
});

// ---------- Hurtigknapper for utløpsdato ----------

// Dato et antall dager/måneder fra i dag, som "2026-10-25" (formatet datofeltet bruker)
function dateFromToday({ days = 0, months = 0 }) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "+3 dager", "+1 uke" osv. fyller inn datofeltet som står i data-for
document.querySelectorAll(".date-chips").forEach((group) => {
  const input = document.getElementById(group.dataset.for);
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    input.value = dateFromToday({
      days: Number(button.dataset.days || 0),
      months: Number(button.dataset.months || 0),
    });
    input.dispatchEvent(new Event("change")); // si fra at datoen er endret
  });
});

// ---------- Utløpsdato og notat i "Legg til" (skjult til man trenger dem) ----------

// "2026-10-25" -> "25. okt."
function prettyDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}

// Datoknappen: "Går ut 25. okt." (+ egen ✕-knapp) når dato er valgt,
// "− Utløpsdato" når hurtigknappene er åpne, ellers "+ Utløpsdato"
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

// "+ Utløpsdato": vis/skjul hurtigknappene.
// Har man valgt dato ("Går ut 25. okt."): åpne kalenderen for å endre den.
showDateBtn.addEventListener("click", () => {
  if (expiresInput.value) {
    dateSection.hidden = false;
    updateDateButton();
    openCalendar();
    return;
  }
  dateSection.hidden = !dateSection.hidden;
  updateDateButton();
});

// ✕: fjern datoen
clearDateBtn.addEventListener("click", () => {
  expiresInput.value = "";
  dateSection.hidden = true;
  expiresInput.hidden = true;
  updateDateButton();
});

// "Velg dato…"
pickDateBtn.addEventListener("click", openCalendar);

// Dato valgt (hurtigknapp eller kalender): lukk datodelen, vis datoen på knappen
expiresInput.addEventListener("change", () => {
  if (expiresInput.value) {
    dateSection.hidden = true;
    expiresInput.hidden = true;
  }
  updateDateButton();
});

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

  if (user) {
    loginSection.hidden = true;
    appSection.hidden = false;
    menu.hidden = false;
    const username = emailToUsername(user.email);
    userLabel.textContent = username;
    userInitial.textContent = username.charAt(0).toUpperCase(); // "arve" -> "A"
    userName.textContent = username;

    migrateLocalItems();
    stopWatchingItems = watchItems((newItems) => {
      items = newItems;
      render();
    }, showError);
    stopWatchingHistory = watchHistory((newHistory) => {
      nameHistory = newHistory;
    });
  } else {
    items = [];
    nameHistory = [];
    render();
    appSection.hidden = true;
    menu.hidden = true;
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
    signIn(credentials.username, credentials.password)
      .then(() => loginForm.reset())
      .catch((error) => showLoginError(authErrorMessage(error)));
  }
});

// Logg ut
logoutBtn.addEventListener("click", () => {
  logOut();
});

// ---------- Meny ----------

// Lukk menyen når man trykker utenfor den
document.addEventListener("click", (event) => {
  if (menu.open && !menu.contains(event.target)) menu.open = false;
});

// ---------- Tema (Auto / Lys / Mørk) ----------

// Statuslinjefarge på mobil for lyst og mørkt tema
const THEME_COLORS = { light: "#f4f6f4", dark: "#141a17" };

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
