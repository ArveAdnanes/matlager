// "Hva kan jeg lage?" – AI-en (Gemini via Firebase) foreslår retter
// ut fra varene du har. Appen sjekker selv hva du har og mangler,
// og du kan lagre favoritter og trekke fra lageret når du har laget noe.

import {
  suggestMeals,
  aiErrorMessage,
  watchRecipeSettings,
  saveRecipeSettings,
  watchFavorites,
  addFavorite,
  deleteFavorite,
  updateItem,
  deleteItem,
  importItem,
} from "./firebase.js";

// Adressen når forslagene vises (så tilbakeknappen på mobilen virker)
const HASH = "#oppskrifter";

// Siste forslag huskes på denne enheten, så de ikke forsvinner når du går tilbake
const SAVED_KEY = "matlager-forslag";
// Er favorittlisten åpen? (huskes på denne enheten)
const FAVORITES_OPEN_KEY = "matlager-favoritter-apen";
// "Bruk det som snart går ut" på eller av (huskes på denne enheten)
const USE_SOON_KEY = "matlager-bruk-snart";

// "Har alltid": basisvarer som aldri regnes som "mangler". Kan endres av brukeren.
const DEFAULT_BASICS = ["salt", "pepper", "olje", "smør", "hvetemel", "sukker", "buljong", "vanlige krydder"];
const DEFAULT_SERVINGS = 4;
const MAX_SERVINGS = 12;

let items = [];
let loggedIn = false;
let openedHere = false; // åpnet med knappen? Da går "Tilbake" tilbake i historikken
let options = null; // hjelpefunksjoner fra app.js
let meals = []; // forslagene fra AI-en som vises nå
let favorites = []; // lagrede favoritter (fra Firebase)
let mealType = "middag";
const extras = new Set(); // "rask", "vegetar", "bare", "snart"
let basics = DEFAULT_BASICS;
let servings = DEFAULT_SERVINGS;
let stopWatchingSettings = null;
let stopWatchingFavorites = null;
let openMealData = null; // retten som vises i vinduet

// Elementer fra index.html
const $ = (id) => document.getElementById(id);
const appSection = $("app");
const section = $("recipes");
const openBtn = $("recipes-open");
const backBtn = $("recipes-back");
const optionsSummary = $("options-summary");
const optionsDialog = $("options-dialog");
const soonNamesEl = $("soon-names");
const typeChips = $("meal-type");
const extraChips = $("meal-extras");
const servingsText = $("servings-text");
const useSoonChip = extraChips.querySelector('[data-extra="snart"]');
const suggestBtn = $("suggest");
const statusEl = $("suggest-status");
const listEl = $("suggestions");
const clearBtn = $("clear-suggestions");
const favoritesEl = $("favorites");
const favoritesTitle = $("favorites-title");
const favoritesList = $("favorites-list");

const basicsText = $("basics-text");
const basicsDialog = $("basics-dialog");
const basicsList = $("basics-list");
const basicsForm = $("basics-form");
const basicsInput = $("basics-input");

const viewDialog = $("recipe-dialog");
const viewTitle = $("recipe-title");
const viewInfo = $("recipe-info");
const viewIngredients = $("recipe-ingredients");
const viewSteps = $("recipe-steps");
const favoriteBtn = $("recipe-favorite");

const cookedDialog = $("cooked-dialog");
const cookedTitle = $("cooked-title");
const cookedList = $("cooked-list");
const cookedEmpty = $("cooked-empty");
const cookedSave = $("cooked-save");

// ---------- Kobling til app.js ----------

// options: { locations, isSoon, expiryText, formatQty, stepFor, roundQty,
//            showToast, showError, readSetting, saveSetting }
export function initRecipes(opts) {
  options = opts;
  try {
    meals = JSON.parse(options.readSetting(SAVED_KEY)) || [];
  } catch {}
  favoritesEl.open = options.readSetting(FAVORITES_OPEN_KEY) === "1";
  // "Bruk det som snart går ut" er på med mindre du har slått den av
  if (options.readSetting(USE_SOON_KEY) !== "0") extras.add("snart");
  useSoonChip.setAttribute("aria-pressed", extras.has("snart"));
  addEventListener("hashchange", syncView);
}

export function startRecipes() {
  loggedIn = true;
  openBtn.hidden = false;
  stopWatchingSettings = watchRecipeSettings((settings) => {
    basics = settings.basics || DEFAULT_BASICS;
    servings = settings.servings || DEFAULT_SERVINGS;
    renderBasics();
    renderServings();
    renderRecipes();
  });
  stopWatchingFavorites = watchFavorites((list) => {
    favorites = list.sort((a, b) => (b.saved || 0) - (a.saved || 0)); // nyeste øverst
    renderRecipes();
  });
  syncView();
}

export function stopRecipes() {
  loggedIn = false;
  openBtn.hidden = true;
  if (stopWatchingSettings) stopWatchingSettings();
  if (stopWatchingFavorites) stopWatchingFavorites();
  stopWatchingSettings = stopWatchingFavorites = null;
  basics = DEFAULT_BASICS;
  servings = DEFAULT_SERVINGS;
  favorites = [];
  meals = []; // neste bruker skal ikke se forslagene
  options.saveSetting(SAVED_KEY, "[]");
  syncView();
}

// Varene har endret seg: "har / mangler" sjekkes på nytt
export function setRecipeItems(newItems) {
  items = newItems;
  renderRecipes();
}

// ---------- Bytte mellom varer og forslag ----------

function syncView() {
  const on = loggedIn && location.hash === HASH;
  if (location.hash !== HASH) openedHere = false;
  if (on === !section.hidden) return; // ingen endring
  section.hidden = !on;
  if (loggedIn) appSection.hidden = on;
  openBtn.setAttribute("aria-pressed", on);
  document.body.classList.toggle("recipes-view", on); // menyen nederst viser "Oppskrifter" som valgt
  scrollTo(0, 0);
  if (on) renderRecipes();
}

openBtn.addEventListener("click", () => {
  if (location.hash === HASH) closeView();
  else openRecipesView();
});

// Vis oppskriftene (fra grytknappen eller menyen nederst)
export function openRecipesView() {
  if (location.hash === HASH) return;
  openedHere = true;
  location.hash = HASH; // gir hashchange -> syncView
}

// Tilbake til varene (gjør ingenting hvis de allerede vises)
export function closeRecipesView() {
  if (location.hash === HASH) closeView();
}

function closeView() {
  if (openedHere) {
    history.back(); // som tilbakeknappen på mobilen
  } else {
    history.replaceState(null, "", location.pathname + location.search);
    syncView();
  }
}
backBtn.addEventListener("click", closeView);

// ---------- Valg: type måltid, ekstra ønsker og porsjoner ----------

// Middag / Lunsj / Frokost / Dessert – bare én kan være valgt
typeChips.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  mealType = button.dataset.type;
  typeChips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b === button));
});

// Rask / Vegetar / Bare det jeg har / Bruk det som snart går ut – av og på hver for seg
extraChips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-extra]");
  if (!button) return;
  const key = button.dataset.extra;
  if (extras.has(key)) extras.delete(key);
  else extras.add(key);
  button.setAttribute("aria-pressed", extras.has(key));
  if (key === "snart") options.saveSetting(USE_SOON_KEY, extras.has(key) ? "1" : "0");
  renderSummary();
});

// "Valg ›": åpne vinduet med ønsker, porsjoner og "Har alltid"
$("options-open").addEventListener("click", () => optionsDialog.showModal());
$("options-close").addEventListener("click", () => optionsDialog.close());
$("options-done").addEventListener("click", () => optionsDialog.close());

// Linjen over "Finn forslag": "4 pers. · Rask · Bruker det som snart går ut (Kjøttdeig)"
const EXTRA_LABELS = { rask: "Rask", vegetar: "Vegetar", bare: "Bare det jeg har" };

function renderSummary() {
  if (!options) return; // appen er ikke koblet til ennå
  const soon = soonItems();
  const soonNames = soon.map((i) => i.name).join(", ");
  const parts = [`${servings} pers.`];
  for (const [key, label] of Object.entries(EXTRA_LABELS)) {
    if (extras.has(key)) parts.push(label);
  }
  if (extras.has("snart") && soon.length) parts.push(`Bruker det som snart går ut (${soonNames})`);
  optionsSummary.textContent = parts.join(" · ");

  // I vinduet: knappen og navnene vises bare når noe går ut snart
  useSoonChip.hidden = soon.length === 0;
  soonNamesEl.hidden = soon.length === 0;
  soonNamesEl.textContent = `Går ut snart: ${soonNames}`;
}

// Porsjoner: − 4 pers. + (huskes på brukeren)
function renderServings() {
  servingsText.textContent = `${servings} pers.`;
  $("servings-minus").disabled = servings <= 1;
  $("servings-plus").disabled = servings >= MAX_SERVINGS;
  renderSummary();
}

function setServings(value) {
  servings = Math.min(MAX_SERVINGS, Math.max(1, value));
  renderServings();
  saveRecipeSettings({ servings }).catch(console.error);
}
$("servings-minus").addEventListener("click", () => setServings(servings - 1));
$("servings-plus").addEventListener("click", () => setServings(servings + 1));

// ---------- Hva har du? (appen sjekker selv mot lageret) ----------

// Del opp i ord: "Hakkede tomater" -> ["hakkede", "tomater"]
function words(text) {
  return String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// Er to ord "samme vare"? Tåler flertall og sammensatte ord:
// tomat/tomater, løk/rødløk, melk/lettmelk, kylling/kyllingfilet
function wordsMatch(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 3) return false;
  if (long.endsWith(short)) return true;
  if (long.startsWith(short)) return long.length - short.length <= 3 || short.length >= 6;
  return false;
}

// Finn varen i lageret som passer til en ingrediens – helst den som går ut først.
// Ingrediensens siste ord sammenlignes ("hakkede tomater" -> "tomater"),
// så "hakkede mandler" ikke regnes som tomater.
function findItem(ingredientName) {
  const name = String(ingredientName).toLowerCase().trim();
  const last = words(name).pop();
  if (!last) return null;
  const matches = items.filter(
    (item) =>
      item.quantity !== 0 &&
      (item.name.toLowerCase() === name || words(item.name).some((w) => wordsMatch(last, w)))
  );
  matches.sort((a, b) => (a.expires || "9999").localeCompare(b.expires || "9999"));
  return matches[0] || null;
}

// Er dette en basisvare? "Hvetemel" passer "mel", men "melk" passer ikke "mel".
function isBasic(name) {
  const text = String(name).toLowerCase();
  const nameWords = words(text);
  return basics.some((basic) => {
    const b = basic.toLowerCase().trim();
    if (!b) return false;
    if (b.includes(" ")) return text.includes(b); // "vanlige krydder"
    return nameWords.some((w) => w === b || (b.length >= 3 && w.endsWith(b)));
  });
}

// Status for én ingrediens: { item } = finnes i lageret, basic = har alltid
function checkIngredient(ing) {
  const item = findItem(ing.name);
  return { ...ing, item, basic: !item && isBasic(ing.name) };
}

function checkMeal(meal) {
  const ingredients = (meal.ingredients || []).map(checkIngredient);
  return {
    ingredients,
    missing: ingredients.filter((ing) => !ing.item && !ing.basic),
    soon: ingredients.filter((ing) => ing.item && options.isSoon(ing.item)),
    used: ingredients.filter((ing) => ing.item),
  };
}

// ---------- Spørre AI-en ----------

function soonItems() {
  return items
    .filter((item) => options.isSoon(item))
    .sort((a, b) => a.expires.localeCompare(b.expires));
}

// Teksten som sendes til AI-en
function buildPrompt() {
  const lines = ["Dette har jeg hjemme:"];
  for (const [location, label] of Object.entries(options.locations)) {
    const here = items
      .filter((i) => i.location === location)
      .map((i) => {
        const qty = options.formatQty(i);
        return qty ? `${i.name} (${qty})` : i.name;
      });
    if (here.length) lines.push(`- ${label}: ${here.join(", ")}`);
  }
  lines.push(`Dette har jeg alltid hjemme, og kan brukes fritt: ${[...basics, "vann"].join(", ")}.`);

  // "Bruk det som snart går ut" av: AI-en får ikke vite hva som går ut snart
  const soon = extras.has("snart") ? soonItems() : [];
  if (soon.length) {
    lines.push(`Dette bør brukes snart: ${soon.map((i) => i.name).join(", ")}`);
  }

  lines.push(
    "",
    `Foreslå 5 retter til ${mealType} som jeg kan lage med det jeg har.`,
    "Velg retter som bruker mest mulig av varene mine, og som passer naturlig sammen."
  );
  if (soon.length) {
    lines.push(
      "Bruk det som bør brukes snart i så mange av rettene som mulig, men bare der det passer naturlig. " +
        "Ikke tving det inn i retter der det ikke hører hjemme."
    );
  }
  if (extras.has("rask")) lines.push("Hver rett skal ta under 30 minutter.");
  if (extras.has("vegetar")) lines.push("Alle rettene skal være vegetariske.");
  if (extras.has("bare")) {
    lines.push("Bruk bare det jeg har. Ingen ingredienser skal måtte kjøpes.");
  } else {
    lines.push("Hver rett kan gjerne mangle 1–2 ingredienser som må kjøpes, men ikke flere.");
  }
  // Ikke de samme forslagene igjen når man trykker "Flere forslag" (bare de siste 20)
  const seen = [...meals, ...favorites].map((m) => m.name).slice(-20);
  if (seen.length) lines.push(`Ikke foreslå disse, dem har jeg allerede: ${seen.join(", ")}.`);
  lines.push(
    "",
    `Mengdene skal være for ${servings} ${servings === 1 ? "person" : "personer"}.`,
    "Bruk samme navn som i listene over når en ingrediens er noe jeg har.",
    "Skriv alt på norsk bokmål. Fremgangsmåten skal være korte steg."
  );
  return lines.join("\n");
}

suggestBtn.addEventListener("click", async () => {
  if (items.length === 0) {
    showStatus("Legg inn noen varer først, så har AI-en noe å gå ut fra.");
    return;
  }
  suggestBtn.disabled = true;
  suggestBtn.textContent = "Tenker …";
  showStatus("");
  try {
    const result = await suggestMeals(buildPrompt());
    // Husk type og porsjoner, så de vises riktig senere
    const newMeals = (result.meals || [])
      .filter((m) => m && m.name)
      .map((m) => ({ ...m, type: mealType, servings }));
    // De nye legges under dem du allerede har fått
    const firstNew = meals.length;
    meals = [...meals, ...newMeals];
    options.saveSetting(SAVED_KEY, JSON.stringify(meals));
    suggestBtn.disabled = false;
    renderRecipes();
    if (newMeals.length === 0) showStatus("AI-en fant ingen forslag. Prøv igjen.");
    else if (Number.isFinite(result.remaining)) showStatus(`${result.remaining} søk igjen i dag`);
    // Bla ned til de nye, så man ser at de kom
    if (firstNew > 0 && newMeals.length) {
      listEl.querySelector(`[data-index="${firstNew}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch (error) {
    showStatus(aiErrorMessage(error), true);
    suggestBtn.disabled = false;
    renderRecipes();
  }
});

// "Fjern forslagene": start på nytt (favorittene blir liggende)
clearBtn.addEventListener("click", () => {
  meals = [];
  options.saveSetting(SAVED_KEY, "[]");
  showStatus("");
  renderRecipes();
});

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.classList.toggle("error", isError);
}

// ---------- Visning ----------

// Rekkefølgen på typene – samme som knappene
const MEAL_TYPES = ["middag", "lunsj", "frokost", "dessert"];

// "middag" -> "Middag" (teksten på knappen)
function typeLabel(type) {
  return typeChips.querySelector(`[data-type="${type}"]`)?.textContent || type;
}

function isFavorite(meal) {
  return favorites.some((f) => f.name.toLowerCase() === meal.name.toLowerCase());
}

function renderRecipes() {
  if (section.hidden || !options) return;

  renderSummary(); // hva som går ut snart kan ha endret seg

  if (!suggestBtn.disabled) suggestBtn.textContent = meals.length ? "✨ Flere forslag" : "✨ Finn forslag";
  clearBtn.hidden = meals.length === 0;

  // Favoritter (sammenfoldet liste øverst)
  favoritesEl.hidden = favorites.length === 0;
  favoritesTitle.textContent = `♥ Favoritter (${favorites.length})`;
  favoritesList.innerHTML = "";
  favorites.forEach((meal, index) => favoritesList.append(createCard(meal, "favorite", index)));

  // Forslagene, med overskrift per type når det er flere typer
  listEl.innerHTML = "";
  const typeOf = (meal) => meal.type || "middag"; // forslag fra før typene ble husket
  const types = MEAL_TYPES.filter((type) => meals.some((meal) => typeOf(meal) === type));
  for (const type of types) {
    if (types.length > 1) {
      const heading = document.createElement("li");
      heading.className = "recipe-heading";
      const count = meals.filter((meal) => typeOf(meal) === type).length;
      heading.textContent = `${typeLabel(type)} (${count})`;
      listEl.append(heading);
    }
    meals.forEach((meal, index) => {
      if (typeOf(meal) === type) listEl.append(createCard(meal, "suggestion", index));
    });
  }
}

// Kort: navn, kort beskrivelse, hva som mangler, ev. hva som snart går ut
function createCard(meal, source, index) {
  const check = checkMeal(meal);
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "recipe-card";
  button.dataset.source = source;
  button.dataset.index = index;

  const name = document.createElement("span");
  name.className = "recipe-name";
  name.textContent = (source === "suggestion" && isFavorite(meal) ? "♥ " : "") + meal.name;
  button.append(name);

  if (meal.description) {
    const description = document.createElement("small");
    description.textContent = meal.description;
    button.append(description);
  }

  const status = document.createElement("small");
  status.className = check.missing.length ? "recipe-missing" : "recipe-ok";
  if (check.missing.length) {
    // "Mangler:" i fet skrift, så det synes uten å bruke en ny farge
    const label = document.createElement("strong");
    label.textContent = "Mangler:";
    status.append(label, ` ${check.missing.map((ing) => ing.name).join(", ")}`);
  } else {
    status.textContent = "Du har alt";
  }
  if (meal.time) status.append(` · ${meal.time}`);
  button.append(status);

  if (check.soon.length) {
    button.classList.add("uses-soon");
    const soonEl = document.createElement("small");
    soonEl.className = "recipe-soon";
    soonEl.textContent = `Bruker ${[...new Set(check.soon.map((ing) => ing.item.name))].join(", ")}`;
    button.append(soonEl);
  }

  li.append(button);
  return li;
}

function mealFromCard(card) {
  const list = card.dataset.source === "favorite" ? favorites : meals;
  return list[Number(card.dataset.index)];
}

for (const list of [listEl, favoritesList]) {
  list.addEventListener("click", (event) => {
    const card = event.target.closest(".recipe-card");
    if (card) openMeal(mealFromCard(card));
  });
}

favoritesEl.addEventListener("toggle", () => {
  options.saveSetting(FAVORITES_OPEN_KEY, favoritesEl.open ? "1" : "0");
});

// ---------- Vise én rett ----------

function openMeal(meal) {
  if (!meal) return;
  openMealData = meal;
  const check = checkMeal(meal);

  viewTitle.textContent = meal.name;
  const people = meal.servings ? `${meal.servings} ${meal.servings === 1 ? "person" : "personer"}` : "";
  viewInfo.textContent = [people, meal.time, meal.description].filter(Boolean).join(" · ");
  viewInfo.hidden = !viewInfo.textContent;

  viewIngredients.innerHTML = "";
  for (const ing of check.ingredients) {
    const has = Boolean(ing.item) || ing.basic;
    const li = document.createElement("li");
    li.className = has ? "has" : "missing";
    if (ing.item && options.isSoon(ing.item)) li.classList.add("soon");
    const mark = document.createElement("span");
    mark.className = "ingredient-mark";
    mark.textContent = has ? "✓" : "✕";
    const text = document.createElement("span");
    text.className = "ingredient-text";
    text.textContent = [ing.amount, ing.name].filter(Boolean).join(" ");
    const note = document.createElement("small");
    note.textContent = ing.item
      ? options.locations[ing.item.location]
      : ing.basic ? "har alltid" : "mangler";
    li.append(mark, text, note);
    viewIngredients.append(li);
  }

  viewSteps.innerHTML = "";
  for (const step of meal.steps || []) {
    const li = document.createElement("li");
    li.textContent = step;
    viewSteps.append(li);
  }

  updateFavoriteButton();
  viewDialog.showModal();
}

// ♡ Lagre som favoritt / ♥ Favoritt
function updateFavoriteButton() {
  const fav = openMealData && isFavorite(openMealData);
  favoriteBtn.textContent = fav ? "♥" : "♡";
  favoriteBtn.classList.toggle("is-favorite", Boolean(fav));
  favoriteBtn.setAttribute("aria-label", fav ? "Fjern fra favoritter" : "Lagre som favoritt");
  favoriteBtn.title = favoriteBtn.getAttribute("aria-label");
}

favoriteBtn.addEventListener("click", () => {
  const meal = openMealData;
  if (!meal) return;
  const existing = favorites.find((f) => f.name.toLowerCase() === meal.name.toLowerCase());
  if (existing) {
    deleteFavorite(existing.id).catch(options.showError);
    favorites = favorites.filter((f) => f !== existing);
    options.showToast(`«${meal.name}» er fjernet fra favoritter`);
  } else {
    const { id: _id, ...data } = meal; // id fra Firebase skal ikke lagres inni
    const favorite = { ...data, saved: Date.now() };
    const { id, saved } = addFavorite(favorite);
    saved.catch(options.showError);
    favorites = [{ id, ...favorite }, ...favorites];
    options.showToast(`«${meal.name}» er lagret som favoritt`);
  }
  updateFavoriteButton();
  renderRecipes();
});

$("recipe-close").addEventListener("click", () => viewDialog.close());
$("recipe-done").addEventListener("click", () => viewDialog.close());

// ---------- "Jeg lagde denne": trekk fra lageret ----------

$("recipe-cooked").addEventListener("click", () => {
  const meal = openMealData;
  if (!meal) return;
  viewDialog.close();
  openCooked(meal);
});

// Én rad per vare som ble brukt: [✓] Kyllingfilet · Fryser   Igjen: [0] pk
function openCooked(meal) {
  cookedTitle.textContent = `Du lagde: ${meal.name}`;
  cookedList.innerHTML = "";

  // Samme vare kan passe til flere ingredienser – vis den bare én gang
  const used = [...new Map(checkMeal(meal).used.map((ing) => [ing.item.id, ing.item])).values()];
  for (const item of used) {
    const li = document.createElement("li");
    li.dataset.id = item.id;

    const label = document.createElement("label");
    label.className = "cooked-item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    const name = document.createElement("span");
    name.className = "cooked-name";
    name.textContent = item.name;
    const where = document.createElement("small");
    where.textContent = options.locations[item.location];
    name.append(where);
    label.append(box, name);
    li.append(label);

    // Med antall: velg hvor mye som er igjen (forslag: ett steg mindre).
    // Uten antall: avkrysset betyr "brukt opp".
    const rest = document.createElement("span");
    rest.className = "cooked-rest";
    if (item.quantity != null) {
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "any";
      input.inputMode = "decimal";
      input.value = options.roundQty(Math.max(0, item.quantity - options.stepFor(item.unit)));
      input.setAttribute("aria-label", `Hvor mye ${item.name} er igjen`);
      rest.append("Igjen: ", input, item.unit ? ` ${item.unit}` : "");
    } else {
      rest.textContent = "Brukt opp";
    }
    li.append(rest);

    box.addEventListener("change", () => li.classList.toggle("skip", !box.checked));
    cookedList.append(li);
  }

  cookedEmpty.hidden = used.length > 0;
  cookedSave.hidden = used.length === 0;
  cookedDialog.showModal();
}

$("cooked-cancel").addEventListener("click", () => cookedDialog.close());

// Oppdater lageret. 0 igjen (eller "brukt opp") = varen slettes. Kan angres.
cookedSave.addEventListener("click", () => {
  const undo = [];
  for (const li of cookedList.children) {
    if (!li.querySelector('input[type="checkbox"]').checked) continue;
    const item = items.find((i) => i.id === li.dataset.id);
    if (!item) continue;
    const input = li.querySelector('input[type="number"]');
    const left = input && input.value !== "" ? Number(input.value) : 0;
    if (left > 0) {
      if (left === item.quantity) continue; // ingen endring
      updateItem(item.id, { quantity: left }).catch(options.showError);
      undo.push(() => updateItem(item.id, { quantity: item.quantity }));
    } else {
      deleteItem(item.id).catch(options.showError);
      undo.push(() => importItem({ ...item }));
    }
  }
  cookedDialog.close();
  if (undo.length === 0) return;
  options.showToast(`Lageret er oppdatert (${undo.length} ${undo.length === 1 ? "vare" : "varer"})`, () =>
    undo.forEach((fn) => fn().catch(options.showError))
  );
});

// ---------- "Har alltid" ----------

// Linjen "Har alltid: salt, pepper, …" og knappene i vinduet
function renderBasics() {
  basicsText.textContent = basics.length ? basics.join(", ") : "ingenting";
  basicsList.innerHTML = "";
  for (const basic of basics) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.dataset.basic = basic;
    chip.setAttribute("aria-label", `Fjern ${basic}`);
    chip.textContent = `${basic} ✕`;
    basicsList.append(chip);
  }
}

$("basics-edit").addEventListener("click", () => {
  renderBasics();
  basicsDialog.showModal();
  basicsInput.focus();
});
$("basics-close").addEventListener("click", () => basicsDialog.close());

// Lagre listen (vises med en gang, Firebase sier fra like etterpå)
function setBasics(list) {
  basics = list;
  renderBasics();
  renderRecipes();
  saveRecipeSettings({ basics: list }).catch(console.error);
}

// Trykk på en vare: fjern den
basicsList.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-basic]");
  if (chip) setBasics(basics.filter((b) => b !== chip.dataset.basic));
});

// Legg til ny (flere med komma: "ris, hvitløk")
basicsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const added = basicsInput.value
    .split(",")
    .map((b) => b.trim().toLowerCase())
    .filter((b) => b && !basics.includes(b));
  if (added.length) setBasics([...basics, ...added]);
  basicsInput.value = "";
  basicsInput.focus();
});

$("basics-reset").addEventListener("click", () => setBasics(DEFAULT_BASICS));

renderBasics();
renderServings();

// Trykk i det mørke feltet utenfor et vindu lukker det
for (const dialog of [basicsDialog, viewDialog, cookedDialog, optionsDialog]) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return; // trykk inni vinduet
    const box = dialog.getBoundingClientRect();
    const outside =
      event.clientX < box.left || event.clientX > box.right ||
      event.clientY < box.top || event.clientY > box.bottom;
    if (outside) dialog.close();
  });
}
