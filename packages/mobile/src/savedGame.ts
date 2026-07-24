import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GuidedSessionProgress } from "@chartcross/engine";
import type { CategoryId } from "./dataset";

const SAVED_GAME_KEY = "chartcross-guided-session-v1";

export interface SavedGuidedGame {
  version: 1;
  categoryId: CategoryId;
  progress: GuidedSessionProgress;
}

export async function loadSavedGame(): Promise<SavedGuidedGame | null> {
  const raw = await AsyncStorage.getItem(SAVED_GAME_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as SavedGuidedGame;
    if (saved.version !== 1 || !saved.categoryId || !saved.progress) return null;
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
