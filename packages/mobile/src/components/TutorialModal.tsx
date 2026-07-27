import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  bestConnectionReason,
  explainConnection,
  GRID_SIZE,
  GUIDED_CONNECTION_BONUS,
  GUIDED_PATH_LENGTH,
  GUIDED_PATH_POSITIONS,
  GUIDED_TILE_POINTS,
  GuidedGameEngine,
  tileLabel,
  tileValue,
  type ConnectionCategory,
  type GuidedGameState,
  type MatchableTile,
} from "@chartcross/engine";
import { defaultCategory } from "../dataset";
import { colors, connectorDim } from "../theme";
import { BoardGrid } from "./BoardGrid";
import { TileChip } from "./TileChip";

interface Props {
  visible: boolean;
  onFinish: () => void;
}

// Fixed seed + fixed category so every player sees the same scripted path -
// easier to design a coherent explanation around than a fresh random one.
const TUTORIAL_SEED = 20260101;
const SELECT_TILE_DELAY = 900;
const SELECT_CONNECTION_DELAY = 900;

type Phase = "select-tile" | "select-connection" | "explain" | "done";

interface PendingStep {
  step: number;
  previousTile: MatchableTile;
  choiceIndex: number;
  chosenTile: MatchableTile;
  reason: ConnectionCategory;
}

interface StepOutcome {
  pointsAwarded: number;
  scoreAfter: number;
}

const REASON_LABELS: Record<ConnectionCategory, string> = {
  COLLAB: "COLLAB",
  ARTIST: "ARTIST",
  SAME_YEAR: "SAME YEAR",
};

const REASON_COLORS: Record<ConnectionCategory, string> = {
  COLLAB: colors.collab,
  ARTIST: colors.connectorArtist,
  SAME_YEAR: colors.decade,
};

const CONNECTION_ORDER: ConnectionCategory[] = ["COLLAB", "ARTIST", "SAME_YEAR"];

/** The one choice that actually connects to the previous path tile - decoys never do, by construction. */
function findCorrectChoice(
  previousTile: MatchableTile,
  choices: MatchableTile[],
): { index: number; reason: ConnectionCategory } | null {
  for (let i = 0; i < choices.length; i++) {
    const reason = bestConnectionReason(previousTile, choices[i]);
    if (reason && reason !== "WILDCARD") return { index: i, reason: reason as ConnectionCategory };
  }
  return null;
}

function explanationLines(previousTile: MatchableTile, chosenTile: MatchableTile, reason: ConnectionCategory): string[] {
  const explanation = explainConnection(previousTile, chosenTile, reason, defaultCategory.dataset);
  if (explanation.reason === "SAME_YEAR") {
    return [`Both charted in ${explanation.sharedYears.join(", ")}.`];
  }
  if (explanation.reason === "COLLAB") {
    return explanation.songs.length > 0
      ? [`They collaborated on "${explanation.songs.map((s) => s.title).join('", "')}".`]
      : ["These two artists have worked together."];
  }
  if (explanation.reason === "ARTIST") {
    if (explanation.sharedPerformerNames) {
      return explanation.sharedPerformerNames.length > 0
        ? [`Both performed by ${explanation.sharedPerformerNames.join(", ")}.`]
        : ["They share a performer."];
    }
    return [`${explanation.artistName ?? "The artist"} performed "${explanation.songTitle ?? "this song"}".`];
  }
  return [];
}

function tileAt(state: GuidedGameState, index: number): MatchableTile {
  const pos = GUIDED_PATH_POSITIONS[index];
  return state.board[pos.row][pos.col].tile as MatchableTile;
}

export function TutorialModal({ visible, onFinish }: Props) {
  const { width } = useWindowDimensions();
  const engineRef = useRef<GuidedGameEngine | null>(null);
  const [gameState, setGameState] = useState<GuidedGameState | null>(null);
  const [phase, setPhase] = useState<Phase>("select-tile");
  const [pending, setPending] = useState<PendingStep | null>(null);
  const [outcome, setOutcome] = useState<StepOutcome | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cardWidth = Math.min(width - 40, 440);
  const boardPixelWidth = Math.min(cardWidth - 36, 300);
  const cellSize = Math.floor(boardPixelWidth / GRID_SIZE);

  useEffect(() => {
    if (!visible) return;
    engineRef.current = new GuidedGameEngine(defaultCategory.dataset, TUTORIAL_SEED);
    setGameState(engineRef.current.getState());
    setPending(null);
    setOutcome(null);
    setPhase("select-tile");
  }, [visible]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!visible || !gameState) return;
    const engine = engineRef.current;
    if (!engine) return;

    if (phase === "select-tile") {
      if (gameState.status !== "playing") {
        setPhase("done");
        return;
      }
      const previousTile = tileAt(gameState, gameState.step);
      const found = findCorrectChoice(previousTile, gameState.choices);
      if (!found) {
        setPhase("done");
        return;
      }
      setPending({
        step: gameState.step,
        previousTile,
        choiceIndex: found.index,
        chosenTile: gameState.choices[found.index],
        reason: found.reason,
      });
      timerRef.current = setTimeout(() => {
        engine.chooseTile(found.index);
        setGameState(engine.getState());
        setPhase("select-connection");
      }, SELECT_TILE_DELAY);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }

    if (phase === "select-connection") {
      timerRef.current = setTimeout(() => {
        if (!pending) return;
        const result = engine.guessConnection(pending.reason);
        const next = engine.getState();
        setOutcome({ pointsAwarded: result.pointsAwarded, scoreAfter: next.score });
        setGameState(next);
        setPhase("explain");
      }, SELECT_CONNECTION_DELAY);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }
    // `gameState === null` (not `gameState` itself) is intentional: it flips
    // exactly once, when the tutorial engine first loads, to kick off step
    // selection. Depending on `gameState` directly would also re-fire after
    // every chooseTile()/guessConnection() call, and depending on `pending`
    // would loop forever since setPending() is called from this same effect.
  }, [phase, visible, gameState === null]);

  const captionText = useMemo(() => {
    if (!pending) return "";
    if (phase === "select-tile") {
      return `Choosing "${tileLabel(pending.chosenTile)}" - the only option that connects to "${tileLabel(pending.previousTile)}".`;
    }
    if (phase === "select-connection") {
      return `Naming the connection: ${REASON_LABELS[pending.reason]}.`;
    }
    return "";
  }, [phase, pending]);

  function handleNext() {
    setPending(null);
    setOutcome(null);
    setPhase("select-tile");
  }

  if (!visible || !gameState) return null;

  const anchorEdge = gameState.completedConnections[GUIDED_PATH_LENGTH];
  const starterTile = pending?.step === 0 ? tileAt(gameState, 0) : null;
  const anchorTile =
    pending?.step === GUIDED_PATH_LENGTH - 1 ? tileAt(gameState, GUIDED_PATH_POSITIONS.length - 1) : null;

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
            <View style={[styles.boardWrap, { width: cellSize * GRID_SIZE }]}>
              <BoardGrid
                board={gameState.board}
                cellSize={cellSize}
                highlightCells={new Set()}
                onCellPress={() => {}}
                pathConnections={gameState.completedConnections}
              />
            </View>

            {phase !== "done" && (
              <View style={styles.captionSlot}>
                {phase !== "explain" && !!captionText && <Text style={styles.caption}>{captionText}</Text>}
              </View>
            )}

            {phase !== "explain" && phase !== "done" && pending && (
              <>
                {phase === "select-tile" && (
                  <View style={styles.choiceRow}>
                    {gameState.choices.map((tile, index) => (
                      <View key={`${tile.kind}-${tile.id}`} style={styles.choice}>
                        <TileChip
                          tile={tile}
                          size={78}
                          fontScale={0.17}
                          showValue
                          selected={index === pending.choiceIndex}
                          dimmed={index !== pending.choiceIndex}
                        />
                        <Text style={styles.kind}>{tile.kind}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {phase === "select-connection" && (
                  <View style={styles.connectionRow}>
                    {CONNECTION_ORDER.map((reason) => {
                      const isChosen = reason === pending.reason;
                      return (
                        <View
                          key={reason}
                          style={[
                            styles.connectionChip,
                            {
                              borderColor: REASON_COLORS[reason],
                              backgroundColor: connectorDim[reason],
                              opacity: isChosen ? 1 : 0.4,
                              borderWidth: isChosen ? 3 : 2,
                            },
                          ]}
                        >
                          <Text style={[styles.connectionText, { color: REASON_COLORS[reason] }]}>
                            {REASON_LABELS[reason]}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            {phase === "explain" && pending && outcome && (
              <View style={styles.explainCard}>
                <Text style={styles.explainTitle}>
                  {pending.chosenTile.kind} · {tileLabel(pending.chosenTile)}
                </Text>
                {explanationLines(pending.previousTile, pending.chosenTile, pending.reason).map((line, i) => (
                  <Text key={i} style={styles.explainLine}>
                    •  {line} ({REASON_LABELS[pending.reason]})
                  </Text>
                ))}
                <Text style={styles.explainScore}>Tile points: +{GUIDED_TILE_POINTS} pts</Text>
                <Text style={styles.explainScore}>
                  Tile value: +{tileValue(pending.chosenTile)} pts (it's worth more the further back its decade is)
                </Text>
                {starterTile && (
                  <Text style={styles.explainScore}>
                    STARTER value: +{tileValue(starterTile)} pts (only added on the first step)
                  </Text>
                )}
                {anchorTile && (
                  <Text style={styles.explainScore}>
                    ANCHOR value: +{tileValue(anchorTile)} pts (only added on the final step)
                  </Text>
                )}
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
                <Text style={styles.explainTitle}>That's the idea!</Text>
                <Text style={styles.explainLine}>
                  Each step, pick the tile that connects to the last one on the path, then name the
                  connection - COLLAB, ARTIST, or SAME YEAR - for a bonus. Five wrong tiles ends the
                  session, so use the 💡 hint if you're stuck (it costs that step's bonus).
                </Text>
                {anchorEdge && (
                  <Text style={styles.explainLine}>
                    The last tile also links automatically to the ANCHOR artist by{" "}
                    {REASON_LABELS[anchorEdge.reason as ConnectionCategory]} - no guess needed for that one.
                  </Text>
                )}
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
  captionSlot: {
    minHeight: 32,
    justifyContent: "center",
    marginBottom: 4,
  },
  caption: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  choiceRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
  },
  choice: {
    alignItems: "center",
  },
  kind: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "700",
    marginTop: 4,
  },
  connectionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  connectionChip: {
    width: 92,
    height: 54,
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
  buttonText: {
    color: "#fff",
    fontWeight: "800",
    letterSpacing: 1,
  },
});
