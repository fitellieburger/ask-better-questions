import React from 'react';
import {FlatList, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {tokens} from '../theme/tokens';
import type {ExtractCandidate} from '../types/api';

interface Props {
  candidates: ExtractCandidate[];
  onPick: (url: string) => void;
}

export function CandidateList({candidates, onPick}: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.prompt}>
        This page has multiple articles. Pick one:
      </Text>
      <FlatList
        data={candidates}
        keyExtractor={item => item.url}
        renderItem={({item}) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => onPick(item.url)}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title || item.url}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.bg,
    padding: 16,
  },
  prompt: {
    color: tokens.muted,
    fontSize: 12,
    marginBottom: 12,
  },
  item: {
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radiusCard,
    padding: 12,
    marginBottom: 8,
  },
  title: {
    color: tokens.fg,
    fontSize: 13,
    lineHeight: 18,
  },
});
