import React, {useState} from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {tokens} from '../theme/tokens';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({navigation}: Props) {
  const [url, setUrl] = useState('');

  const handleAnalyze = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      return;
    }
    navigation.navigate('Analysis', {url: trimmed});
  };

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Ask Better Questions</Text>
      <Text style={styles.subtitle}>
        Paste an article URL to analyze it, or share one from your browser.
      </Text>

      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="https://…"
        placeholderTextColor={tokens.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={handleAnalyze}
      />

      <TouchableOpacity
        style={[styles.btn, !url.trim() && styles.btnDisabled]}
        onPress={handleAnalyze}
        disabled={!url.trim()}>
        <Text style={styles.btnText}>Analyze</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.bg,
    padding: 24,
    justifyContent: 'center',
  },
  logo: {
    color: tokens.yellow,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  subtitle: {
    color: tokens.muted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 28,
  },
  input: {
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: tokens.fg,
    fontSize: 14,
    marginBottom: 16,
  },
  btn: {
    backgroundColor: tokens.yellow,
    borderRadius: tokens.radiusPill,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
});
