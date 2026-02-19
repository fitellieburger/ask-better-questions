import React, {useEffect, useRef, useState} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';
import {tokens} from '../theme/tokens';

// Same slides as the Chrome extension and webapp warmup
const SLIDES = [
  'Ask Better Questions',
  'Read with Intent',
  'What do you hope to see?',
  'Question the author',
  'Is it heat, or just hot air?',
  "Don't get caught in someone else's emotion.",
  'Look for signals in the text.',
  "Notice what's missing.",
  'Pause before you react.',
  'Who benefits from believing this?',
  "What's the claim? What's the proof?",
  'Strong feeling? Slow down.',
  'Urgency is a signal, not a command.',
  'If it wants you angry, ask why.',
  "Loud doesn't mean true.",
  'Are you learning — or just nodding?',
  'Does this make sense — or just feel good?',
];

interface Props {
  stage: string;
}

export function WarmupScreen({stage}: Props) {
  const [slideIdx, setSlideIdx] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;
  const barWidth = useRef(new Animated.Value(0)).current;

  // Ticker: fade out → swap slide → fade in
  useEffect(() => {
    const advance = () => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setSlideIdx(i => (i + 1) % SLIDES.length);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }).start();
      });
    };

    const initial = setTimeout(advance, 2600);
    const interval = setInterval(advance, 5200);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [opacity]);

  // Progress bar crawls 0 → 90% over ~12 ticks
  useEffect(() => {
    let pct = 0;
    const tick = setInterval(() => {
      pct = Math.min(90, pct + 5);
      Animated.timing(barWidth, {
        toValue: pct,
        duration: 420,
        useNativeDriver: false,
      }).start();
    }, 700);
    return () => clearInterval(tick);
  }, [barWidth]);

  const barWidthPct = barWidth.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <View style={styles.shell}>
        <Animated.Text style={[styles.slide, {opacity}]}>
          {SLIDES[slideIdx]}
        </Animated.Text>

        <View style={styles.barRow}>
          <Text style={styles.barLabel}>Loading</Text>
          <View style={styles.barTrack}>
            <Animated.View style={[styles.barFill, {width: barWidthPct}]} />
          </View>
        </View>

        <Text style={styles.statusText}>{stage}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.slateBg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  shell: {
    width: '100%',
    maxWidth: 600,
  },
  slide: {
    color: tokens.slateText,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 28,
    lineHeight: 36,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  barLabel: {
    color: tokens.slateText,
    fontWeight: '800',
    fontSize: 13,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: tokens.yellow,
    opacity: 0.82,
  },
  statusText: {
    color: tokens.slateMuted,
    fontSize: 11,
  },
});
