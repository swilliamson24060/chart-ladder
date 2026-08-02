import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  where,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

export const LEADERBOARD_SIZE = 40;
export const MAX_NAME_LENGTH = 12;
export const MAX_BOARD_LENGTH = 40;

const scoresCollection = collection(db, "scores");

export interface LeaderboardEntry {
  name: string;
  score: number;
}

/** Strips anything that isn't safe to display, and enforces the same length limit as the Firestore rules. */
export function sanitizeName(raw: string): string {
  return raw.trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Scores are filed per board - `"<genre>/<rule>"`, see
 * ladderLeaderboardKey() - so a Country run isn't competing with an
 * all-genres one. Merged genres share a board, since they're the same deck.
 */
export async function submitScore(name: string, score: number, board: string): Promise<void> {
  const cleanName = sanitizeName(name);
  if (!cleanName) throw new Error("Name is required.");
  if (!Number.isInteger(score) || score < 0) throw new Error("Invalid score.");
  if (!board || board.length > MAX_BOARD_LENGTH) throw new Error("Invalid board.");

  await addDoc(scoresCollection, {
    name: cleanName,
    score,
    board,
    createdAt: serverTimestamp(),
  });
}

/**
 * NB: filtering by board while ordering by score needs a composite index on
 * (board asc, score desc). Firestore returns a console link the first time
 * this query runs if the index is missing.
 *
 * Scores submitted before boards existed carry no `board` field and so match
 * no filter - they're effectively retired rather than dumped into one board
 * they may not belong to.
 */
export async function fetchTop40(board: string): Promise<LeaderboardEntry[]> {
  const q = query(
    scoresCollection,
    where("board", "==", board),
    orderBy("score", "desc"),
    limit(LEADERBOARD_SIZE),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { name: data.name as string, score: data.score as number };
  });
}
