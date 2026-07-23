import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Public client config - safe to commit. Access is controlled by Firestore
// security rules (see firestore.rules at the repo root), not by hiding this.
const firebaseConfig = {
  apiKey: "AIzaSyDEqm6s7cUK31KeaD2A_dhBn2JZnzKthrY",
  authDomain: "chartcross-next.firebaseapp.com",
  projectId: "chartcross-next",
  storageBucket: "chartcross-next.firebasestorage.app",
  messagingSenderId: "1074013068142",
  appId: "1:1074013068142:web:336e2b5261e6dfe9d53f7f",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
