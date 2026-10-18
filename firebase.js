// All kontakt med Firebase (innlogging + database) samlet ett sted.
// app.js bruker bare funksjonene som er merket med "export".

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
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
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

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

// Husk navn, enhet og lagringssted for en vare
export function rememberName(item) {
  const key = item.name.toLowerCase().replace(/\//g, "_"); // "/" er ikke lov i id
  return setDoc(doc(historyRef(), key), {
    name: item.name,
    unit: item.unit || "",
    location: item.location,
  });
}

// Kaller callback(historikk) nå og hver gang den endres
export function watchHistory(callback) {
  return onSnapshot(historyRef(), (snapshot) => {
    callback(snapshot.docs.map((d) => d.data()));
  });
}
