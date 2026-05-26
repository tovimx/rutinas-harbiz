const FIREBASE_VERSION = "12.7.0";
const APP_SLUG = "cuatro-padel-performance";

const firebaseState = {
  configured: false,
  ready: false,
  user: null,
  message: "Sincronizacion local",
};

let auth = null;
let db = null;
let provider = null;
let firestoreModules = null;
let unsubscribeCloudState = null;

function emit(type, detail = {}) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function emitStatus(extra = {}) {
  emit("cuatro:firebase-status", {
    status: { ...firebaseState, ...extra },
  });
}

function hasConfig(config) {
  return Boolean(
    config &&
      config.apiKey &&
      config.authDomain &&
      config.projectId &&
      config.appId
  );
}

function serializeUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    displayName: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
  };
}

function cleanPayload(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function stateDocRef(uid) {
  return firestoreModules.doc(db, "users", uid, "cuatroPerformance", "state");
}

function supportCollectionRef(uid) {
  return firestoreModules.collection(db, "users", uid, "cuatroPerformanceSupport");
}

function setUser(user) {
  firebaseState.user = serializeUser(user);
  emit("cuatro:firebase-auth", {
    user: firebaseState.user,
    status: { ...firebaseState },
  });

  if (unsubscribeCloudState) {
    unsubscribeCloudState();
    unsubscribeCloudState = null;
  }

  if (!user) {
    emit("cuatro:firebase-cloud-state", { exists: false, data: null });
    return;
  }

  unsubscribeCloudState = firestoreModules.onSnapshot(
    stateDocRef(user.uid),
    (snapshot) => {
      emit("cuatro:firebase-cloud-state", {
        exists: snapshot.exists(),
        data: snapshot.exists() ? snapshot.data() : null,
      });
    },
    (error) => {
      emit("cuatro:firebase-error", {
        code: error.code || "firestore-subscription",
        message: error.message || "No se pudo leer el progreso sincronizado.",
      });
    }
  );
}

async function initializeFirebase() {
  const config = window.CUATRO_FIREBASE_CONFIG || {};
  window.CuatroFirebase = api;

  if (!hasConfig(config)) {
    firebaseState.configured = false;
    firebaseState.ready = true;
    firebaseState.message = "Progreso local";
    emitStatus();
    return;
  }

  try {
    const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }, firestore] =
      await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
      ]);

    firestoreModules = firestore;
    const app = initializeApp(config);
    auth = getAuth(app);
    db = firestore.getFirestore(app);
    provider = new GoogleAuthProvider();

    api.signIn = () => signInWithPopup(auth, provider);
    api.signOut = () => signOut(auth);
    api.saveState = saveState;
    api.createSupportTicket = createSupportTicket;

    firebaseState.configured = true;
    firebaseState.ready = true;
    firebaseState.message = "Firebase listo";
    emitStatus();
    onAuthStateChanged(auth, setUser);
  } catch (error) {
    firebaseState.configured = false;
    firebaseState.ready = true;
    firebaseState.message = "Firebase no disponible";
    emitStatus({ error: error.message || "No se pudo iniciar Firebase." });
    emit("cuatro:firebase-error", {
      code: "firebase-init",
      message: error.message || "No se pudo iniciar Firebase.",
    });
  }
}

async function saveState(appState) {
  if (!firebaseState.user) throw new Error("Not authenticated");
  const payload = cleanPayload(appState);
  await firestoreModules.setDoc(
    stateDocRef(firebaseState.user.uid),
    {
      ...payload,
      app: APP_SLUG,
      updatedAt: new Date().toISOString(),
      updatedAtServer: firestoreModules.serverTimestamp(),
    },
    { merge: true }
  );
}

async function createSupportTicket(ticket) {
  if (!firebaseState.user) throw new Error("Not authenticated");
  const payload = cleanPayload(ticket);
  const ref = await firestoreModules.addDoc(supportCollectionRef(firebaseState.user.uid), {
    ...payload,
    app: APP_SLUG,
    status: "open",
    createdAt: new Date().toISOString(),
    createdAtServer: firestoreModules.serverTimestamp(),
    user: firebaseState.user,
  });
  return ref.id;
}

const api = {
  state: firebaseState,
  signIn: async () => {
    throw new Error("Firebase is not configured");
  },
  signOut: async () => {},
  saveState: async () => {},
  createSupportTicket: async () => {
    throw new Error("Firebase is not configured");
  },
};

initializeFirebase();
