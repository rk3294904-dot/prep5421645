import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCEIPr27eyXRna1H1x7IT6Vvf3ViD1Nhs",
  authDomain: "skill-wave-d8570.firebaseapp.com",
  projectId: "skill-wave-d8570",
  storageBucket: "skill-wave-d8570.firebasestorage.app",
  messagingSenderId: "676834080521",
  appId: "1:676834080521:web:ee3582ac16aab891cec5d8",
  measurementId: "G-SQQ51YWC9W",
};

const app = getApps()[0] ?? initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);
export const firebaseDb = getFirestore(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/**
 * Sign in with Google using a popup. Falls back to a redirect when the popup
 * is blocked or cannot be opened (mobile browsers, cross-origin iframes, etc.)
 * so the user is never left stuck after the popup closes unexpectedly.
 */
export async function signInWithGoogle() {
  try {
    await signInWithPopup(firebaseAuth, googleProvider);
  } catch (reason: unknown) {
    const code = (reason as { code?: string }).code;
    // Popup blocked / unavailable -> use redirect as a graceful fallback.
    if (
      code === "auth/popup-blocked" ||
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request" ||
      code === "auth/operation-not-supported-in-this-environment"
    ) {
      await signInWithRedirect(firebaseAuth, googleProvider);
      return;
    }
    throw reason;
  }
}

export function finishGoogleRedirect() {
  return getRedirectResult(firebaseAuth);
}

export function signOutUser() {
  return signOut(firebaseAuth);
}

export async function enrollInBatch({
  userId,
  batch,
}: {
  userId: string;
  batch: { id: string; name: string; image?: string; byName?: string };
}) {
  await setDoc(
    doc(firebaseDb, "users", userId, "enrollments", batch.id),
    {
      batchId: batch.id,
      batchName: batch.name,
      batchImage: batch.image ?? "",
      byName: batch.byName ?? "",
      enrolledAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getEnrolledBatchIds(userId: string): Promise<string[]> {
  const snapshot = await getDocs(collection(firebaseDb, "users", userId, "enrollments"));
  return snapshot.docs.map((item) => item.id);
}

export async function recordLectureProgress({
  userId,
  userName,
  photoURL,
  batchId,
  contentId,
  seconds,
}: {
  userId: string;
  userName: string;
  photoURL?: string | null;
  batchId: string;
  contentId: string;
  seconds: number;
}) {
  await setDoc(
    doc(firebaseDb, "leaderboard", userId),
    {
      userId,
      displayName: userName || "Learner",
      photoURL: photoURL ?? "",
      points: increment(1),
      lastBatchId: batchId,
      lastContentId: contentId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getLeaderboard() {
  const snapshot = await getDocs(query(collection(firebaseDb, "leaderboard"), orderBy("points", "desc"), limit(10)));
  return snapshot.docs.map((item, index) => ({
    rank: index + 1,
    id: item.id,
    ...(item.data() as { displayName?: string; photoURL?: string; points?: number }),
  }));
}
