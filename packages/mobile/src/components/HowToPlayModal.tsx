import React, { useRef, useState } from "react";
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  GUIDED_PATH_LENGTH,
  LADDER_TILE_LABELS,
  LADDER_TILE_KEYS,
  PUZZLE_BANK_SIZE,
  PUZZLE_CONNECTION_BONUS,
  PUZZLE_MISTAKE_ALLOWANCE,
  PUZZLE_TILE_POINTS,
} from "@chartcross/engine";
import { colors } from "../theme";

interface Props {
  visible: boolean;
  onClose: () => void;
  onWatchTutorial: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function HowToPlayModal({ visible, onClose, onWatchTutorial }: Props) {
  const [canScrollMore, setCanScrollMore] = useState(false);
  const metrics = useRef({ scrollY: 0, viewportHeight: 0, contentHeight: 0 });

  function recomputeScrollHint() {
    const { scrollY, viewportHeight, contentHeight } = metrics.current;
    setCanScrollMore(contentHeight - scrollY - viewportHeight > 8);
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    metrics.current.scrollY = event.nativeEvent.contentOffset.y;
    recomputeScrollHint();
  }

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>HOW TO PLAY</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.scrollWrap}>
            <ScrollView
              style={styles.scroll}
              showsVerticalScrollIndicator={false}
              onScroll={handleScroll}
              onLayout={(event) => {
                metrics.current.viewportHeight = event.nativeEvent.layout.height;
                recomputeScrollHint();
              }}
              onContentSizeChange={(_width, height) => {
                metrics.current.contentHeight = height;
                recomputeScrollHint();
              }}
              scrollEventThrottle={32}
            >
              <Section title="BUILD THE LADDER">
                <Text style={styles.body}>
                  START and ANCHOR are already on the board. Between them sit {GUIDED_PATH_LENGTH} empty
                  rungs, and below them a bank of {PUZZLE_BANK_SIZE} songs - the {GUIDED_PATH_LENGTH} that
                  belong, plus {PUZZLE_BANK_SIZE - GUIDED_PATH_LENGTH} that connect to nothing at all.
                </Text>
              </Section>

              <Section title="WORK IN FROM BOTH ENDS">
                <Text style={styles.body}>
                  A rung only opens once the rung beside it is filled, so you start at the two ends and
                  meet in the middle. Tap a song, then tap a glowing rung to place it. Each correct
                  placement is worth {PUZZLE_TILE_POINTS} points and opens the next rung along.
                </Text>
                <Text style={styles.body}>
                  Because you can see every candidate at once, you can place the ones you're sure of
                  first and let the rest narrow down.
                </Text>
              </Section>

              <Section title="NAME THE CONNECTION">
                <Text style={styles.body}>
                  After each placement, say how the two songs link for a {PUZZLE_CONNECTION_BONUS}-point
                  bonus. The {LADDER_TILE_KEYS.length} connection types are:{" "}
                  {LADDER_TILE_KEYS.map((key) => LADDER_TILE_LABELS[key]).join(", ")}. Any answer that is
                  genuinely true counts, not just the one the puzzle had in mind.
                </Text>
              </Section>

              <Section title="MISTAKES">
                <Text style={styles.body}>
                  A wrong placement costs one of your {PUZZLE_MISTAKE_ALLOWANCE} mistakes and leaves the
                  song in the bank. They're shared across the whole ladder, so spend them where you like.
                  Run out and the ladder ends.
                </Text>
                <Text style={styles.body}>
                  Tap any song already on the board to see its full details.
                </Text>
              </Section>

            </ScrollView>
            {canScrollMore && (
              <View style={styles.scrollHint} pointerEvents="none">
                <Text style={styles.scrollHintText}>▼ SCROLL FOR MORE</Text>
              </View>
            )}
          </View>

          <Pressable style={styles.secondaryButton} onPress={onWatchTutorial}>
            <Text style={styles.secondaryButtonText}>▶ WATCH TUTORIAL</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>CHOOSE A CATEGORY</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5, 8, 18, 0.82)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "85%",
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
    marginBottom: 10,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 1,
  },
  closeText: {
    color: colors.textSecondary,
    fontSize: 22,
    fontWeight: "700",
  },
  scrollWrap: {
    flex: 1,
    position: "relative",
    marginBottom: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollHint: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingVertical: 6,
    paddingTop: 18,
    backgroundColor: "rgba(22, 33, 63, 0.95)",
  },
  scrollHintText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: colors.song,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 6,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 6,
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
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: colors.artist,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 10,
  },
  secondaryButtonText: {
    color: colors.artist,
    fontWeight: "800",
    letterSpacing: 1,
    fontSize: 13,
  },
});
