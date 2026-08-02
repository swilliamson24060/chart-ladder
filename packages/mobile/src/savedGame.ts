import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PuzzleSessionProgress } from "@chartcross/engine";
import type { CategoryId } from "./dataset";

// v3: category ids changed when genre became an axis above the rule and
// One Hit Wonders merged with Lightning Strikes Twice, so old saves point
// at categories that no longer exist. The key is bumped rather than
// migrated - a stale save is simply not found and the player starts fresh.
const SAVED_GAME_KEY = "chartcross-puzzle-session-v3";

export interface SavedGuidedGame {
  version: 3;
  categoryId: CategoryId;
  progress: PuzzleSessionProgress;
}

export async function loadSavedGame(): Promise<SavedGuidedGame | null> {
  const raw = await AsyncStorage.getItem(SAVED_GAME_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as SavedGuidedGame;
    if (saved.version !== 3 || !saved.categoryId || !saved.progress) return null;
    return saved;
  } catch {
    return null;
  }
}

export async function saveGame(saved: SavedGuidedGame): Promise<void> {
  await AsyncStorage.setItem(SAVED_GAME_KEY, JSON.stringify(saved));
}

export async function clearSavedGame(): Promise<void> {
  await AsyncStorage.removeItem(SAVED_GAME_KEY);
}
