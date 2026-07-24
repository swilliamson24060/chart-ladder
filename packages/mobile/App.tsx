import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  Cell,
  ConnectionCategory,
  GRID_SIZE,
  GUIDED_PATH_LENGTH,
  GUIDED_PATH_POSITIONS,
  GuidedGameEngine,
  type GuidedSessionProgress,
} from "@chartcross/engine";
import {
  defaultCategory,
  GAME_CATEGORIES,
  type GameCategory,
} from "./src/dataset";
import { colors } from "./src/theme";
import { BoardGrid } from "./src/components/BoardGrid";
import { CategorySelectModal } from "./src/components/CategorySelectModal";
import { GuidedChoices } from "./src/components/GuidedChoices";
import { GuidedGameOverModal } from "./src/components/GuidedGameOverModal";
import { HowToPlayModal } from "./src/components/HowToPlayModal";
import { LeaderboardModal } from "./src/components/LeaderboardModal";
import { MissedTileModal } from "./src/components/MissedTileModal";
import { RoundCompleteModal } from "./src/components/RoundCompleteModal";
import { TileInfoModal } from "./src/components/TileInfoModal";
import {
  clearSavedGame,
  loadSavedGame,
  saveGame,
  type SavedGuidedGame,
} from "./src/savedGame";

function newEngine(category: GameCategory, levelNumber: number, progress?: GuidedSessionProgress) {
  return new GuidedGameEngine(category.dataset, Date.now() + levelNumber, progress);
}

const HEADER_HEIGHT = 52;
const SUBHEADER_HEIGHT = 44;
const CHOICES_RESERVED_HEIGHT = 145;
const TOAST_MIN_HEIGHT = 28;
const BOARD_GAP = 8;
const CONTENT_VERTICAL_PADDING = 8;
const MAX_BOARD_WIDTH = 560;
const MIN_CELL_SIZE = 34;

export default function App() {
  const { width, height } = useWindowDimensions();
  const [levelNumber, setLevelNumber] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState<GameCategory | null>(null);
  const activeCategory = selectedCategory ?? defaultCategory;
  const engineRef = useRef(newEngine(defaultCategory, levelNumber));
  const [gameState, setGameState] = useState(() => engineRef.current.getState());
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [infoCell, setInfoCell] = useState<Cell | null>(null);
  const [showHowToPlay, setShowHowToPlay] = useState(true);
  const [showCategorySelect, setShowCategorySelect] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [savedGame, setSavedGame] = useState<SavedGuidedGame | null>(null);
  const [showMissDialog, setShowMissDialog] = useState(false);

  useEffect(() => {
    loadSavedGame().then(setSavedGame).catch(() => setSavedGame(null));
  }, []);

  const chromeHeight = (Platform.OS === "web" ? 8 : 48) + HEADER_HEIGHT + SUBHEADER_HEIGHT;
  const reservedHeight =
    chromeHeight + CHOICES_RESERVED_HEIGHT + TOAST_MIN_HEIGHT + BOARD_GAP + CONTENT_VERTICAL_PADDING;
  const availableBoardWidth = Math.max(0, width - 24);
  const availableBoardHeight = Math.max(0, height - reservedHeight);
  const boardPixelWidth = Math.min(availableBoardWidth, availableBoardHeight, MAX_BOARD_WIDTH);
  const cellSize = Math.max(MIN_CELL_SIZE, Math.floor(boardPixelWidth / GRID_SIZE));

  function refresh() {
    setGameState(engineRef.current.getState());
  }

  function showToast(text: string, error = false) {
    setToast({ text, error });
    setTimeout(() => setToast((current) => (current?.text === text ? null : current)), 2800);
  }

  function handleChooseTile(index: number) {
    const result = engineRef.current.chooseTile(index);
    refresh();
    if (result.status === "game-over") {
      clearSavedGame().catch(() => undefined);
      setSavedGame(null);
    }
    if (result.missed) {
      setShowMissDialog(true);
      return;
    }
    if (result.needsConnectionGuess) {
      showToast("Correct tile! Name the connection for a 10-point bonus.");
    } else {
      showToast(`Correct! +${result.pointsAwarded} points including tile value. Hint bonus forfeited.`);
    }
  }

  function handleGuessConnection(reason: ConnectionCategory) {
    const followedTileMiss = gameState.missedCorrectTile !== null;
    const result = engineRef.current.guessConnection(reason);
    refresh();
    if (result.correct) {
      showToast(
        followedTileMiss
          ? `Correct bonus! +${result.pointsAwarded} points.`
          : `Correct connection! +${result.pointsAwarded} points including tile value.`,
      );
    } else {
      showToast(
        `Wrong connection. The answer was ${result.correctReason}. +${result.pointsAwarded} tile points.`,
        true,
      );
    }
  }

  function handleHint() {
    const reason = engineRef.current.useHint();
    if (!reason) return;
    refresh();
    showToast(`Hint: use a ${reason} connection. The 10-point bonus is now forfeited.`);
  }

  function handleCellPress(row: number, col: number) {
    const lockedIndex = gameState.awaitingConnectionGuess
      ? Math.min(gameState.step + 1, GUIDED_PATH_LENGTH)
      : Math.min(gameState.step, GUIDED_PATH_LENGTH);
    const lockedPosition = GUIDED_PATH_POSITIONS[lockedIndex];
    if (row === lockedPosition.row && col === lockedPosition.col) {
      showToast("Details for the current path tile stay hidden until it is no longer the newest tile.", true);
      return;
    }
    const cell = gameState.board[row][col];
    if (cell.tile) setInfoCell(cell);
  }

  function handleRestart() {
    const next = levelNumber + 1;
    setLevelNumber(next);
    engineRef.current = newEngine(activeCategory, next);
    clearSavedGame().catch(() => undefined);
    setSavedGame(null);
    setToast(null);
    setShowMissDialog(false);
    setInfoCell(null);
    refresh();
  }

  function handleCloseHowToPlay() {
    setShowHowToPlay(false);
    if (!selectedCategory) setShowCategorySelect(true);
  }

  function handleSelectCategory(category: GameCategory) {
    setSelectedCategory(category);
    setLevelNumber(1);
    engineRef.current = newEngine(category, 1);
    clearSavedGame().catch(() => undefined);
    setSavedGame(null);
    setToast(null);
    setShowMissDialog(false);
    setInfoCell(null);
    setShowCategorySelect(false);
    refresh();
  }

  function handleContinueRound() {
    engineRef.current.startNextRound();
    setToast(null);
    setInfoCell(null);
    setShowMissDialog(false);
    refresh();
  }

  async function handleSaveAndExit() {
    const saved: SavedGuidedGame = {
      version: 1,
      categoryId: activeCategory.id,
      progress: engineRef.current.getProgress(),
    };
    await saveGame(saved);
    setSavedGame(saved);
    setShowCategorySelect(true);
    showToast("Game saved. Resume it whenever you are ready.");
  }

  async function handleEndSession() {
    engineRef.current.endSession();
    await clearSavedGame();
    setSavedGame(null);
    refresh();
  }

  async function handleResumeSavedGame() {
    if (!savedGame) return;
    const category = GAME_CATEGORIES.find((candidate) => candidate.id === savedGame.categoryId);
    if (!category) return;
    setSelectedCategory(category);
    setLevelNumber(savedGame.progress.roundsCompleted + 1);
    engineRef.current = newEngine(category, savedGame.progress.roundsCompleted + 1, savedGame.progress);
    await clearSavedGame();
    setSavedGame(null);
    setShowCategorySelect(false);
    setToast({ text: "Saved score restored." });
    refresh();
  }

  const hintEnabled =
    gameState.status === "playing" &&
    !gameState.awaitingConnectionGuess &&
    gameState.hintReason === null;

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={[styles.headerActions, styles.headerActionsLeft]}>
          <Pressable
            style={[styles.headerIconButton, !hintEnabled && styles.headerIconDisabled]}
            onPress={handleHint}
            disabled={!hintEnabled}
            hitSlop={8}
          >
            <Text style={styles.headerIconText}>💡</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>CHART CROSS</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.headerIconButton} onPress={() => setShowLeaderboard(true)} hitSlop={8}>
            <Text style={styles.headerIconText}>🏆</Text>
          </Pressable>
          <Pressable style={styles.headerIconButton} onPress={() => setShowHowToPlay(true)} hitSlop={8}>
            <Text style={styles.helpText}>?</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.subheader}>
        <Text style={styles.levelText}>{activeCategory.name.toUpperCase()}</Text>
        <Text style={styles.stepText}>
          ROUND {gameState.roundsCompleted + (gameState.status === "path-complete" ? 0 : 1)} · STEP{" "}
          {Math.min(gameState.step + 1, GUIDED_PATH_LENGTH)}/{GUIDED_PATH_LENGTH}
        </Text>
        <View style={styles.scoreWrap}>
          <Text style={styles.scoreText}>SCORE: {gameState.score.toLocaleString()}</Text>
          <Text style={styles.missText}>MISSES: {gameState.misses}/5</Text>
        </View>
      </View>

      <View style={styles.mainContent}>
        <View style={[styles.boardWrap, { width: cellSize * GRID_SIZE }]}>
          <BoardGrid
            board={gameState.board}
            cellSize={cellSize}
            highlightCells={new Set()}
            onCellPress={handleCellPress}
            pathConnections={gameState.completedConnections}
          />
        </View>

        <View style={styles.toastSlot}>
          {toast && <Text style={[styles.toast, toast.error && styles.toastError]}>{toast.text}</Text>}
        </View>

        {gameState.status === "playing" && (
          <GuidedChoices
            choices={gameState.choices}
            step={gameState.step}
            awaitingConnectionGuess={gameState.awaitingConnectionGuess}
            hintReason={gameState.hintReason}
            onChooseTile={handleChooseTile}
            onGuessConnection={handleGuessConnection}
          />
        )}
      </View>

      <TileInfoModal
        cell={infoCell}
        dataset={activeCategory.dataset}
        board={gameState.board}
        onClose={() => setInfoCell(null)}
      />
      <GuidedGameOverModal
        status={showMissDialog ? "playing" : gameState.status}
        finalScore={gameState.score}
        misses={gameState.misses}
        roundsCompleted={gameState.roundsCompleted}
        correctTile={gameState.missedCorrectTile}
        onRestart={handleRestart}
        onScoreSubmitted={() => setLeaderboardRefreshKey((key) => key + 1)}
      />
      <MissedTileModal
        visible={showMissDialog}
        correctTile={gameState.missedCorrectTile}
        misses={gameState.misses}
        canTryBonus={gameState.awaitingConnectionGuess}
        gameOver={gameState.status === "game-over"}
        onContinue={() => setShowMissDialog(false)}
      />
      <RoundCompleteModal
        visible={gameState.status === "path-complete" && !showCategorySelect && !showMissDialog}
        score={gameState.score}
        misses={gameState.misses}
        roundsCompleted={gameState.roundsCompleted}
        onContinue={handleContinueRound}
        onSave={handleSaveAndExit}
        onEnd={handleEndSession}
      />
      <HowToPlayModal visible={showHowToPlay} onClose={handleCloseHowToPlay} />
      <CategorySelectModal
        visible={showCategorySelect}
        categories={GAME_CATEGORIES}
        onSelect={handleSelectCategory}
        savedGame={
          savedGame
            ? {
                categoryName:
                  GAME_CATEGORIES.find((category) => category.id === savedGame.categoryId)?.name ??
                  "Saved category",
                score: savedGame.progress.score,
                misses: savedGame.progress.misses,
                roundsCompleted: savedGame.progress.roundsCompleted,
              }
            : null
        }
        onResume={handleResumeSavedGame}
      />
      <LeaderboardModal
        visible={showLeaderboard}
        onClose={() => setShowLeaderboard(false)}
        refreshKey={leaderboardRefreshKey}
        highlightScore={gameState.status !== "playing" ? gameState.score : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === "web" ? 8 : 48,
  },
  header: {
    backgroundColor: colors.headerBackground,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerActions: {
    width: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  headerActionsLeft: {
    justifyContent: "flex-start",
  },
  headerIconButton: {
    padding: 4,
  },
  headerIconDisabled: {
    opacity: 0.3,
  },
  headerIconText: {
    fontSize: 20,
  },
  helpText: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "900",
  },
  title: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 2,
    textAlign: "center",
  },
  subheader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: "#0f1a33",
  },
  levelText: {
    flex: 1,
    color: colors.textSecondary,
    fontWeight: "800",
    fontSize: 10,
  },
  stepText: {
    color: colors.song,
    fontWeight: "900",
    fontSize: 11,
    marginHorizontal: 8,
  },
  scoreText: {
    color: colors.textPrimary,
    fontWeight: "800",
    fontSize: 12,
    textAlign: "right",
  },
  scoreWrap: {
    flex: 1,
    alignItems: "flex-end",
  },
  missText: {
    color: colors.illegal,
    fontSize: 9,
    fontWeight: "800",
    marginTop: 2,
  },
  mainContent: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  boardWrap: {
    flexShrink: 0,
    marginBottom: BOARD_GAP,
  },
  toastSlot: {
    minHeight: 28,
    maxWidth: 420,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  toast: {
    color: colors.decade,
    fontWeight: "700",
    fontSize: 12,
    textAlign: "center",
  },
  toastError: {
    color: colors.illegal,
  },
});
