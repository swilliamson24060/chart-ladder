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
  GRID_SIZE,
  GUIDED_PATH_LENGTH,
  GUIDED_PATH_POSITIONS,
  LADDER_TILE_LABELS,
  PUZZLE_CONNECTION_BONUS,
  PUZZLE_MISTAKE_ALLOWANCE,
  createPuzzleWithRetry,
  ladderLeaderboardKey,
  type LadderTileKey,
  type PuzzleGameEngine,
  type PuzzleSessionProgress,
} from "@chartcross/engine";
import { BOARD_RENDER_COLS } from "./src/boardLayout";
import {
  defaultCategory,
  GAME_CATEGORIES,
  ladderDataset,
  type GameCategory,
} from "./src/dataset";
import { colors, connectionColors, connectorDim } from "./src/theme";
import { BoardGrid } from "./src/components/BoardGrid";
import { CategorySelectModal } from "./src/components/CategorySelectModal";
import { ConnectionChainModal } from "./src/components/ConnectionChainModal";
import { GuidedGameOverModal } from "./src/components/GuidedGameOverModal";
import { HowToPlayModal } from "./src/components/HowToPlayModal";
import { LeaderboardModal } from "./src/components/LeaderboardModal";
import { PuzzleBank } from "./src/components/PuzzleBank";
import { RoundCompleteModal } from "./src/components/RoundCompleteModal";
import { TileInfoModal } from "./src/components/TileInfoModal";
import { TutorialModal } from "./src/components/TutorialModal";
import {
  clearSavedGame,
  loadSavedGame,
  saveGame,
  type SavedGuidedGame,
} from "./src/savedGame";

/**
 * Route building is a randomised search, so even a well-stocked category
 * occasionally draws a starter it can't chain from. Retry with fresh seeds
 * rather than surfacing that to the player as a crash.
 */
function newEngine(category: GameCategory, levelNumber: number, progress?: PuzzleSessionProgress) {
  return createPuzzleWithRetry(ladderDataset, category.id, Date.now() + levelNumber, undefined, progress);
}

/** Stable empty value so a closed chain modal doesn't allocate each render. */
const EMPTY_SOLUTION: ReturnType<PuzzleGameEngine["revealSolution"]> = { tiles: [], reasons: [] };

const HEADER_HEIGHT = 52;
const SUBHEADER_HEIGHT = 44;
const BANK_RESERVED_HEIGHT = 170;
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
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [infoCell, setInfoCell] = useState<Cell | null>(null);
  const [showHowToPlay, setShowHowToPlay] = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showCategorySelect, setShowCategorySelect] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [savedGame, setSavedGame] = useState<SavedGuidedGame | null>(null);
  const [showChainModal, setShowChainModal] = useState(false);

  useEffect(() => {
    loadSavedGame().then(setSavedGame).catch(() => setSavedGame(null));
  }, []);

  const chromeHeight = (Platform.OS === "web" ? 8 : 48) + HEADER_HEIGHT + SUBHEADER_HEIGHT;
  const reservedHeight =
    chromeHeight + BANK_RESERVED_HEIGHT + TOAST_MIN_HEIGHT + BOARD_GAP + CONTENT_VERTICAL_PADDING;
  const availableBoardWidth = Math.max(0, width - 24);
  const availableBoardHeight = Math.max(0, height - reservedHeight);
  const cellSize = Math.max(
    MIN_CELL_SIZE,
    Math.floor(
      Math.min(
        availableBoardWidth / BOARD_RENDER_COLS,
        availableBoardHeight / GRID_SIZE,
        MAX_BOARD_WIDTH / BOARD_RENDER_COLS,
      ),
    ),
  );

  function refresh() {
    setGameState(engineRef.current.getState());
  }

  function showToast(text: string, error = false) {
    setToast({ text, error });
    setTimeout(() => setToast((current) => (current?.text === text ? null : current)), 2800);
  }

  /**
   * Board cells serve two purposes: an open rung is a drop target for the
   * selected bank tile, and any placed tile opens its details. Tapping an
   * open rung with nothing selected is a no-op with a nudge rather than an
   * error, since it's the most likely first thing a player tries.
   */
  function handleCellPress(row: number, col: number) {
    const rung = GUIDED_PATH_POSITIONS.findIndex(
      (position) => position.row === row && position.col === col,
    );
    const isOpenRung = rung >= 0 && gameState.openRungs.includes(rung);

    if (isOpenRung && !gameState.awaitingConnectionGuess) {
      if (selectedTile === null) {
        showToast("Pick a song below first, then tap a glowing rung.");
        return;
      }
      const result = engineRef.current.placeTile(selectedTile, rung);
      setSelectedTile(null);
      refresh();
      if (!result.legal) {
        showToast(result.reason ?? "That move isn't allowed.", true);
        return;
      }
      if (result.correct) {
        showToast(`Correct — +${result.pointsAwarded}. Now name the connection.`);
      } else if (result.status === "failed") {
        clearSavedGame().catch(() => undefined);
        setSavedGame(null);
      } else {
        showToast(`Not that one. ${result.mistakesRemaining} mistakes left.`, true);
      }
      return;
    }

    const cell = gameState.board[row][col];
    if (cell.tile) setInfoCell(cell);
  }

  function handleSelectTile(index: number) {
    setSelectedTile((current) => (current === index ? null : index));
  }

  function handleGuessConnection(reason: LadderTileKey) {
    const result = engineRef.current.guessConnection(reason);
    refresh();
    if (result.correct) {
      showToast(`Right — +${result.pointsAwarded} bonus.`);
    } else {
      showToast(`It was ${LADDER_TILE_LABELS[result.correctReason]}. No bonus.`, true);
    }
  }

  function resetViewState() {
    setSelectedTile(null);
    setToast(null);
    setInfoCell(null);
    setShowChainModal(false);
  }

  /**
   * After a loss, "Play again" returns to the picker rather than dealing
   * another ladder in the same category - a category that just beat you is
   * rarely the one you want to be dropped straight back into.
   *
   * A fresh engine is built first so the game-over modal has something live
   * behind it and closes; if the player dismisses the picker instead of
   * choosing, they land on a new round of the category they were in.
   */
  function handleRestart() {
    const next = levelNumber + 1;
    setLevelNumber(next);
    engineRef.current = newEngine(activeCategory, next);
    clearSavedGame().catch(() => undefined);
    setSavedGame(null);
    resetViewState();
    refresh();
    setShowCategorySelect(true);
  }

  /**
   * Bail out of the current ladder. Progress in the unfinished round is
   * lost, but the session score earned from rounds already solved is kept -
   * abandoning one puzzle shouldn't wipe a good run.
   */
  function handleAbandonRound() {
    resetViewState();
    setShowCategorySelect(true);
  }

  function handleCloseHowToPlay() {
    setShowHowToPlay(false);
    if (!selectedCategory) setShowCategorySelect(true);
  }

  function handleWatchTutorial() {
    setShowHowToPlay(false);
    setShowTutorial(true);
  }

  function handleFinishTutorial() {
    setShowTutorial(false);
    if (!selectedCategory) setShowCategorySelect(true);
  }

  function handleSelectCategory(category: GameCategory) {
    setSelectedCategory(category);
    setLevelNumber(1);
    engineRef.current = newEngine(category, 1);
    clearSavedGame().catch(() => undefined);
    setSavedGame(null);
    resetViewState();
    setShowCategorySelect(false);
    refresh();
  }

  function handleContinueRound() {
    engineRef.current.startNextRound();
    resetViewState();
    refresh();
  }

  async function handleSaveAndExit() {
    const saved: SavedGuidedGame = {
      version: 3,
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

  const savedCategory = savedGame
    ? GAME_CATEGORIES.find((category) => category.id === savedGame.categoryId)
    : undefined;
  // genreLabel already reads "Pop & Country" where a rule pools genres, so
  // the header says what's actually in the deck rather than just what was
  // tapped on the genre screen.
  const activeGenreName = activeCategory.genreLabel ?? "All genres";
  const activeBoard = ladderLeaderboardKey(activeCategory);
  // Read from the route rather than the board so a lost ladder can still
  // show the rungs the player never placed. Only computed while the chain
  // modal is open - it's the answer key, and there's no reason to build it
  // on every render of a live puzzle.
  const solution = showChainModal ? engineRef.current.revealSolution() : EMPTY_SOLUTION;
  const placedCount = gameState.bank.filter((entry) => entry.placedAt !== null).length;
  const openRungCells = new Set(
    gameState.openRungs.map((rung) => {
      const position = GUIDED_PATH_POSITIONS[rung];
      return `${position.row},${position.col}`;
    }),
  );
  const isOver = gameState.status === "failed" || gameState.status === "session-over";

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={[styles.headerActions, styles.headerActionsLeft]} />
        <Text style={styles.title}>CHART LADDER</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.headerIconButton} onPress={() => setShowLeaderboard(true)} hitSlop={8}>
            <Text style={styles.headerIconText}>🏆</Text>
          </Pressable>
          <Pressable style={styles.headerIconButton} onPress={() => setShowTutorial(true)} hitSlop={8}>
            <Text style={styles.headerIconText}>🎓</Text>
          </Pressable>
          <Pressable style={styles.headerIconButton} onPress={() => setShowHowToPlay(true)} hitSlop={8}>
            <Text style={styles.helpText}>?</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.subheader}>
        <Pressable style={styles.levelWrap} onPress={handleAbandonRound} hitSlop={6}>
          <Text style={styles.levelText} numberOfLines={1}>
            {activeGenreName.toUpperCase()} · {activeCategory.name.toUpperCase()}
          </Text>
          <Text style={styles.changeText}>CHANGE ›</Text>
        </Pressable>
        <Text style={styles.stepText}>
          {placedCount}/{GUIDED_PATH_LENGTH} RUNGS
        </Text>
        <View style={styles.scoreWrap}>
          <Text style={styles.scoreText}>SCORE: {gameState.score.toLocaleString()}</Text>
          <Text style={styles.missText}>
            {gameState.mistakesRemaining}/{PUZZLE_MISTAKE_ALLOWANCE} MISTAKES LEFT
          </Text>
        </View>
      </View>

      <View style={styles.mainContent}>
        <View style={[styles.boardWrap, { width: cellSize * BOARD_RENDER_COLS }]}>
          <BoardGrid
            board={gameState.board}
            cellSize={cellSize}
            highlightCells={gameState.awaitingConnectionGuess ? new Set() : openRungCells}
            onCellPress={handleCellPress}
            pathConnections={gameState.completedConnections}
          />
        </View>

        <View style={styles.toastSlot}>
          {toast ? (
            <Text style={[styles.toast, toast.error && styles.toastError]}>{toast.text}</Text>
          ) : (
            <Text style={styles.boardHint}>
              {gameState.awaitingConnectionGuess
                ? "How do these two connect?"
                : selectedTile === null
                  ? "Pick a song, then tap a glowing rung"
                  : "Now tap a glowing rung"}
            </Text>
          )}
        </View>

        {gameState.status === "playing" && gameState.awaitingConnectionGuess && (
          <View style={styles.connectionWrap}>
            <Text style={styles.connectionHeading}>
              NAME THE CONNECTION · +{PUZZLE_CONNECTION_BONUS}
            </Text>
            <View style={styles.connectionRow}>
              {gameState.connectionChoices.map((reason) => (
                <Pressable
                  key={reason}
                  onPress={() => handleGuessConnection(reason)}
                  style={[
                    styles.connectionChip,
                    {
                      borderColor: connectionColors[reason],
                      backgroundColor: connectorDim[reason],
                    },
                  ]}
                >
                  <Text style={[styles.connectionText, { color: connectionColors[reason] }]}>
                    {LADDER_TILE_LABELS[reason]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {gameState.status === "playing" && !gameState.awaitingConnectionGuess && (
          <PuzzleBank
            bank={gameState.bank}
            selectedIndex={selectedTile}
            disabled={false}
            tileSize={Math.min(120, (Math.min(width, MAX_BOARD_WIDTH) - 60) / 3)}
            onSelect={handleSelectTile}
          />
        )}
      </View>

      <TileInfoModal cell={infoCell} board={gameState.board} onClose={() => setInfoCell(null)} />
      <GuidedGameOverModal
        status={isOver ? "game-over" : "playing"}
        board={activeBoard}
        finalScore={gameState.score}
        misses={PUZZLE_MISTAKE_ALLOWANCE - gameState.mistakesRemaining}
        roundsCompleted={gameState.roundsCompleted}
        correctTile={null}
        onRestart={handleRestart}
        onScoreSubmitted={() => setLeaderboardRefreshKey((key) => key + 1)}
        onViewChain={() => setShowChainModal(true)}
      />
      <RoundCompleteModal
        visible={gameState.status === "solved" && !showCategorySelect && !showChainModal}
        score={gameState.score}
        misses={PUZZLE_MISTAKE_ALLOWANCE - gameState.mistakesRemaining}
        roundsCompleted={gameState.roundsCompleted}
        onContinue={handleContinueRound}
        onSave={handleSaveAndExit}
        onEnd={handleEndSession}
        onViewChain={() => setShowChainModal(true)}
      />
      <ConnectionChainModal
        visible={showChainModal}
        tiles={solution.tiles}
        reasons={solution.reasons}
        lost={isOver}
        onClose={() => setShowChainModal(false)}
      />
      <HowToPlayModal visible={showHowToPlay} onClose={handleCloseHowToPlay} onWatchTutorial={handleWatchTutorial} />
      <TutorialModal visible={showTutorial} onFinish={handleFinishTutorial} />
      <CategorySelectModal
        visible={showCategorySelect}
        onSelect={handleSelectCategory}
        savedGame={
          savedGame
            ? {
                categoryName: savedCategory?.name ?? "Saved category",
                genreName: savedCategory?.genreLabel ?? "All genres",
                score: savedGame.progress.score,
                roundsCompleted: savedGame.progress.roundsCompleted,
              }
            : null
        }
        onResume={handleResumeSavedGame}
        onCancel={selectedCategory ? () => setShowCategorySelect(false) : undefined}
      />
      <LeaderboardModal
        visible={showLeaderboard}
        onClose={() => setShowLeaderboard(false)}
        refreshKey={leaderboardRefreshKey}
        highlightScore={isOver ? gameState.score : undefined}
        initialBoard={activeBoard}
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
    width: 108,
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
  levelWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  levelText: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontWeight: "800",
    fontSize: 10,
  },
  changeText: {
    color: colors.song,
    fontWeight: "800",
    fontSize: 9,
    letterSpacing: 0.5,
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
  boardHint: {
    color: colors.textSecondary,
    fontWeight: "600",
    fontSize: 11,
    textAlign: "center",
  },
  connectionWrap: {
    width: "100%",
    maxWidth: 480,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  connectionHeading: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 8,
  },
  connectionRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  connectionChip: {
    minWidth: 96,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  connectionText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
    textAlign: "center",
  },
});
