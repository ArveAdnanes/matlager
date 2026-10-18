// All kontakt med Firebase (innlogging + database) samlet ett sted.
// app.js bruker bare funksjonene som er merket med "export".

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  onSnapshot,
  addDoc,
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

export function addItem(item) {
  return addDoc(itemsRef(), item);
}

export function updateItem(id, changes) {
  return updateDoc(doc(itemsRef(), id), changes);
}

export function deleteItem(id) {
  return deleteDoc(doc(itemsRef(), id));
}

// Brukes ved flytting av gamle varer: beholder samme id, så samme vare
// ikke kan bli lagt inn to ganger
export function importItem(item) {
  const { id, ...data } = item;
  return setDoc(doc(itemsRef(), id), data);
}
