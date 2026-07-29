import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  GUIDED_CONNECTION_BONUS,
  GUIDED_PATH_LENGTH,
  GUIDED_PATH_POSITIONS,
  GUIDED_TILE_POINTS,
  GuidedGameEngine,
  ladderConnectionReason,
  LADDER_TILE_LABELS,
  tileLabel,
  type GuidedGameState,
  type LadderSongTile,
  type LadderTileKey,
} from "@chartcross/engine";
import { BOARD_RENDER_COLS } from "../boardLayout";
import { defaultCategory, ladderDataset } from "../dataset";
import { colors, connectionColors, connectorDim } from "../theme";
import { BoardGrid } from "./BoardGrid";
import { TileChip } from "./TileChip";

interface Props {
  visible: boolean;
  onFinish: () => void;
}

// Fixed seed + fixed category so every player sees the same scripted path -
// easier to design a coherent explanation around than a fresh random one.
const TUTORIAL_SEED = 20260101;

type Phase = "intro" | "select-tile" | "select-connection" | "explain" | "done";

interface PendingStep {
  step: number;
  previousTile: LadderSongTile;
  choiceIndex: number;
  chosenTile: LadderSongTile;
  reason: LadderTileKey;
}

interface StepOutcome {
  pointsAwarded: number;
  scoreAfter: number;
}

/** The index of the one choice that actually connects to the previous path tile - decoys never do, by construction. */
function findCorrectChoiceIndex(previousTile: LadderSongTile, choices: LadderSongTile[]): number {
  for (let i = 0; i < choices.length; i++) {
    if (ladderConnectionReason(previousTile, choices[i], ladderDataset) !== null) return i;
  }
  return -1;
}

function explanationLine(reason: LadderTileKey, previousTile: LadderSongTile, chosenTile: LadderSongTile): string {
  switch (reason) {
    case "same_artist":
      return previousTile.performer === chosenTile.performer
        ? `Both performed by ${chosenTile.performer}.`
        : `${previousTile.performer} and ${chosenTile.performer} share the same artist identity.`;
    case "band_collab":
      return `${previousTile.performer} and ${chosenTile.performer} are linked by a collaboration or shared band member.`;
    case "same_genre":
      return "Both songs share a genre.";
    case "same_peak_pos":
      return `Both peaked at #${chosenTile.peakPos} on the Hot 100.`;
    case "same_award":
      return "Both songs won the same award.";
  }
}

function tileAt(state: GuidedGameState, index: number): LadderSongTile {
  const pos = GUIDED_PATH_POSITIONS[index];
  return state.board[pos.row][pos.col].tile as LadderSongTile;
}

export function TutorialModal({ visible, onFinish }: Props) {
  const { width } = useWindowDimensions();
  const engineRef = useRef<GuidedGameEngine | null>(null);
  const [gameState, setGameState] = useState<GuidedGameState | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [pending, setPending] = useState<PendingStep | null>(null);
  const [outcome, setOutcome] = useState<StepOutcome | null>(null);

  const cardWidth = Math.min(width - 40, 440);
  const boardPixelWidth = Math.min(cardWidth - 36, 300);
  const cellSize = Math.floor(boardPixelWidth / BOARD_RENDER_COLS);

  useEffect(() => {
    if (!visible) return;
    engineRef.current = new GuidedGameEngine(ladderDataset, defaultCategory.id, TUTORIAL_SEED);
    setGameState(engineRef.current.getState());
    setPending(null);
    setOutcome(null);
    setPhase("intro");
  }, [visible]);

  // Every phase transition here is player-paced (a Next tap), never a timer -
  // this effect only computes *what to highlight* for the newly-entered
  // "select-tile" phase; it never advances the phase itself.
  useEffect(() => {
    if (!visible || !gameState || pending) return;
    if (phase !== "select-tile") return;

    const engine = engineRef.current;
    if (!engine || gameState.status !== "playing") {
      setPhase("done");
      return;
    }
    const previousTile = tileAt(gameState, gameState.step);
    const choices = gameState.choices as LadderSongTile[];
    const choiceIndex = findCorrectChoiceIndex(previousTile, choices);
    // A song pair can connect through more than one tile type at once, so
    // ask the engine which one the route actually committed to rather than
    // re-deriving it independently (which could legitimately disagree
    // while still being "a" valid connection).
    const reason = engine.peekCurrentReason();
    if (choiceIndex === -1 || !reason) {
      setPhase("done");
      return;
    }
    setPending({
      step: gameState.step,
      previousTile,
      choiceIndex,
      chosenTile: choices[choiceIndex],
      reason,
    });
  }, [phase, visible, gameState, pending]);

  function handleStartFromIntro() {
    setPhase("select-tile");
  }

  function handleConfirmTile() {
    if (!pending) return;
    const engine = engineRef.current;
    if (!engine) return;
    engine.chooseTile(pending.choiceIndex);
    setGameState(engine.getState());
    setPhase("select-connection");
  }

  function handleConfirmConnection() {
    if (!pending) return;
    const engine = engineRef.current;
    if (!engine) return;
    const result = engine.guessConnection(pending.reason);
    const next = engine.getState();
    setOutcome({ pointsAwarded: result.pointsAwarded, scoreAfter: next.score });
    setGameState(next);
    setPhase("explain");
  }

  function handleNext() {
    setPending(null);
    setOutcome(null);
    setPhase("select-tile");
  }

  if (!visible || !gameState) return null;

  const anchorEdge = gameState.completedConnections[GUIDED_PATH_LENGTH];
  const pathStarterTile = tileAt(gameState, 0);
  const pathAnchorTile = tileAt(gameState, GUIDED_PATH_POSITIONS.length - 1);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onFinish}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { width: cardWidth }]}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              TUTORIAL {phase !== "done" ? `· STEP ${Math.min(gameState.step + 1, GUIDED_PATH_LENGTH)}/${GUIDED_PATH_LENGTH}` : ""}
            </Text>
            <Pressable onPress={onFinish} hitSlop={10}>
              <Text style={styles.skipText}>SKIP ✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={[styles.boardWrap, { width: cellSize * BOARD_RENDER_COLS }]}>
              <BoardGrid
                board={gameState.board}
                cellSize={cellSize}
                highlightCells={new Set()}
                onCellPress={() => {}}
                pathConnections={gameState.completedConnections}
              />
            </View>

            {phase === "intro" && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>STARTER &amp; ANCHOR</Text>
                <Text style={styles.explainLine}>
                  Every path starts at a pink STARTER song and ends at a blue ANCHOR song - both are
                  already placed on the board for you: "{tileLabel(pathStarterTile)}" and "
                  {tileLabel(pathAnchorTile)}" this time.
                </Text>
                <Text style={styles.explainLine}>
                  Your job is to find the 5 songs in between that connect STARTER all the way to ANCHOR,
                  one correct choice at a time.
                </Text>
                <Text style={styles.explainLine}>
                  💡 Tip: you can tap any song already placed on the board - like STARTER or ANCHOR - to
                  see its full details.
                </Text>
                <Pressable style={styles.button} onPress={handleStartFromIntro}>
                  <Text style={styles.buttonText}>NEXT ▶</Text>
                </Pressable>
              </View>
            )}

            {phase === "select-tile" && pending && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>PICK THE NEXT TILE</Text>
                <Text style={styles.explainLine}>
                  Each step gives you three songs. Only one of them connects to{" "}
                  {pending.step === 0 ? "the starter song" : "the previously correct song in the chain"} -
                  by sharing an artist, a genre, a peak chart position, an award, or a collaboration/band
                  connection. The other two are decoys that don't connect at all.
                </Text>
                <Text style={styles.explainLine}>
                  Here, "{tileLabel(pending.chosenTile)}" (highlighted below) is the right pick because
                  it connects to "{tileLabel(pending.previousTile)}",{" "}
                  {pending.step === 0 ? "the starter song" : "the previously correct song in the chain"}.
                </Text>
                <View style={styles.choiceRow}>
                  {(gameState.choices as LadderSongTile[]).map((tile, index) => (
                    <View key={tile.id} style={styles.choice}>
                      <TileChip
                        tile={tile}
                        size={cellSize - 4}
                        fontScale={0.17}
                        selected={index === pending.choiceIndex}
                        dimmed={index !== pending.choiceIndex}
                      />
                    </View>
                  ))}
                </View>
                <Pressable style={[styles.button, styles.confirmButton]} onPress={handleConfirmTile}>
                  <Text style={styles.buttonText}>NEXT ▶</Text>
                </Pressable>
              </View>
            )}

            {phase === "select-connection" && pending && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>NAME THE CONNECTION</Text>
                <Text style={styles.explainLine}>
                  Once the right tile is placed, you can earn a bonus by naming how it connects. You'll
                  see three options - the correct one plus two random decoys drawn from five possible
                  connection types.
                </Text>
                <Text style={styles.explainLine}>
                  Here, the connection is {LADDER_TILE_LABELS[pending.reason]} (highlighted below).
                  Guessing right adds bonus points; guessing wrong just reveals the answer and skips the
                  bonus.
                </Text>
                <View style={styles.connectionRow}>
                  {gameState.connectionChoices.map((reason) => {
                    const isChosen = reason === pending.reason;
                    return (
                      <View
                        key={reason}
                        style={[
                          styles.connectionChip,
                          {
                            width: (cellSize - 4) * 2,
                            height: cellSize - 4,
                            borderColor: connectionColors[reason],
                            backgroundColor: connectorDim[reason],
                            opacity: isChosen ? 1 : 0.4,
                            borderWidth: isChosen ? 3 : 2,
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
                <Pressable style={[styles.button, styles.confirmButton]} onPress={handleConfirmConnection}>
                  <Text style={styles.buttonText}>NEXT ▶</Text>
                </Pressable>
              </View>
            )}

            {phase === "explain" && pending && outcome && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>SONG · {tileLabel(pending.chosenTile)}</Text>
                <Text style={styles.explainLine}>
                  •  {explanationLine(pending.reason, pending.previousTile, pending.chosenTile)} (
                  {LADDER_TILE_LABELS[pending.reason]})
                </Text>
                {pending.step === GUIDED_PATH_LENGTH - 1 && anchorEdge && (
                  <>
                    <Text style={styles.explainLine}>
                      It also links automatically to the ANCHOR song, "{tileLabel(pathAnchorTile)}":
                    </Text>
                    <Text style={styles.explainLine}>
                      •  {explanationLine(anchorEdge.reason, pending.chosenTile, pathAnchorTile)} (
                      {LADDER_TILE_LABELS[anchorEdge.reason]})
                    </Text>
                  </>
                )}
                <Text style={styles.explainScore}>Tile points: +{GUIDED_TILE_POINTS} pts</Text>
                <Text style={[styles.explainScore, { color: colors.decade }]}>
                  Connection bonus (correct guess): +{GUIDED_CONNECTION_BONUS} pts
                </Text>
                <Text style={styles.explainTotal}>
                  Total: +{outcome.pointsAwarded} pts → score {outcome.scoreAfter.toLocaleString()}
                </Text>
                <Pressable style={styles.button} onPress={handleNext}>
                  <Text style={styles.buttonText}>
                    {pending.step === GUIDED_PATH_LENGTH - 1 ? "FINISH ▶" : "NEXT STEP ▶"}
                  </Text>
                </Pressable>
              </View>
            )}

            {phase === "done" && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>THE WHOLE CHAIN</Text>
                <Text style={styles.explainLine}>Here's every link from STARTER to ANCHOR, start to finish:</Text>
                {gameState.completedConnections.map((edge, i) => {
                  const fromTile = gameState.board[edge.fromRow][edge.fromCol].tile as LadderSongTile;
                  const toTile = gameState.board[edge.toRow][edge.toCol].tile as LadderSongTile;
                  return (
                    <Text key={i} style={styles.explainLine}>
                      •  "{tileLabel(fromTile)}" → "{tileLabel(toTile)}" — {LADDER_TILE_LABELS[edge.reason]}:{" "}
                      {explanationLine(edge.reason, fromTile, toTile)}
                    </Text>
                  );
                })}
                <Text style={[styles.explainLine, { marginTop: 8 }]}>
                  That's the idea! Five wrong tiles ends a real session, so use the 💡 hint if you're
                  stuck (it costs that step's bonus).
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
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 14,
    marginTop: 8,
  },
  choice: {
    alignItems: "center",
  },
  connectionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
  },
  connectionChip: {
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  connectionText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
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
