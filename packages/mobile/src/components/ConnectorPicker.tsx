import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CONNECTION_CATEGORIES, type ConnectionCategory } from "@chartcross/engine";
import { colors, connectorDim } from "../theme";

interface Props {
  active: boolean;
  onGuess: (type: ConnectionCategory) => void;
  wildcardCount: number;
  onUseWildcard: () => void;
  /** Whether the stuck-rescue flow is currently offered (see GameEngine.canWildRescue()). */
  rescueAvailable: boolean;
  /** True once the Wild chip has been tapped in rescue mode and we're waiting on a board tap. */
  rescueTargeting: boolean;
  onToggleRescue: () => void;
}

const LABELS: Record<ConnectionCategory, string> = {
  COLLAB: "COLLAB\nCONNECT",
  ARTIST: "ARTIST\nCONNECT",
  SAME_YEAR: "SAME YEAR\nCONNECT",
};

const ACCENT: Record<ConnectionCategory, string> = {
  COLLAB: colors.collab,
  ARTIST: colors.connectorArtist,
  SAME_YEAR: colors.decade,
};

/**
 * The three connection-type tiles are always available - not drawn from the
 * rack - so this renders as a permanent, reusable trio rather than a rack
 * slot. Only tappable while a gap placement is waiting on a guess. The wild
 * connector is a fourth slot alongside them, bought via buyWildcard() -
 * it's the only role a wildcard can play now, never a placeable rack tile.
 * That same chip also doubles as the entry point for the stuck-rescue flow:
 * tapping it while rescueAvailable (and not mid-guess) arms rescueTargeting
 * so the next board tap places the wild connector there instead.
 */
export function ConnectorPicker({
  active,
  onGuess,
  wildcardCount,
  onUseWildcard,
  rescueAvailable,
  rescueTargeting,
  onToggleRescue,
}: Props) {
  const wildcardEnabled = (active || rescueAvailable) && wildcardCount > 0;
  const label = active
    ? "PICK A CONNECTION TYPE"
    : rescueTargeting
      ? "TAP A BOARD CELL FOR THE WILD CONNECTOR"
      : rescueAvailable
        ? "STUCK — USE A WILD RESCUE"
        : "CONNECTORS";
  return (
    <View>
      <Text style={[styles.label, (active || rescueAvailable) && styles.labelActive]}>{label}</Text>
      <View style={styles.row}>
        {CONNECTION_CATEGORIES.map((type) => {
          const accent = ACCENT[type];
          return (
            <Pressable
              key={type}
              disabled={!active}
              onPress={() => onGuess(type)}
              style={[
                styles.chip,
                {
                  borderColor: accent,
                  backgroundColor: connectorDim[type],
                  opacity: active ? 1 : 0.4,
                  boxShadow: active ? `0 0 6px ${accent}` : undefined,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: accent }]}>{LABELS[type]}</Text>
            </Pressable>
          );
        })}
        <Pressable
          disabled={!wildcardEnabled}
          onPress={active ? onUseWildcard : onToggleRescue}
          style={[
            styles.chip,
            rescueTargeting && styles.chipSelected,
            {
              borderColor: colors.wildcard,
              backgroundColor: colors.wildcardDim,
              opacity: wildcardEnabled ? 1 : 0.4,
              boxShadow: wildcardEnabled ? `0 0 6px ${colors.wildcard}` : undefined,
            },
          ]}
        >
          <Text style={[styles.chipText, { color: colors.wildcard }]}>{`★ WILD\n(${wildcardCount})`}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.textSecondary,
    fontWeight: "700",
    letterSpacing: 1,
    fontSize: 11,
    marginBottom: 8,
    textAlign: "center",
  },
  labelActive: {
    color: colors.pendingGap,
  },
  row: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  chip: {
    width: 74,
    height: 54,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: {
    borderWidth: 3,
  },
  chipText: {
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 13,
  },
});
