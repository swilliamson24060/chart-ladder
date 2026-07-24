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
  decadePoints,
  GUIDED_CONNECTION_BONUS,
  GUIDED_PATH_LENGTH,
  GUIDED_TILE_POINTS,
} from "@chartcross/engine";
import { colors } from "../theme";

interface Props {
  visible: boolean;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function HowToPlayModal({ visible, onClose }: Props) {
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
              <Section title="BUILD THE PATH">
                <Text style={styles.body}>
                  Connect the START artist to the ANCHOR artist by finding all {GUIDED_PATH_LENGTH} tiles
                  in the prepared path. Correct tiles are placed on the board automatically.
                </Text>
              </Section>

              <Section title="CHOOSE A TILE">
                <Text style={styles.body}>
                  Each step presents three artists or songs from your selected category. Exactly one
                  connects to the last tile on the path. A correct choice starts with{" "}
                  {GUIDED_TILE_POINTS} points.
                </Text>
              </Section>

              <Section title="TILE VALUES">
                <Text style={styles.body}>
                  Every correct tile also adds its decade value: a 2020s tile is worth{" "}
                  {decadePoints(2023)} extra point, increasing by one per decade back to{" "}
                  {decadePoints(1958)} points for the 1950s. For artists spanning several decades,
                  the most recent decade determines the value.
                </Text>
                <Text style={styles.body}>
                  The START artist's value is added to the first connection. The ANCHOR artist's
                  value is added to the fifth and final connection.
                </Text>
              </Section>

              <Section title="CONNECTION BONUS">
                <Text style={styles.body}>
                  After choosing the correct tile, identify whether the connection is COLLAB, ARTIST,
                  or DECADE. A correct answer adds {GUIDED_CONNECTION_BONUS} bonus points.
                </Text>
                <Text style={styles.body}>
                  A wrong connection answer reveals the correct answer and forfeits only the bonus.
                  Your correct tile still earns its base and decade-value points, and the path continues.
                </Text>
              </Section>

              <Section title="HINT">
                <Text style={styles.body}>
                  Tap the light bulb before choosing a tile to reveal the connection type. You can
                  still earn the {GUIDED_TILE_POINTS} tile points, but the {GUIDED_CONNECTION_BONUS}-point
                  connection bonus is forfeited for that step.
                </Text>
              </Section>

              <Section title="FINISH">
                <Text style={styles.body}>
                  A wrong artist/song choice earns 0 base points, but the correct tile is placed and
                  you may still try for the connection bonus. The session ends after five tile misses.
                </Text>
                <Text style={styles.body}>
                  Complete all {GUIDED_PATH_LENGTH} steps to finish a path. You can add another round
                  to the same score, end and submit, or save at the completed path and resume later.
                  There are no 2X or 3X board spaces.
                </Text>
              </Section>
            </ScrollView>
            {canScrollMore && (
              <View style={styles.scrollHint} pointerEvents="none">
                <Text style={styles.scrollHintText}>▼ SCROLL FOR MORE</Text>
              </View>
            )}
          </View>

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
});
