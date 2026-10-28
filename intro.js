// Introduksjon: skjermen blir mørk, og det som forklares lyser opp
// (f.eks. + og 📷), med en liten boble og en pil som peker på det.
// Vises automatisk første gang (demobrukeren eller ny bruker uten varer),
// og kan vises igjen fra kontomenyen. app.js bestemmer når.

const $ = (id) => document.getElementById(id);

const overlay = $("intro");
const holesEl = $("intro-holes"); // hullene i den mørke hinna (SVG-maske)
const ringsEl = $("intro-rings"); // lys kant rundt hullene
const bubble = $("intro-bubble");
const arrow = $("intro-arrow");
const logo = $("intro-logo");
const countEl = $("intro-count");
const titleEl = $("intro-title");
const textEl = $("intro-text");
const dotsEl = $("intro-dots");
const backBtn = $("intro-back");
const nextBtn = $("intro-next");
const closeBtn = $("intro-close");

const SVG_NS = "http://www.w3.org/2000/svg";
const PAD = 6; // luft rundt det som lyser opp
const GAP = 14; // avstand mellom det som lyser opp og boblen (plass til pila)
const MARGIN = 12; // boblen holder seg så langt fra skjermkanten

// Mobil og PC har ulike knapper
const wideScreen = matchMedia("(min-width: 900px)");

// Hvert steg: tittel, kort tekst og hva som skal lyse opp (CSS-selektorer).
// Uten targets (eller hvis de ikke synes) står boblen midt på skjermen.
// enter/leave: bytte visning når man går inn i eller ut av steget.
const STEPS = [
  {
    welcome: true,
    title: "Velkommen til Matlager",
    text: ({ demo }) =>
      (demo ? "Dette er en demo med varer lagt inn. " : "") +
      "Her har du oversikt over maten din og ser hva som snart går ut. Vil du ta en rask runde?",
  },
  {
    title: "Legg til varer",
    targets: ({ wide }) => (wide ? ["#add-card"] : ["#add-open", "#scan-fab"]),
    text: ({ wide }) =>
      wide
        ? "Skriv inn en vare her – eller bruk «📷 Fra bilde» for å legge inn alt fra et bilde eller en kvittering."
        : "Trykk + for å skrive inn en vare, eller 📷 for å ta bilde av varer eller en kvittering.",
  },
  {
    title: "Varene dine",
    targets: () => ["#list .swipe-row"],
    text: ({ wide }) =>
      "Bruk − og + for å endre antallet, og trykk på varen for å endre den. " +
      (wide ? "Søppelbøtta kommer fram når du holder musa over." : "Sveip mot venstre for å slette."),
  },
  {
    title: "Bruk snart",
    targets: () => ["#expiring"],
    text: () => "Her ser du det som har gått ut eller går ut snart – fra alle stedene.",
  },
  {
    title: "Hva kan jeg lage?",
    targets: ({ wide }) => (wide ? ["#recipes-open"] : ["#nav-recipes"]),
    text: () => "AI-en foreslår retter ut fra det du har. La oss ta en titt.",
  },
  {
    // Siste steg: introduksjonen åpner oppskriftsiden og slutter der
    enter: (hooks) => hooks.openRecipes?.(),
    leave: (hooks) => hooks.closeRecipes?.(),
    title: "Finn forslag",
    targets: () => ["#meal-type", "#options-open", "#suggest"],
    text: ({ demo }) =>
      "Velg måltid og trykk «Finn forslag». Under «Valg» kan du ønske f.eks. rask eller vegetar." +
      (demo ? " Prøv gjerne!" : ""),
  },
];

let step = 0;
let context = { demo: false };
let onDone = null;
let hooks = {}; // fra app.js: openRecipes/closeRecipes – steg kan bytte visning

export function showIntro({ demo = false, done, openRecipes, closeRecipes } = {}) {
  context = { demo };
  onDone = done;
  hooks = { openRecipes, closeRecipes };
  step = 0;
  holesEl.innerHTML = "";
  ringsEl.innerHTML = "";
  overlay.hidden = false;
  document.body.classList.add("intro-open");
  renderStep();
  nextBtn.focus();
}

// Det som skal lyse opp i dette steget – bare det som faktisk synes
function visibleTargets(s) {
  if (!s.targets) return [];
  return s.targets({ ...context, wide: wideScreen.matches })
    .map((selector) => document.querySelector(selector))
    .filter((el) => el && el.getClientRects().length > 0 && el.offsetWidth > 0);
}

function renderStep() {
  const s = STEPS[step];
  const first = step === 0;
  const last = step === STEPS.length - 1;

  bubble.classList.toggle("welcome", Boolean(s.welcome));
  logo.hidden = !s.welcome;
  countEl.hidden = first;
  countEl.textContent = `${step} av ${STEPS.length - 1}`; // velkomsten telles ikke
  titleEl.textContent = s.title;
  textEl.textContent = s.text({ ...context, wide: wideScreen.matches });

  // Velkomst: "Nei takk" / "Vis meg". Ellers: "Tilbake" / "Neste" / "Ferdig".
  backBtn.textContent = first ? "Nei takk" : "Tilbake";
  nextBtn.textContent = first ? "Vis meg" : last ? "Ferdig" : "Neste";

  dotsEl.innerHTML = "";
  dotsEl.hidden = first;
  for (let i = 1; i < STEPS.length; i++) {
    const dot = document.createElement("span");
    dot.className = "intro-dot";
    if (i === step) dot.classList.add("current");
    dotsEl.append(dot);
  }

  // Blar det som skal vises inn på skjermen (ikke nødvendig for faste knapper)
  const targets = visibleTargets(s);
  const firstTarget = targets[0];
  if (firstTarget && getComputedStyle(firstTarget).position !== "fixed") {
    const r = firstTarget.getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight - 200) {
      firstTarget.scrollIntoView({ block: "center" });
    }
  }
  place();

  // Teksten tones inn for hvert steg
  bubble.classList.remove("fade");
  void bubble.offsetWidth;
  bubble.classList.add("fade");
}

// Gjenbruk hull og ringer, så de glir fra ett steg til det neste
function ensureCount(container, count, create) {
  while (container.children.length < count) container.append(create());
  while (container.children.length > count) container.lastChild.remove();
  return [...container.children];
}

// Tegn hullene og plasser boblen (også når skjermen endrer størrelse eller blar)
function place() {
  if (overlay.hidden) return;
  const targets = visibleTargets(STEPS[step]);
  const holes = ensureCount(holesEl, targets.length, () => document.createElementNS(SVG_NS, "rect"));
  const rings = ensureCount(ringsEl, targets.length, () => {
    const ring = document.createElement("div");
    ring.className = "intro-ring";
    return ring;
  });

  let union = null; // rektangelet rundt alt som lyser opp
  targets.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const x = r.left - PAD, y = r.top - PAD, w = r.width + PAD * 2, h = r.height + PAD * 2;
    // Runde knapper får runde hull, ellers litt avrundede hjørner
    const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) + PAD || 12, w / 2, h / 2);

    // Nye hull/ringer skal dukke opp på plass, ikke gli inn fra hjørnet
    const isNew = !holes[i].dataset.placed;
    if (isNew) holes[i].style.transition = rings[i].style.transition = "none";

    // Som CSS (ikke attributter), så de kan gli med transition
    Object.assign(holes[i].style, { x: `${x}px`, y: `${y}px`, width: `${w}px`, height: `${h}px`, rx: `${radius}px` });
    Object.assign(rings[i].style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, borderRadius: `${radius}px` });

    if (isNew) {
      holes[i].dataset.placed = "1";
      requestAnimationFrame(() => {
        holes[i].style.transition = rings[i].style.transition = "";
      });
    }

    union = union
      ? { top: Math.min(union.top, y), bottom: Math.max(union.bottom, y + h), left: Math.min(union.left, x), right: Math.max(union.right, x + w) }
      : { top: y, bottom: y + h, left: x, right: x + w };
  });

  // Boblen: under det som lyser opp hvis det er plass, ellers over. Midt på uten mål.
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
  let top, left;
  arrow.hidden = !union;
  if (!union) {
    top = (innerHeight - bh) / 2;
    left = (innerWidth - bw) / 2;
  } else {
    const fitsBelow = union.bottom + GAP + bh <= innerHeight - MARGIN;
    top = fitsBelow ? union.bottom + GAP : Math.max(MARGIN, union.top - GAP - bh);
    const center = (union.left + union.right) / 2;
    left = Math.min(Math.max(center - bw / 2, MARGIN), innerWidth - bw - MARGIN);

    // Pila peker mot midten av det som lyser opp
    arrow.className = `intro-arrow ${fitsBelow ? "up" : "down"}`;
    arrow.style.left = `${Math.min(Math.max(center - left, 22), bw - 22)}px`;
  }
  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
}

addEventListener("resize", place);
addEventListener("scroll", place, { passive: true });

// Gå til et annet steg (og bytt visning hvis steget krever det)
function goTo(next) {
  const leave = STEPS[step].leave;
  const enter = STEPS[next].enter;
  step = next;
  if (leave && !STEPS[next].leave) leave(hooks);
  if (enter) enter(hooks);
  if (leave || enter) {
    setTimeout(renderStep, 250); // vent til den nye visningen er tegnet
  } else {
    renderStep();
  }
}

function finish() {
  if (overlay.hidden) return;
  overlay.hidden = true;
  document.body.classList.remove("intro-open");
  if (onDone) onDone();
  onDone = null;
}

nextBtn.addEventListener("click", () => {
  if (step < STEPS.length - 1) goTo(step + 1);
  else finish();
});

backBtn.addEventListener("click", () => {
  if (step === 0) finish(); // "Nei takk"
  else goTo(step - 1);
});

closeBtn.addEventListener("click", finish);

// Tastatur: Esc avslutter, piltastene blar
document.addEventListener("keydown", (event) => {
  if (overlay.hidden) return;
  if (event.key === "Escape") finish();
  else if (event.key === "ArrowRight") nextBtn.click();
  else if (event.key === "ArrowLeft" && step > 0) backBtn.click();
});
