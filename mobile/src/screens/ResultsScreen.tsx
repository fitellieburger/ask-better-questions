import React, {useState} from 'react';
import {FlatList, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ItemCard} from '../components/ItemCard';
import {MeterBar} from '../components/MeterBar';
import {tokens} from '../theme/tokens';
import type {Bundle, Item, Meter} from '../types/api';

const TABS: {key: keyof Bundle; label: string}[] = [
  {key: 'fast', label: 'Fast'},
  {key: 'deeper', label: 'Deeper'},
  {key: 'cliff', label: 'Cliff'},
];

interface Props {
  bundle: Bundle;
  meter?: Meter;
}

export function ResultsScreen({bundle, meter}: Props) {
  const [activeTab, setActiveTab] = useState<keyof Bundle>('fast');
  const items: Item[] = bundle[activeTab] ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}>
            <Text
              style={[
                styles.tabText,
                activeTab === tab.key && styles.tabTextActive,
              ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        renderItem={({item}) => <ItemCard item={item} />}
        contentContainerStyle={styles.list}
        ListFooterComponent={meter ? <MeterBar meter={meter} /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.bg,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  tab: {
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radiusCard,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  tabActive: {
    borderColor: tokens.yellow,
  },
  tabText: {
    color: tokens.muted,
    fontSize: 12,
  },
  tabTextActive: {
    color: tokens.yellow,
  },
  list: {
    padding: 16,
    paddingTop: 10,
  },
});
