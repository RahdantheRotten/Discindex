// Sign-in and online sync, using Firebase (Authentication + Firestore).
// Data layout: users/{uid}            -> { discogsToken, discogsUser }
//              users/{uid}/items/{key} -> one CD
import { firebaseConfig } from "./firebase-config.js";

const V = "10.12.2";
const CDN = `https://www.gstatic.com/firebasejs/${V}`;
export const enabled = !!firebaseConfig.apiKey;

let fb = null;
async function init() {
  if (fb) return fb;
  const [appMod, A, F] = await Promise.all([
    import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`)]);
  const app = appMod.initializeApp(firebaseConfig);
  fb = { auth: A.getAuth(app), db: F.getFirestore(app), A, F };
  return fb;
}

// ---- sign in / out ----

export async function onUserChange(cb) {
  if (!enabled) return cb(null);
  const { auth, A } = await init();
  A.onAuthStateChanged(auth, cb);
}

export async function signInGoogle() {
  const { auth, A } = await init();
  const provider = new A.GoogleAuthProvider();
  try {
    await A.signInWithPopup(auth, provider);
  } catch (e) {
    // iPhone home-screen apps and some browsers can't open the Google pop-up: use a full-page redirect instead
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e?.code))
      return A.signInWithRedirect(auth, provider);
    throw e;
  }
}
export async function signInEmail(email, pw) {
  const { auth, A } = await init();
  await A.signInWithEmailAndPassword(auth, email, pw);
}
export async function signUpEmail(email, pw) {
  const { auth, A } = await init();
  await A.createUserWithEmailAndPassword(auth, email, pw);
}
export async function resetPassword(email) {
  const { auth, A } = await init();
  await A.sendPasswordResetEmail(auth, email);
}
export async function signOut() {
  const { auth, A } = await init();
  await A.signOut(auth);
}

// Turn Firebase's error codes into plain sentences.
export function niceError(e) {
  const msgs = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "No account with that email. Create one instead?",
    "auth/email-already-in-use": "There's already an account with that email. Sign in instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "That doesn't look like an email address.",
    "auth/popup-closed-by-user": "The Google window was closed before signing in.",
    "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
    "auth/unauthorized-domain": "Sign-in isn't allowed on this web address yet (add it in Firebase → Authentication → Settings → Authorized domains).",
    "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
    "auth/network-request-failed": "No internet connection.",
  };
  return msgs[e?.code] || e?.message || String(e);
}

// ---- data ----

export async function loadAll(uid) {
  const { db, F } = await init();
  const [snap, userDoc] = await Promise.all([
    F.getDocs(F.collection(db, "users", uid, "items")), F.getDoc(F.doc(db, "users", uid))]);
  return { items: snap.docs.map(d => d.data()), settings: userDoc.exists() ? userDoc.data() : {} };
}

// Calls cb(items, fromThisDevice) whenever the collection changes online.
export async function listen(uid, cb) {
  const { db, F } = await init();
  return F.onSnapshot(F.collection(db, "users", uid, "items"),
    snap => cb(snap.docs.map(d => d.data()), snap.metadata.hasPendingWrites));
}

export async function writeChanges(uid, upserts, deletes) {
  const { db, F } = await init();
  const ops = [...upserts.map(i => ["set", i]), ...deletes.map(k => ["del", k])];
  for (let i = 0; i < ops.length; i += 400) {          // Firestore allows 500 writes per batch
    const batch = F.writeBatch(db);
    for (const [op, x] of ops.slice(i, i + 400)) {
      if (op === "set") batch.set(F.doc(db, "users", uid, "items", x.key), x);
      else batch.delete(F.doc(db, "users", uid, "items", x));
    }
    await batch.commit();
  }
}

export async function saveUserSettings(uid, s) {
  const { db, F } = await init();
  await F.setDoc(F.doc(db, "users", uid), s, { merge: true });
}
