import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {tokens} from '../theme/tokens';

interface Props {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({message, onRetry}: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <TouchableOpacity style={styles.btn} onPress={onRetry}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.bg,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  btn: {
    borderWidth: 1,
    borderColor: tokens.yellow,
    borderRadius: tokens.radiusPill,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  btnText: {
    color: tokens.yellow,
    fontSize: 13,
    fontWeight: '600',
  },
});
