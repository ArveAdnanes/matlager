// "Fra bilde": ta bilde av varer eller en kvittering (eller velg et bilde/PDF,
// eller lim inn på PC), og la AI-en finne varene. Du går gjennom dem én og én
// – eller legger til alle på en gang.

import { readFoodImage, aiErrorMessage, addItem, deleteItem, rememberName } from "./firebase.js";

const UNITS = ["stk", "pk", "g", "kg", "dl", "l"]; // gyldige enheter i appen
const MAX_FILE_MB = 15;

let options = null; // { locations, categoriesFor, findKnown, currentLocation, closeAddCard, showToast, showError }
let found = []; // varene AI-en fant (ferdig tilpasset)
let position = 0; // hvilken vare som vises
let addedIds = []; // lagt til i denne runden (for "Angre")
let source = ""; // "kvittering" eller "varer"
let busy = false;
let run = 0; // øker for hver lesing – svar fra en lesing som er avbrutt, ignoreres

// Elementer fra index.html
const $ = (id) => document.getElementById(id);
const appSection = $("app");
const openBtn = $("scan-open");
const fileInput = $("scan-file");
const dialog = $("scan-dialog");
const title = $("scan-title");
const statusEl = $("scan-status");
const form = $("scan-form");
const progress = $("scan-progress");
const nameInput = $("scan-name");
const qtyInput = $("scan-qty");
const unitSelect = $("scan-unit");
const locationSelect = $("scan-location");
const categoryLabel = $("scan-category-label");
const categorySelect = $("scan-category");
const expiresInput = $("scan-expires");
const noteInput = $("scan-note");
const estimatedEl = $("scan-estimated");
const allBtn = $("scan-all");

export function initScan(opts) {
  options = opts;
  for (const [value, label] of Object.entries(options.locations)) {
    locationSelect.append(new Option(label, value));
  }
}

// ---------- Velge bilde ----------

// Mobilen spør selv: ta bilde, eller velg fra bilder/filer.
// "📷 Fra bilde" i "Legg til", og kameraknappen over + på mobil.
function pickFile() {
  fileInput.value = ""; // så samme fil kan velges igjen
  fileInput.click();
}
openBtn.addEventListener("click", pickFile);
$("scan-fab").addEventListener("click", pickFile);

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// PC: lim inn et bilde (Ctrl+V) mens appen vises
document.addEventListener("paste", (event) => {
  if (appSection.hidden || dialog.open || busy) return;
  const file = [...(event.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (!file) return; // vanlig tekst limes inn som før
  event.preventDefault();
  handleFile(file);
});

// ---------- Sende bildet til AI-en ----------

async function handleFile(file) {
  if (busy) return;
  const isPdf = file.type === "application/pdf";
  if (!isPdf && !file.type.startsWith("image/")) {
    options.showToast("Velg et bilde eller en PDF");
    return;
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    options.showToast(`Filen er for stor (maks ${MAX_FILE_MB} MB)`);
    return;
  }

  busy = true;
  const thisRun = ++run;
  found = [];
  position = 0;
  addedIds = [];
  title.textContent = "Leser bildet …";
  showStatus("AI-en ser etter matvarer. Det kan ta litt tid.");
  form.hidden = true;
  if (!dialog.open) dialog.showModal();

  try {
    const prepared = await prepareFile(file, isPdf);
    const result = await readFoodImage(buildPrompt(), prepared);
    if (thisRun !== run) return; // vinduet ble lukket mens AI-en leste
    source = result.kind === "kvittering" ? "kvittering" : "bilde";
    found = (result.items || []).map(normalize).filter((item) => item.name);
    if (found.length === 0) {
      title.textContent = "Fant ingen varer";
      showStatus("Prøv et skarpere bilde, eller ta bilde av færre varer om gangen.");
    } else {
      showItem();
    }
  } catch (error) {
    if (thisRun !== run) return;
    title.textContent = "Det gikk ikke";
    showStatus(aiErrorMessage(error), true);
  } finally {
    if (thisRun === run) busy = false;
  }
}

// Bilder gjøres mindre før de sendes (raskere, og mindre av kvoten).
// Lange kvitteringer får beholde høyden, så teksten fortsatt kan leses.
async function prepareFile(file, isPdf) {
  if (isPdf) return { mimeType: file.type, data: await toBase64(file) };
  try {
    // Gi opp forminskingen etter 5 sekunder (da sendes bildet som det er)
    const bitmap = await Promise.race([
      createImageBitmap(file),
      new Promise((_, reject) => setTimeout(() => reject(new Error("tidsavbrudd")), 5000)),
    ]);
    const scale = Math.min(1, 1600 / bitmap.width, 6000 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return { mimeType: "image/jpeg", data: await toBase64(blob) };
  } catch {
    // Nettleseren kunne ikke lese bildet selv – send det som det er
    return { mimeType: file.type || "image/jpeg", data: await toBase64(file) };
  }
}

// Fil -> base64-tekst (uten "data:…;base64,"-starten)
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// "2026-10-22" for i dag
function todayString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Teksten som sendes sammen med bildet
function buildPrompt() {
  const categoryLines = Object.entries(options.locations).map(([location, label]) => {
    const names = options.categoriesFor(location).map((c) => c.name);
    return `- ${label} (${location}): ${names.length ? names.join(", ") : "ingen kategorier"}`;
  });
  return [
    `Dette er et bilde av matvarer, eller en kvittering fra en matbutikk. I dag er det ${todayString()}.`,
    "Finn alle matvarene og drikkevarene. Ta ikke med bæreposer, pant, rabatter, gebyrer eller andre ting som ikke er mat eller drikke.",
    "",
    "For hver vare:",
    "- name: kort, vanlig norsk navn med stor forbokstav, f.eks. «Kjøttdeig», «Lettmelk», «Spagetti». Skriv ut forkortelser fra kvitteringen. Ta bare med merkenavn når det er det folk kaller varen (f.eks. «Grandiosa»).",
    "- quantity og unit: antall pakker eller stykk – unit er alltid pk eller stk, aldri vekt eller volum. " +
      "2 pakker potetmos à 90 g blir quantity 2 og unit pk. Flasker, bokser, kartonger og enkeltvarer telles i stk (1 l melk blir 1 stk). " +
      "Løsvekt der antallet ikke står (f.eks. bananer 1,2 kg) blir quantity 1 og unit stk. " +
      "Står samme vare flere ganger, slå dem sammen.",
    "- note: vekt eller volum, f.eks. «90 g per pakke», «1 l» eller «ca. 1,2 kg». Tom hvis den ikke er kjent.",
    "- location: fryser, kjoleskap eller torrvarer – der varen vanligvis oppbevares.",
    "- category: navnet på en av kategoriene mine for det stedet (se under), eller tom hvis ingen passer.",
    "- expires: står utløpsdatoen på varen og kan leses, bruk den og sett expiresEstimated = false. " +
      "Ellers anslå datoen som typisk står på en uåpnet pakke av akkurat denne varen (best før / siste forbruksdag) " +
      "når den kjøpes – ikke hvor lenge den holder etter åpning. Regn fra kjøpsdatoen (datoen på kvitteringen, ellers i dag), " +
      "og sett expiresEstimated = true. " +
      "Eksempler: melk ca. 14 dager, fersk kjøttdeig ca. 6 dager, brød ca. 5 dager, yoghurt ca. 3 uker, hvitost ca. 2 måneder, " +
      "potetmospulver ca. 12 måneder, hermetiske tomater ca. 2 år, frosne varer ca. 12 måneder. " +
      "La datoen bare være tom for varer som praktisk talt aldri går ut, som salt, sukker og honning.",
    "",
    "Kategoriene mine:",
    ...categoryLines,
    "",
    "Svar på norsk bokmål.",
  ].join("\n");
}

// Gjør AI-ens svar trygt å bruke, og bruk det appen vet fra før:
// har du hatt varen før, brukes samme sted, enhet og kategori som sist.
function normalize(raw) {
  const name = String(raw.name || "").trim();
  let location = options.locations[raw.location] ? raw.location : options.currentLocation();
  let unit = UNITS.includes(raw.unit) ? raw.unit : "";
  const quantity = Number(raw.quantity) > 0 ? Math.round(Number(raw.quantity) * 100) / 100 : null;
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(raw.expires || "") ? raw.expires : "";

  const known = options.findKnown(name);
  if (known && options.locations[known.location]) location = known.location;
  // Enheten fra sist bare når AI-en ikke oppga noen (antallet hører til AI-ens enhet)
  if (known && known.unit && !unit) unit = known.unit;

  // Kategori: den du brukte sist (hvis den finnes på stedet), ellers AI-ens forslag
  const cats = options.categoriesFor(location);
  let category = "";
  if (known && cats.some((c) => c.id === known.category)) {
    category = known.category;
  } else {
    const match = cats.find((c) => c.name.toLowerCase() === String(raw.category || "").trim().toLowerCase());
    if (match) category = match.id;
  }

  const note = String(raw.note || "").trim();
  return { name, quantity, unit, location, category, expires, note, estimated: Boolean(expires && raw.expiresEstimated) };
}

// ---------- Én vare om gangen ----------

function showItem() {
  const item = found[position];
  title.textContent = `Fant ${found.length} ${found.length === 1 ? "vare" : "varer"}`;
  showStatus("");
  progress.textContent = `Vare ${position + 1} av ${found.length} · fra ${source}`;

  nameInput.value = item.name;
  qtyInput.value = item.quantity ?? "";
  unitSelect.value = item.unit;
  locationSelect.value = item.location;
  fillCategories(item.location, item.category);
  expiresInput.value = item.expires;
  noteInput.value = item.note;
  estimatedEl.hidden = !item.estimated;

  const left = found.length - position;
  allBtn.hidden = left < 2;
  allBtn.textContent = `Legg til alle ${left} som de er`;
  form.hidden = false;
}

// Kategoriene for valgt sted ("Ingen" hvis stedet ikke har noen)
function fillCategories(location, selectedId) {
  const cats = options.categoriesFor(location);
  categorySelect.innerHTML = "";
  categorySelect.append(new Option("Ingen", ""));
  for (const cat of cats) categorySelect.append(new Option(cat.name, cat.id));
  categorySelect.value = cats.some((c) => c.id === selectedId) ? selectedId : "";
  categoryLabel.hidden = cats.length === 0;
}

// Nytt sted: behold kategorien hvis det finnes en med samme navn der
locationSelect.addEventListener("change", () => {
  const currentName = categorySelect.selectedOptions[0]?.textContent.toLowerCase();
  const match = options.categoriesFor(locationSelect.value).find((c) => c.name.toLowerCase() === currentName);
  fillCategories(locationSelect.value, match ? match.id : "");
});

// Endrer du datoen selv, er den ikke lenger anslått
expiresInput.addEventListener("input", () => (estimatedEl.hidden = true));

// Det som står i skjemaet nå
function itemFromForm() {
  return {
    name: nameInput.value.trim(),
    quantity: qtyInput.value === "" ? null : Number(qtyInput.value),
    unit: unitSelect.value,
    location: locationSelect.value,
    category: categorySelect.value,
    expires: expiresInput.value,
    note: noteInput.value.trim(),
  };
}

function save(item) {
  if (!item.name) return;
  const newItem = { ...item, note: item.note || "", added: Date.now() };
  const { id, saved } = addItem(newItem);
  saved.catch(options.showError);
  addedIds.push(id);
  rememberName(newItem).catch(options.showError); // husk sted, enhet og kategori til neste gang
}

function next() {
  position++;
  if (position < found.length) showItem();
  else finish();
}

// "Legg til" – denne varen, så neste
form.addEventListener("submit", (event) => {
  event.preventDefault();
  save(itemFromForm());
  next();
});

$("scan-skip").addEventListener("click", next);

// "Legg til alle": denne (med endringene dine) og resten slik AI-en foreslo
allBtn.addEventListener("click", () => {
  save(itemFromForm());
  for (const item of found.slice(position + 1)) {
    const { estimated, ...data } = item;
    save(data);
  }
  finish();
});

// Ferdig (eller lukket underveis): si hvor mange som ble lagt til, med "Angre"
function finish() {
  run++; // avbryt en lesing som pågår
  busy = false;
  const ids = addedIds;
  found = [];
  addedIds = [];
  if (dialog.open) dialog.close();
  if (ids.length === 0) return;
  options.closeAddCard();
  options.showToast(`${ids.length} ${ids.length === 1 ? "vare" : "varer"} lagt til`, () =>
    ids.forEach((id) => deleteItem(id).catch(options.showError))
  );
}

$("scan-close").addEventListener("click", finish);
dialog.addEventListener("cancel", (event) => {
  event.preventDefault(); // Esc: samme som ✕
  finish();
});

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.classList.toggle("error", isError);
}
