import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {tokens} from '../theme/tokens';
import type {Bundle} from '../types/api';

const CHALLENGES: Record<keyof Bundle, string> = {
  fast: 'Before you share — find one source with the opposite take.',
  deeper: "Who isn't in this story? What would they say?",
  cliff: "Pick one cue. Search for the evidence — or notice where it's missing.",
};

export function ChallengeCard({tab}: {tab: keyof Bundle}) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Your move</Text>
      <Text style={styles.text}>{CHALLENGES[tab]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.28)',
    borderStyle: 'dashed',
    borderRadius: tokens.radiusCard,
    padding: 14,
    marginTop: 8,
    marginBottom: 4,
  },
  label: {
    color: tokens.yellow,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  text: {
    color: tokens.muted,
    fontSize: 13,
    lineHeight: 19,
  },
});
