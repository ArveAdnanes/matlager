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
} from "./firebase.js";

// Der varene lå lagret i nettleseren før vi tok i bruk Firebase
const LOCAL_KEY = "matlager";

// Visningsnavn for lagringsstedene
const LOCATIONS = {
  fryser: "Fryser",
  kjoleskap: "Kjøleskap",
  torrvarer: "Tørrvarer",
};

// Alle varer: { id, name, location, quantity, unit, expires }
// Bare name er påkrevd – quantity kan være null, unit og expires kan være ""
// Fylles fra Firebase når du er innlogget
let items = [];

// Fanen som er valgt nå
let current = "fryser";

// Elementer fra index.html vi trenger
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const form = document.getElementById("add-form");
const nameInput = document.getElementById("name");
const qtyInput = document.getElementById("quantity");
const unitSelect = document.getElementById("unit");
const expiresInput = document.getElementById("expires");
const searchInput = document.getElementById("search");
const tabs = document.querySelectorAll(".tab");

// Redigeringsvinduet
const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editName = document.getElementById("edit-name");
const editQty = document.getElementById("edit-quantity");
const editUnit = document.getElementById("edit-unit");
const editLocation = document.getElementById("edit-location");
const editExpires = document.getElementById("edit-expires");
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
const signupBtn = document.getElementById("signup");
const appSection = document.getElementById("app");
const userBar = document.getElementById("user-bar");
const userLabel = document.getElementById("user-label");
const logoutBtn = document.getElementById("logout");

// Stopper lyttingen på varer (settes når man logger inn)
let stopWatchingItems = null;

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
  form.hidden = searching; // skjul "legg til" mens man søker
  document.body.classList.toggle("searching", searching);

  const visible = items
    .filter((item) =>
      searching
        ? item.name.toLowerCase().includes(query)
        : item.location === current
    )
    .sort(compareItems);

  for (const item of visible) {
    const li = document.createElement("li");
    li.className = "item";
    li.dataset.id = item.id;

    // Navn + infolinje – trykk her for å redigere
    const info = document.createElement("div");
    info.className = "item-info";
    info.dataset.action = "edit";

    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = item.name;
    info.append(name);

    // Infolinje under navnet, f.eks. "Går ut 24. okt"
    const meta = [];
    if (searching) meta.push(LOCATIONS[item.location]); // vis hvor varen ligger
    const expiry = expiryInfo(item);
    if (expiry) {
      meta.push(expiry.text);
      if (expiry.status) li.classList.add(expiry.status);
    }
    if (meta.length) {
      const small = document.createElement("small");
      small.className = "item-meta";
      small.textContent = meta.join(" · ");
      info.append(small);
    }

    const qty = document.createElement("span");
    qty.className = "item-qty";
    qty.textContent = formatQty(item);

    li.append(
      info,
      makeButton("–", "minus"),
      qty,
      makeButton("+", "plus"),
      makeButton("🗑", "delete")
    );
    listEl.append(li);
  }

  emptyEl.textContent = searching ? "Ingen treff." : "Ingen varer her ennå.";
  emptyEl.hidden = visible.length > 0;
}

// Skriv antall varer på hver fane, f.eks. "Fryser (4)"
function updateCounts() {
  tabs.forEach((tab) => {
    const count = items.filter((i) => i.location === tab.dataset.location).length;
    tab.querySelector(".count").textContent = count ? `(${count})` : "";
  });
}

function makeButton(text, action) {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.className = action;
  btn.dataset.action = action;
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

  if (daysLeft < 0) return { text: `Gikk ut ${pretty}`, status: "expired" };
  if (daysLeft === 0) return { text: "Går ut i dag", status: "soon" };
  if (daysLeft <= 3) return { text: `Går ut ${pretty}`, status: "soon" };
  return { text: `Går ut ${pretty}`, status: null };
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

// "3 stk", "3" eller "" – viser bare det som er fylt ut
function formatQty(item) {
  if (item.quantity == null) return "";
  return `${item.quantity} ${item.unit || ""}`.trim();
}

// ---------- Hendelser ----------

// Bytt fane
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    current = tab.dataset.location;
    searchInput.value = ""; // trykk på fane avslutter søket
    tabs.forEach((t) => t.classList.toggle("active", t === tab));
    render();
  });
});

// Søk: tegn listen på nytt for hver bokstav
searchInput.addEventListener("input", render);

// Legg til ny vare
form.addEventListener("submit", (event) => {
  event.preventDefault(); // hindrer at siden lastes på nytt

  const name = nameInput.value.trim();
  // Tomt antall lagres som null (= ikke fylt ut)
  const quantity = qtyInput.value === "" ? null : Number(qtyInput.value);
  if (!name) return;

  // Firebase lager id selv. Listen oppdateres automatisk via watchItems.
  addItem({
    name,
    location: current,
    quantity,
    unit: unitSelect.value,
    expires: expiresInput.value, // "" hvis ingen dato
  }).catch(showError);

  form.reset();
  nameInput.focus();
});

// +, –, slett og rediger (ett felles lytteroppsett for hele listen)
listEl.addEventListener("click", (event) => {
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

  // Endringene sendes til Firebase – listen oppdateres automatisk via watchItems
  if (action === "plus") {
    const quantity = (item.quantity ?? 0) + 1; // tomt antall blir 1
    updateItem(id, { quantity }).catch(showError);
  } else if (action === "minus") {
    if (item.quantity == null) return; // ingenting å trekke fra
    const quantity = Math.max(0, item.quantity - 1);
    if (quantity === 0 && confirm(`${item.name} er tom. Slette varen?`)) {
      deleteItem(id).catch(showError);
    } else {
      updateItem(id, { quantity }).catch(showError);
    }
  } else if (action === "delete") {
    if (!confirm(`Slette ${item.name}?`)) return;
    deleteItem(id).catch(showError);
  }
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
  editDialog.showModal();
}

// Lagre endringene
editForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const item = items.find((i) => i.id === editingId);
  if (item) {
    updateItem(item.id, {
      name: editName.value.trim() || item.name,
      quantity: editQty.value === "" ? null : Number(editQty.value),
      unit: editUnit.value,
      location: editLocation.value,
      expires: editExpires.value,
    }).catch(showError);
  }
  editDialog.close();
});

editCancel.addEventListener("click", () => editDialog.close());

// ---------- Innlogging ----------

// Kjører når siden åpnes, og hver gang noen logger inn eller ut
watchUser((user) => {
  loadingEl.hidden = true;

  // Slutt å lytte på forrige brukers varer
  if (stopWatchingItems) {
    stopWatchingItems();
    stopWatchingItems = null;
  }

  if (user) {
    loginSection.hidden = true;
    appSection.hidden = false;
    userBar.hidden = false;
    userLabel.textContent = `Innlogget som ${emailToUsername(user.email)}`;

    migrateLocalItems();
    stopWatchingItems = watchItems((newItems) => {
      items = newItems;
      render();
    }, showError);
  } else {
    items = [];
    render();
    appSection.hidden = true;
    userBar.hidden = true;
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

// Logg inn
loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loginError.hidden = true;
  const credentials = readCredentials();
  if (!credentials) return;

  signIn(credentials.username, credentials.password)
    .then(() => loginForm.reset())
    .catch((error) => showLoginError(authErrorMessage(error)));
});

// Lag ny bruker (logger inn automatisk etterpå)
signupBtn.addEventListener("click", () => {
  loginError.hidden = true;
  const credentials = readCredentials();
  if (!credentials) return;

  signUp(credentials.username, credentials.password)
    .then(() => loginForm.reset())
    .catch((error) => showLoginError(authErrorMessage(error)));
});

// Logg ut
logoutBtn.addEventListener("click", () => {
  logOut();
});
