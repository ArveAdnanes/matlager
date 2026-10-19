// All kontakt med Firebase (innlogging + database) samlet ett sted.
// app.js bruker bare funksjonene som er merket med "export".

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  Schema,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";

// Fra Firebase-konsollen. Dette er ikke hemmelig – det er sikkerhetsreglene
// i Firestore som beskytter dataene.
const firebaseConfig = {
  apiKey: "AIzaSyBWIxZMhzC0XPPcuW26tRF9KpXksIZXS-M",
  authDomain: "matlager-495bd.firebaseapp.com",
  projectId: "matlager-495bd",
  storageBucket: "matlager-495bd.firebasestorage.app",
  messagingSenderId: "418161266663",
  appId: "1:418161266663:web:c09e147888742f50143742",
};

const app = initializeApp(firebaseConfig);

// App Check: beviser overfor Firebase at forespørslene kommer fra Matlager,
// så ingen andre kan bruke AI-kvoten din. Nøkkelen er fra reCAPTCHA
// Enterprise (ikke hemmelig). På egen PC (Live Server) brukes en
// "debug-token" i stedet – den skrives ut i konsollen og registreres i Firebase.
const RECAPTCHA_SITE_KEY = "";
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
if (isLocal) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
if (isLocal || RECAPTCHA_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY || "debug"),
    isTokenAutoRefreshEnabled: true,
  });
}
const auth = getAuth(app);

// Database med lokal lagring: virker uten nett og synker når nettet er tilbake
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ---------- Innlogging ----------

// Firebase krever e-post, så brukernavnet gjøres om til en "falsk" adresse.
// example.com er reservert, så det sendes aldri e-post noe sted.
const EMAIL_DOMAIN = "@matlager.example.com";

export function emailToUsername(email) {
  return email.replace(EMAIL_DOMAIN, "");
}

export function signUp(username, password) {
  return createUserWithEmailAndPassword(auth, username + EMAIL_DOMAIN, password);
}

export function signIn(username, password) {
  return signInWithEmailAndPassword(auth, username + EMAIL_DOMAIN, password);
}

export function logOut() {
  return signOut(auth);
}

// Bytt passord. Firebase krever at man bekrefter nåværende passord først.
export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

// Kaller callback(user) ved innlogging og callback(null) ved utlogging
export function watchUser(callback) {
  return onAuthStateChanged(auth, callback);
}

// ---------- Varer ----------

// Varene ligger i users/{brukerId}/items – hver bruker har sin egen samling
function itemsRef() {
  return collection(db, "users", auth.currentUser.uid, "items");
}

// Kaller callback(varer) nå og hver gang noe endres (også fra andre enheter).
// onError kalles hvis noe går galt (f.eks. feil i sikkerhetsreglene).
// Returnerer en funksjon som stopper lyttingen.
export function watchItems(callback, onError) {
  return onSnapshot(
    itemsRef(),
    (snapshot) => {
      callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    onError
  );
}

// Legg til en vare. Id-en lages med en gang (før lagringen er ferdig),
// så appen kan lyse opp den nye varen i listen.
// Returnerer { id, saved } – saved er et løfte som feiler hvis lagringen feiler.
export function addItem(item) {
  const ref = doc(itemsRef());
  return { id: ref.id, saved: setDoc(ref, item) };
}

export function updateItem(id, changes) {
  return updateDoc(doc(itemsRef(), id), changes);
}

export function deleteItem(id) {
  return deleteDoc(doc(itemsRef(), id));
}

// Legger inn en vare med en bestemt id. Brukes ved flytting av gamle varer
// og ved "Angre" etter sletting, så varen får tilbake samme id.
export function importItem(item) {
  const { id, ...data } = item;
  return setDoc(doc(itemsRef(), id), data);
}

// ---------- Navnehistorikk (husker enheten for varer du har hatt før) ----------

// Varer du har lagt inn før – blir liggende selv om varen slettes.
// Ligger i users/{brukerId}/history, én per varenavn.
function historyRef() {
  return collection(db, "users", auth.currentUser.uid, "history");
}

// Husk navn, enhet, lagringssted og kategori for en vare
export function rememberName(item) {
  const key = item.name.toLowerCase().replace(/\//g, "_"); // "/" er ikke lov i id
  return setDoc(doc(historyRef(), key), {
    name: item.name,
    unit: item.unit || "",
    location: item.location,
    category: item.category || "",
  });
}

// Kaller callback(historikk) nå og hver gang den endres
export function watchHistory(callback) {
  return onSnapshot(historyRef(), (snapshot) => {
    callback(snapshot.docs.map((d) => d.data()));
  });
}

// ---------- Kategorier (egne for hvert sted) ----------

// Ligger i users/{brukerId}/categories: { name, location }
function categoriesRef() {
  return collection(db, "users", auth.currentUser.uid, "categories");
}

// Kaller callback(kategorier) nå og hver gang de endres
export function watchCategories(callback, onError) {
  return onSnapshot(
    categoriesRef(),
    (snapshot) => {
      callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    onError
  );
}

// Lag kategori. Id-en lages med en gang, så den kan velges med en gang.
export function addCategory(category) {
  const ref = doc(categoriesRef());
  return { id: ref.id, saved: setDoc(ref, category) };
}

export function renameCategory(id, name) {
  return updateDoc(doc(categoriesRef(), id), { name });
}

// Ny rekkefølge: ids i ønsket rekkefølge får order 0, 1, 2 …
export function reorderCategories(ids) {
  const batch = writeBatch(db);
  ids.forEach((id, index) => batch.update(doc(categoriesRef(), id), { order: index }));
  return batch.commit();
}

// Slett kategori og flytt varene i den til "Andre" – alt på én gang
export function deleteCategory(id, itemIds) {
  const batch = writeBatch(db);
  batch.delete(doc(categoriesRef(), id));
  for (const itemId of itemIds) {
    batch.update(doc(itemsRef(), itemId), { category: "" });
  }
  return batch.commit();
}

// Angre sletting: legg kategorien tilbake og flytt varene inn i den igjen
export function restoreCategory(category, itemIds) {
  const { id, ...data } = category;
  const batch = writeBatch(db);
  batch.set(doc(categoriesRef(), id), data);
  for (const itemId of itemIds) {
    batch.update(doc(itemsRef(), itemId), { category: id });
  }
  return batch.commit();
}

// ---------- Innstillinger for oppskrifter ----------

// Ligger i users/{brukerId}/settings/recipes: { basics: ["salt", …], servings: 4 }
function recipeSettingsRef() {
  return doc(db, "users", auth.currentUser.uid, "settings", "recipes");
}

// Kaller callback({ basics, servings }) nå og ved endringer ({} hvis ingenting er lagret)
export function watchRecipeSettings(callback) {
  return onSnapshot(recipeSettingsRef(), (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : {});
  });
}

// Lagre én eller flere innstillinger, f.eks. { servings: 2 }
export function saveRecipeSettings(changes) {
  return setDoc(recipeSettingsRef(), changes, { merge: true });
}

// ---------- Favorittoppskrifter ----------

// Ligger i users/{brukerId}/favorites: hele retten fra AI-en + saved
function favoritesRef() {
  return collection(db, "users", auth.currentUser.uid, "favorites");
}

export function watchFavorites(callback) {
  return onSnapshot(favoritesRef(), (snapshot) => {
    callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function addFavorite(meal) {
  const ref = doc(favoritesRef());
  return { id: ref.id, saved: setDoc(ref, meal) };
}

export function deleteFavorite(id) {
  return deleteDoc(doc(favoritesRef(), id));
}

// ---------- AI: forslag til hva du kan lage ----------

// Googles Gemini via Firebase AI Logic. Bytt navnet her for å prøve en annen modell.
const AI_MODEL = "gemini-3.6-flash";

// Svaret skal alltid ha denne formen, så appen kan vise det pent
const suggestionSchema = Schema.object({
  properties: {
    meals: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string({ description: "Navnet på retten" }),
          description: Schema.string({ description: "Én kort setning om retten" }),
          time: Schema.string({ description: "Omtrentlig tid, f.eks. 30 min" }),
          ingredients: Schema.array({
            items: Schema.object({
              properties: {
                name: Schema.string(),
                amount: Schema.string({ description: "Mengde, f.eks. 400 g. Tom hvis ukjent." }),
                have: Schema.boolean({ description: "true hvis den finnes blant det brukeren har" }),
              },
            }),
          }),
          steps: Schema.array({ items: Schema.string() }),
        },
      }),
    }),
  },
});

let model = null;

// Grense: hver bruker kan trykke "Finn forslag" så mange ganger per dag.
// Brukerne i listen under har ingen grense.
export const AI_DAILY_LIMIT = 5;
const AI_UNLIMITED_USERS = ["arve"];

// Dagens dato, f.eks. "2026-10-19"
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Tell opp én bruk i users/{brukerId}/usage/ai: { date, count }.
// Returnerer hvor mange som er igjen i dag (Infinity = ingen grense).
// Kaster en feil med code "daily-limit" når dagens grense er nådd.
async function takeAiQuota() {
  const user = auth.currentUser;
  if (AI_UNLIMITED_USERS.includes(emailToUsername(user.email))) return Infinity;
  const ref = doc(db, "users", user.uid, "usage", "ai");
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists() ? snapshot.data() : {};
    const used = data.date === today() ? data.count : 0;
    if (used >= AI_DAILY_LIMIT) {
      const error = new Error("Dagens grense er nådd");
      error.code = "daily-limit";
      throw error;
    }
    transaction.set(ref, { date: today(), count: used + 1 });
    return AI_DAILY_LIMIT - used - 1;
  });
}

// Søket mislyktes: gi tilbake den ene bruken, så den ikke teller
async function giveBackAiQuota() {
  const user = auth.currentUser;
  if (AI_UNLIMITED_USERS.includes(emailToUsername(user.email))) return;
  const ref = doc(db, "users", user.uid, "usage", "ai");
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists() ? snapshot.data() : {};
    if (data.date === today() && data.count > 0) {
      transaction.set(ref, { date: today(), count: data.count - 1 });
    }
  });
}

// "Modellen er overbelastet" (500/503) – går som regel over av seg selv
export function isBusyError(error) {
  return /\b50[03]\b|high demand|overloaded|unavailable/i.test(String(error?.message || error));
}

// Send teksten til AI-en, og få tilbake { meals: [...], remaining }
export async function suggestMeals(prompt) {
  const remaining = await takeAiQuota();
  try {
    return { ...(await askModel(prompt)), remaining };
  } catch (error) {
    giveBackAiQuota().catch(console.error);
    throw error;
  }
}

// Spør modellen. Ingen automatisk nytt forsøk: hvert forsøk teller mot
// gratiskvoten (20 per døgn), så brukeren får heller beskjed om å prøve igjen.
async function askModel(prompt) {
  if (!model) {
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    model = getGenerativeModel(ai, {
      model: AI_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: suggestionSchema,
      },
    });
  }
  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}
