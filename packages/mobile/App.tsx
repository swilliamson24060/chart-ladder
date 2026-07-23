import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  Cell,
  ConnectionCategory,
  GameEngine,
  getAllConnections,
  GRID_SIZE,
  WILD_TILE_COST,
} from "@chartcross/engine";
import {
  defaultCategory,
  GAME_CATEGORIES,
  GameCategory,
} from "./src/dataset";
import { colors } from "./src/theme";
import { BoardGrid } from "./src/components/BoardGrid";
import { Rack } from "./src/components/Rack";
import { ConnectorPicker } from "./src/components/ConnectorPicker";
import { TileInfoModal } from "./src/components/TileInfoModal";
import { ConnectionsListModal } from "./src/components/ConnectionsListModal";
import { GameOverModal } from "./src/components/GameOverModal";
import { HowToPlayModal } from "./src/components/HowToPlayModal";
import { StuckModal } from "./src/components/StuckModal";
import { LeaderboardModal } from "./src/components/LeaderboardModal";
import { CategorySelectModal } from "./src/components/CategorySelectModal";

const LEVEL_NAMES = [
  "THE COLLABORATIVE WEB",
  "CHART TOPPERS",
  "ONE HIT WONDERS",
  "THE FEATURING CIRCUIT",
  "PEAK PERFORMANCE",
];

function newEngine(category: GameCategory, levelNumber: number) {
  return new GameEngine(category.dataset, levelNumber, Date.now() + levelNumber);
}

export default function App() {
  const { width } = useWindowDimensions();
  const [levelNumber, setLevelNumber] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState<GameCategory | null>(null);
  const activeCategory = selectedCategory ?? defaultCategory;
  const engineRef = useRef<GameEngine>(newEngine(defaultCategory, levelNumber));
  const [gameState, setGameState] = useState(() => engineRef.current.getState());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [rescueTargeting, setRescueTargeting] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [infoCell, setInfoCell] = useState<Cell | null>(null);
  const [showConnections, setShowConnections] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(true);
  const [showCategorySelect, setShowCategorySelect] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);

  const boardPixelWidth = Math.min(width - 24, 520);
  const cellSize = Math.floor(boardPixelWidth / GRID_SIZE);

  const connections = useMemo(() => getAllConnections(gameState.board), [gameState]);
  const pendingConnector = gameState.pendingConnector;
  const pendingWildRescue = gameState.pendingWildRescue;

  // Only offered once no rack tile has a real legal move - a last-resort
  // bridge (see GameEngine.canWildRescue()), not a shortcut around guessing.
  const stuckRescueAvailable =
    gameState.status === "playing" &&
    !pendingConnector &&
    !pendingWildRescue &&
    gameState.wildcardConnectors > 0 &&
    !engineRef.current.hasAnyLegalMove();

  const noLegalMoves =
    gameState.status === "playing" &&
    !pendingConnector &&
    !pendingWildRescue &&
    !engineRef.current.hasAnyLegalMove();

  // Fires once right when the board runs out of real moves, whether or not
  // a wild connector is on hand to rescue it - awaitingStuckDecision (below)
  // takes over from there if one isn't.
  const wasStuckRef = useRef(false);
  useEffect(() => {
    if (noLegalMoves && !wasStuckRef.current) {
      showToast("No legal moves left — you'll need a ★ Wild connector to continue.", true);
    }
    wasStuckRef.current = noLegalMoves;
  }, [noLegalMoves]);

  const legalMoves = useMemo(() => {
    if (selectedIndex === null || pendingConnector || pendingWildRescue) return [];
    return engineRef.current.legalMovesForRackTile(selectedIndex);
  }, [selectedIndex, pendingConnector, pendingWildRescue, gameState]);

  const rescueGapCells = useMemo(() => {
    if (!rescueTargeting) return [];
    return engineRef.current.legalWildRescueGapCells();
  }, [rescueTargeting, gameState]);

  const highlightCells = useMemo(() => {
    const source = rescueTargeting ? rescueGapCells : legalMoves;
    return new Set(source.map((m) => `${m.row},${m.col}`));
  }, [rescueTargeting, rescueGapCells, legalMoves]);

  const pendingActionCell = pendingConnector
    ? { row: pendingConnector.gapRow, col: pendingConnector.gapCol }
    : pendingWildRescue
      ? { row: pendingWildRescue.contentRow, col: pendingWildRescue.contentCol }
      : null;

  function refresh() {
    setGameState(engineRef.current.getState());
  }

  function showToast(text: string, error?: boolean) {
    setToast({ text, error });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 1800);
  }

  function showScoreToast(result: {
    finalScore: number;
    connectionScore: number;
    tileValue: number;
    multiplierApplied?: string;
    multiplierMissed?: string;
  }) {
    const breakdown = result.tileValue > 0 ? ` (${result.connectionScore} conn + ${result.tileValue} tile)` : "";
    const multiplier = result.multiplierApplied
      ? ` [${result.multiplierApplied.replace(/_/g, " ")}]`
      : result.multiplierMissed
        ? ` [${result.multiplierMissed.replace(/_/g, " ")} bonus didn't apply]`
        : "";
    showToast(`+${result.finalScore} pts${breakdown}${multiplier}`);
  }

  function handleSelectRackTile(index: number) {
    if (gameState.status !== "playing") return;
    if (pendingWildRescue) {
      const result = engineRef.current.completeWildRescue(index);
      refresh();
      if (!result.legal) {
        showToast(result.reason ?? "Can't finish the rescue right now.", true);
        return;
      }
      showToast("Placed for free to keep the game going — no points.");
      return;
    }
    if (pendingConnector || rescueTargeting) return;
    setSelectedIndex((current) => (current === index ? null : index));
  }

  function handleCellPress(row: number, col: number) {
    const cell = gameState.board[row][col];
    if (cell.tile) {
      const isPendingContentTile =
        pendingConnector?.contentRow === row && pendingConnector?.contentCol === col;
      if (isPendingContentTile) {
        // Its full details (chart year, performers) would give away the
        // connector guess - block inspection until it's resolved.
        showToast("Guess the connection first.", true);
        return;
      }
      setInfoCell(cell);
      return;
    }
    if (rescueTargeting) {
      const result = engineRef.current.startWildRescue(row, col);
      if (!result.legal) {
        showToast(result.reason ?? "Can't start a rescue there.", true);
        return;
      }
      setRescueTargeting(false);
      refresh();
      showToast("Wild connector placed — now pick any tile to finish.");
      return;
    }
    if (pendingConnector || pendingWildRescue || selectedIndex === null) return;
    const result = engineRef.current.placeTile(selectedIndex, row, col);
    if (!result.legal) {
      showToast(result.reason ?? "Illegal move.", true);
      return;
    }
    setSelectedIndex(null);
    refresh();
    if (result.resolved) {
      // Either a real connection scored immediately, or the wildcard fast
      // path bridged the gap for free - either way there's nothing left to
      // guess.
      showScoreToast(result);
    } else {
      showToast("Placed — pick a connection type below.");
    }
    // Terminal states (bridged/stuck) are announced via GameOverModal, driven
    // directly off gameState.status below - no toast needed for those.
  }

  function handleConnectorGuess(type: ConnectionCategory) {
    if (!pendingConnector) return;
    const result = engineRef.current.placeConnector(type);
    refresh();
    if (!result.legal) {
      showToast(result.reason ?? "Can't guess right now.", true);
      return;
    }
    if (result.correct) {
      showScoreToast(result);
    } else {
      showToast(`-2 pts — wrong guess, try again.`, true);
    }
  }

  function handleShuffle() {
    if (gameState.status !== "playing" || pendingConnector || pendingWildRescue || rescueTargeting) return;
    engineRef.current.shuffleRack();
    refresh();
  }

  function handleHint() {
    if (
      gameState.status !== "playing" ||
      selectedIndex !== null ||
      pendingConnector ||
      pendingWildRescue ||
      rescueTargeting
    )
      return;
    const state = engineRef.current.getState();
    for (let i = 0; i < state.rack.length; i++) {
      if (engineRef.current.legalMovesForRackTile(i).length > 0) {
        setSelectedIndex(i);
        return;
      }
    }
    showToast("No legal moves in the current rack — try Shuffle.", true);
  }

  function handleBuyWild() {
    // Unlike other tools, buying a wild connector doesn't touch the rack or
    // board, so it stays available even mid-guess - useful to bail out of a
    // pending connector you can't figure out.
    if (gameState.status !== "playing") return;
    const result = engineRef.current.buyWildcard();
    if (!result.success) {
      showToast(result.reason ?? "Can't buy a wild connector right now.", true);
      return;
    }
    refresh();
    showToast(`Bought a ★ Wild connector for ${result.cost} pts`);
  }

  function handleUseWildcard() {
    if (!pendingConnector) return;
    const result = engineRef.current.useWildcardConnector();
    refresh();
    if (!result.legal) {
      showToast(result.reason ?? "Can't use a wild connector right now.", true);
      return;
    }
    showScoreToast(result);
  }

  function handleEndStuckGame() {
    const result = engineRef.current.endStuckGame();
    refresh();
    if (!result.legal) {
      showToast(result.reason ?? "Can't end the game right now.", true);
    }
    // A successful end is announced by GameOverModal, driven off status below.
  }

  function handleToggleRescue() {
    if (!stuckRescueAvailable) return;
    setSelectedIndex(null);
    setRescueTargeting((current) => !current);
  }

  function handleRestart() {
    const next = levelNumber + 1;
    setLevelNumber(next);
    engineRef.current = newEngine(activeCategory, next);
    setSelectedIndex(null);
    setRescueTargeting(false);
    setToast(null);
    refresh();
  }

  function handleCloseHowToPlay() {
    setShowHowToPlay(false);
    if (!selectedCategory) {
      setShowCategorySelect(true);
    }
  }

  function handleSelectCategory(category: GameCategory) {
    setSelectedCategory(category);
    setLevelNumber(1);
    engineRef.current = newEngine(category, 1);
    setSelectedIndex(null);
    setRescueTargeting(false);
    setToast(null);
    setShowCategorySelect(false);
    refresh();
  }

  const levelName = LEVEL_NAMES[(levelNumber - 1) % LEVEL_NAMES.length];
  const canBuyWild = gameState.status === "playing" && gameState.score >= WILD_TILE_COST;

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={[styles.headerSpacer, styles.headerSpacerLeft]}>
          <Pressable style={styles.headerIconButton} onPress={handleHint} hitSlop={8}>
            <Text style={styles.headerIconText}>💡</Text>
          </Pressable>
          <Pressable
            style={[styles.headerIconButton, !canBuyWild && styles.headerIconButtonDisabled]}
            onPress={handleBuyWild}
            disabled={!canBuyWild}
            hitSlop={8}
          >
            <Text style={styles.headerIconText}>✨</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>CHART CROSS</Text>
        <View style={[styles.headerSpacer, styles.headerSpacerRight]}>
          <Pressable
            style={styles.headerIconButton}
            onPress={() => setShowLeaderboard(true)}
            hitSlop={8}
          >
            <Text style={styles.headerIconText}>🏆</Text>
          </Pressable>
          <Pressable
            style={styles.headerIconButton}
            onPress={() => setShowHowToPlay(true)}
            hitSlop={8}
          >
            <Text style={styles.headerIconText}>❓</Text>
          </Pressable>
          <Pressable
            style={styles.headerIconButton}
            onPress={() => setShowConnections(true)}
            hitSlop={8}
          >
            <Text style={styles.headerIconText}>📊</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.subheader}>
        <Text style={styles.levelText}>
          {activeCategory.name.toUpperCase()} · LEVEL {levelNumber}: {levelName}
        </Text>
        <Text style={styles.scoreText}>SCORE: {gameState.score.toLocaleString()}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.boardWrap, { width: cellSize * GRID_SIZE }]}>
          <BoardGrid
            board={gameState.board}
            cellSize={cellSize}
            highlightCells={highlightCells}
            pendingActionCell={pendingActionCell}
            onCellPress={handleCellPress}
          />
        </View>

        <View style={styles.toastSlot}>
          {toast && (
            <Text style={[styles.toast, toast.error && styles.toastError]}>{toast.text}</Text>
          )}
        </View>

        <View style={styles.connectorSlot}>
          <ConnectorPicker
            active={!!pendingConnector}
            onGuess={handleConnectorGuess}
            wildcardCount={gameState.wildcardConnectors}
            onUseWildcard={handleUseWildcard}
            rescueAvailable={stuckRescueAvailable}
            rescueTargeting={rescueTargeting}
            onToggleRescue={handleToggleRescue}
          />
        </View>

        <Rack
          rack={gameState.rack}
          selectedIndex={selectedIndex}
          onSelect={handleSelectRackTile}
          onShuffle={handleShuffle}
        />
      </ScrollView>

      <TileInfoModal
        cell={infoCell}
        dataset={activeCategory.dataset}
        board={gameState.board}
        onClose={() => setInfoCell(null)}
      />
      <ConnectionsListModal
        visible={showConnections}
        connections={connections}
        onClose={() => setShowConnections(false)}
      />
      <GameOverModal
        status={gameState.status}
        penaltyApplied={gameState.penaltyApplied}
        rackSize={gameState.rack.length}
        finalScore={gameState.score}
        onRestart={handleRestart}
        onScoreSubmitted={() => setLeaderboardRefreshKey((k) => k + 1)}
      />
      <StuckModal
        visible={gameState.awaitingStuckDecision}
        cost={WILD_TILE_COST}
        canAfford={gameState.score >= WILD_TILE_COST}
        onBuyWild={handleBuyWild}
        onEndGame={handleEndStuckGame}
      />
      <HowToPlayModal visible={showHowToPlay} onClose={handleCloseHowToPlay} />
      <CategorySelectModal
        visible={showCategorySelect}
        categories={GAME_CATEGORIES}
        onSelect={handleSelectCategory}
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
    // Web (this app's actual deploy target) has no OS status bar to clear -
    // that 48px was pure dead space above the header on a phone browser.
    // Native builds still get real clearance if this is ever run there.
    paddingTop: Platform.OS === "web" ? 8 : 48,
  },
  header: {
    backgroundColor: colors.headerBackground,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerSpacer: {
    width: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  headerSpacerLeft: {
    justifyContent: "flex-start",
  },
  headerSpacerRight: {
    width: 96,
  },
  headerIconButton: {
    padding: 4,
  },
  headerIconButtonDisabled: {
    opacity: 0.35,
  },
  headerIconText: {
    fontSize: 20,
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
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#0f1a33",
  },
  levelText: {
    color: colors.textSecondary,
    fontWeight: "700",
    fontSize: 11,
    flexShrink: 1,
  },
  scoreText: {
    color: colors.textPrimary,
    fontWeight: "800",
    fontSize: 12,
  },
  scrollContent: {
    alignItems: "center",
    paddingVertical: 16,
    paddingBottom: 40,
  },
  boardWrap: {
    marginBottom: 2,
  },
  toastSlot: {
    height: 20,
    justifyContent: "center",
  },
  toast: {
    color: colors.decade,
    fontWeight: "700",
    fontSize: 13,
  },
  toastError: {
    color: colors.illegal,
  },
  connectorSlot: {
    marginBottom: 6,
  },
});
