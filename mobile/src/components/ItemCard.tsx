import React, {useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {tokens} from '../theme/tokens';
import type {Item} from '../types/api';

const LABEL_COLORS: Record<string, {bg: string; text: string}> = {
  Words: {bg: 'rgba(255,215,0,0.15)', text: '#FFD700'},
  Proof: {bg: 'rgba(80,200,120,0.15)', text: '#50C878'},
  Missing: {bg: 'rgba(255,100,80,0.15)', text: '#FF6450'},
};

export function ItemCard({item}: {item: Item}) {
  const [expanded, setExpanded] = useState(false);
  const colors = LABEL_COLORS[item.label] ?? LABEL_COLORS.Words;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.85}>
      <View style={[styles.badge, {backgroundColor: colors.bg}]}>
        <Text style={[styles.badgeText, {color: colors.text}]}>
          {item.label}
        </Text>
      </View>
      <Text style={styles.question}>{item.text}</Text>
      {expanded && <Text style={styles.why}>{item.why}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radiusCard,
    padding: 12,
    marginBottom: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  question: {
    color: tokens.fg,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  why: {
    color: tokens.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 6,
  },
});
