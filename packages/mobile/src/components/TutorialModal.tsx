import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  GUIDED_PATH_LENGTH,
  GUIDED_PATH_POSITIONS,
  createPuzzleWithRetry,
  ladderTileKeysForCategory,
  LADDER_TILE_LABELS,
  PUZZLE_BANK_SIZE,
  PUZZLE_CONNECTION_BONUS,
  PUZZLE_DECOY_COUNT,
  PUZZLE_MISTAKE_ALLOWANCE,
  PUZZLE_TILE_POINTS,
  tileLabel,
  type LadderSongTile,
  type LadderTileKey,
  type PuzzleGameEngine,
  type PuzzleState,
} from "@chartcross/engine";
import { BOARD_RENDER_COLS } from "../boardLayout";
import { defaultCategory, ladderDataset } from "../dataset";
import { colors, connectionColors, connectorDim } from "../theme";
import { BoardGrid } from "./BoardGrid";
import { PuzzleBank } from "./PuzzleBank";

interface Props {
  visible: boolean;
  onFinish: () => void;
}

// Fixed seed + fixed category so every player sees the same scripted
// puzzle - easier to write a coherent explanation around than a fresh
// random one.
const TUTORIAL_SEED = 20260101;

/**
 * Deliberately not 1-2-3-4-5. Alternating ends demonstrates the thing that
 * makes this a puzzle rather than a quiz: the ladder grows inward from both
 * START and ANCHOR, and the middle rung is the last one left.
 */
const TUTORIAL_RUNG_ORDER = [1, 5, 2, 4, 3];

type Phase = "intro" | "place" | "connect" | "explain" | "done";

interface PendingStep {
  /** Index into TUTORIAL_RUNG_ORDER. */
  step: number;
  rung: number;
  bankIndex: number;
  tile: LadderSongTile;
  /** The already-placed song this rung attaches to. */
  neighbour: LadderSongTile;
  reason?: LadderTileKey;
  pointsAwarded?: number;
}

/** Prose form of each connection type, for reading inside a sentence (LADDER_TILE_LABELS are shouty button captions). */
const CONNECTION_PHRASES: Record<LadderTileKey, string> = {
  same_artist: "an artist",
  band_collab: "a collaboration or band member",
  same_genre: "a genre",
  same_award: "an award",
  same_year: "the year they first charted",
};

const TUTORIAL_TILE_KEYS = ladderTileKeysForCategory(defaultCategory.id);

const TUTORIAL_CONNECTION_TYPES = (() => {
  const phrases = TUTORIAL_TILE_KEYS.map((key) => CONNECTION_PHRASES[key]);
  if (phrases.length <= 1) return phrases[0] ?? "";
  return `${phrases.slice(0, -1).join(", ")}, or ${phrases[phrases.length - 1]}`;
})();

function explanationLine(reason: LadderTileKey, from: LadderSongTile, to: LadderSongTile): string {
  switch (reason) {
    case "same_artist":
      return from.performer === to.performer
        ? `Both performed by ${to.performer}.`
        : `${from.performer} and ${to.performer} are the same act under different credits.`;
    case "band_collab":
      return `${from.performer} and ${to.performer} are linked by a collaboration or a shared band member.`;
    case "same_genre":
      return "Both songs share a genre.";
    case "same_award":
      return "Both songs won the same award.";
    case "same_year":
      return `Both first charted in ${to.debutYear || from.debutYear}.`;
  }
}

function tileAt(state: PuzzleState, rung: number): LadderSongTile {
  const position = GUIDED_PATH_POSITIONS[rung];
  return state.board[position.row][position.col].tile as LadderSongTile;
}

export function TutorialModal({ visible, onFinish }: Props) {
  const { width } = useWindowDimensions();
  const engineRef = useRef<PuzzleGameEngine | null>(null);
  const [state, setState] = useState<PuzzleState | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [pending, setPending] = useState<PendingStep | null>(null);

  const cardWidth = Math.min(width - 40, 440);
  const boardPixelWidth = Math.min(cardWidth - 36, 300);
  const cellSize = Math.floor(boardPixelWidth / BOARD_RENDER_COLS);

  useEffect(() => {
    if (!visible) return;
    engineRef.current = createPuzzleWithRetry(ladderDataset, defaultCategory.id, TUTORIAL_SEED);
    setState(engineRef.current.getState());
    setPending(null);
    setPhase("intro");
  }, [visible]);

  /**
   * Works out what to highlight for the step about to be demonstrated. The
   * correct tile and the rung it belongs on both come from the engine's own
   * route (peekCorrectBankIndex), never from re-deriving connectivity - see
   * the note on that method for why.
   */
  function prepareStep(step: number) {
    const engine = engineRef.current;
    if (!engine) return;
    const current = engine.getState();
    const rung = TUTORIAL_RUNG_ORDER[step];
    const bankIndex = engine.peekCorrectBankIndex(rung);
    if (bankIndex < 0) {
      setPhase("done");
      return;
    }
    const neighbourRung = current.lockedRungs.includes(rung - 1) ? rung - 1 : rung + 1;
    setPending({
      step,
      rung,
      bankIndex,
      tile: current.bank[bankIndex].tile,
      neighbour: tileAt(current, neighbourRung),
    });
    setPhase("place");
  }

  function handlePlace() {
    const engine = engineRef.current;
    if (!engine || !pending) return;
    const result = engine.placeTile(pending.bankIndex, pending.rung);
    setState(engine.getState());
    setPending({ ...pending, reason: engine.peekPendingReason() ?? undefined, pointsAwarded: result.pointsAwarded });
    setPhase("connect");
  }

  function handleConnect() {
    const engine = engineRef.current;
    if (!engine || !pending?.reason) return;
    const result = engine.guessConnection(pending.reason);
    setState(engine.getState());
    setPending({ ...pending, pointsAwarded: (pending.pointsAwarded ?? 0) + result.pointsAwarded });
    setPhase("explain");
  }

  function handleNext() {
    if (!pending) return;
    const next = pending.step + 1;
    if (next >= TUTORIAL_RUNG_ORDER.length) {
      setPending(null);
      setPhase("done");
      return;
    }
    prepareStep(next);
  }

  if (!visible || !state) return null;

  const openRungCells = new Set(
    phase === "place" && pending
      ? [`${GUIDED_PATH_POSITIONS[pending.rung].row},${GUIDED_PATH_POSITIONS[pending.rung].col}`]
      : [],
  );

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onFinish}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { width: cardWidth }]}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              TUTORIAL{pending ? ` · ${pending.step + 1}/${GUIDED_PATH_LENGTH}` : ""}
            </Text>
            <Pressable onPress={onFinish} hitSlop={10}>
              <Text style={styles.skipText}>SKIP ✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={[styles.boardWrap, { width: cellSize * BOARD_RENDER_COLS }]}>
              <BoardGrid
                board={state.board}
                cellSize={cellSize}
                highlightCells={openRungCells}
                onCellPress={() => {}}
                pathConnections={state.completedConnections}
              />
            </View>

            {phase === "intro" && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>START, ANCHOR AND THE BANK</Text>
                <Text style={styles.explainLine}>
                  Every ladder begins at a pink START song and ends at a blue ANCHOR song, both already
                  placed: "{tileLabel(tileAt(state, 0))}" and "{tileLabel(tileAt(state, GUIDED_PATH_POSITIONS.length - 1))}".
                </Text>
                <Text style={styles.explainLine}>
                  Between them sit {GUIDED_PATH_LENGTH} empty rungs. Below the board is a bank of{" "}
                  {PUZZLE_BANK_SIZE} songs - the {GUIDED_PATH_LENGTH} that belong on the ladder, plus{" "}
                  {PUZZLE_DECOY_COUNT} that connect to nothing at all.
                </Text>
                <Text style={styles.explainLine}>
                  💡 Tip: tap any song already on the board to see its full details.
                </Text>
                <Pressable style={styles.button} onPress={() => prepareStep(0)}>
                  <Text style={styles.buttonText}>NEXT ▶</Text>
                </Pressable>
              </View>
            )}

            {phase === "place" && pending && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>PLACE A SONG</Text>
                <Text style={styles.explainLine}>
                  {pending.step === 0
                    ? "Only the two rungs next to START and ANCHOR are open to begin with. A rung opens once the rung beside it is filled, so the ladder grows inward from both ends."
                    : pending.step === TUTORIAL_RUNG_ORDER.length - 1
                      ? "Only the middle rung is left. Both its neighbours are locked, so it was the last one to open - and by now there's only one song it can be."
                      : "Filling that rung opened the next one along. Notice the two ends closing in on each other."}
                </Text>
                <Text style={styles.explainLine}>
                  Tap a song, then tap a glowing rung. Here "{tileLabel(pending.tile)}" (highlighted below)
                  belongs on the glowing rung, because it connects to "{tileLabel(pending.neighbour)}".
                </Text>
                <PuzzleBank
                  bank={state.bank}
                  selectedIndex={pending.bankIndex}
                  disabled
                  tileSize={Math.min(96, (cardWidth - 60) / 3)}
                  onSelect={() => {}}
                />
                <Pressable style={[styles.button, styles.confirmButton]} onPress={handlePlace}>
                  <Text style={styles.buttonText}>NEXT ▶</Text>
                </Pressable>
              </View>
            )}

            {phase === "connect" && pending?.reason && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>NAME THE CONNECTION</Text>
                <Text style={styles.explainLine}>
                  A correct placement is worth {PUZZLE_TILE_POINTS} points. Say how the two songs link for
                  another {PUZZLE_CONNECTION_BONUS}. Connections can be {TUTORIAL_CONNECTION_TYPES}.
                </Text>
                <Text style={styles.explainLine}>
                  Here it's {LADDER_TILE_LABELS[pending.reason]} (highlighted below). Any answer that's
                  genuinely true counts, not only the one the puzzle had in mind.
                </Text>
                <View style={styles.connectionRow}>
                  {state.connectionChoices.map((reason) => {
                    const isAnswer = reason === pending.reason;
                    return (
                      <View
                        key={reason}
                        style={[
                          styles.connectionChip,
                          {
                            borderColor: connectionColors[reason],
                            backgroundColor: connectorDim[reason],
                            opacity: isAnswer ? 1 : 0.4,
                            borderWidth: isAnswer ? 3 : 2,
                          },
                        ]}
                      >
                        <Text style={[styles.connectionText, { color: connectionColors[reason] }]}>
                          {LADDER_TILE_LABELS[reason]}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <Pressable style={[styles.button, styles.confirmButton]} onPress={handleConnect}>
                  <Text style={styles.buttonText}>NEXT ▶</Text>
                </Pressable>
              </View>
            )}

            {phase === "explain" && pending?.reason && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>SONG · {tileLabel(pending.tile)}</Text>
                <Text style={styles.explainLine}>
                  •  {explanationLine(pending.reason, pending.neighbour, pending.tile)} (
                  {LADDER_TILE_LABELS[pending.reason]})
                </Text>
                <Text style={styles.explainScore}>Placement: +{PUZZLE_TILE_POINTS} pts</Text>
                <Text style={[styles.explainScore, { color: colors.decade }]}>
                  Connection bonus: +{PUZZLE_CONNECTION_BONUS} pts
                </Text>
                <Text style={styles.explainTotal}>
                  Score so far: {state.score.toLocaleString()}
                </Text>
                <Pressable style={styles.button} onPress={handleNext}>
                  <Text style={styles.buttonText}>
                    {pending.step === TUTORIAL_RUNG_ORDER.length - 1 ? "FINISH ▶" : "NEXT RUNG ▶"}
                  </Text>
                </Pressable>
              </View>
            )}

            {phase === "done" && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>THE WHOLE LADDER</Text>
                <Text style={styles.explainLine}>Every link from START to ANCHOR:</Text>
                {state.completedConnections.map((edge, i) => {
                  const from = state.board[edge.fromRow][edge.fromCol].tile as LadderSongTile;
                  const to = state.board[edge.toRow][edge.toCol].tile as LadderSongTile;
                  return (
                    <Text key={i} style={styles.explainLine}>
                      •  "{tileLabel(from)}" → "{tileLabel(to)}" — {LADDER_TILE_LABELS[edge.reason]}:{" "}
                      {explanationLine(edge.reason, from, to)}
                    </Text>
                  );
                })}
                <Text style={[styles.explainLine, { marginTop: 8 }]}>
                  That's it. In a real ladder you get {PUZZLE_MISTAKE_ALLOWANCE} mistakes to spend wherever
                  you like - so place the songs you're sure of first and let the rest narrow down.
                </Text>
                <Pressable style={styles.button} onPress={onFinish}>
                  <Text style={styles.buttonText}>START PLAYING</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5, 8, 18, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    maxHeight: "90%",
    backgroundColor: colors.headerBackground,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.cellBorder,
    padding: 18,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1,
  },
  skipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  boardWrap: {
    alignSelf: "center",
    marginBottom: 8,
  },
  connectionRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  connectionChip: {
    minWidth: 90,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  connectionText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  explainCard: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cellBorder,
    backgroundColor: colors.boardBackground,
  },
  explainTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 8,
  },
  explainLine: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  explainScore: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  explainTotal: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 8,
    marginBottom: 12,
  },
  button: {
    backgroundColor: colors.artist,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  confirmButton: {
    marginTop: 16,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "800",
    letterSpacing: 1,
  },
});
