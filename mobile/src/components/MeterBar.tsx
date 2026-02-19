import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';
import {tokens} from '../theme/tokens';
import type {Meter} from '../types/api';

export function MeterBar({meter}: {meter: Meter}) {
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: meter.value,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [fillAnim, meter.value]);

  const fillWidth = fillAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, {width: fillWidth}]} />
      </View>
      <Text style={styles.label}>{meter.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
  },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: tokens.border,
    borderRadius: 99,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: tokens.yellow,
    borderRadius: 99,
  },
  label: {
    color: tokens.muted,
    fontSize: 11,
  },
});
