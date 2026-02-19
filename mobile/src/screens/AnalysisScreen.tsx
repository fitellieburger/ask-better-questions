import React, {useEffect} from 'react';
import {View} from 'react-native';
import ShareMenuReactView from 'react-native-share-menu';
import {CandidateList} from '../components/CandidateList';
import {ErrorBanner} from '../components/ErrorBanner';
import {WarmupScreen} from '../components/WarmupScreen';
import {useAnalysis} from '../hooks/useAnalysis';
import {tokens} from '../theme/tokens';
import {ResultsScreen} from './ResultsScreen';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Analysis'>;

export function AnalysisScreen({route}: Props) {
  const urlFromNav = route.params?.url;
  const {phase, run} = useAnalysis();

  useEffect(() => {
    // Cold launch from share sheet: read the URL the OS delivered
    ShareMenuReactView.getInitialShare().then(
      (share: {data?: string} | null) => {
        const url = share?.data ?? urlFromNav;
        if (url && /^https?:\/\//.test(url)) {
          run(url);
        } else if (urlFromNav) {
          // nav param that isn't a URL (shouldn't happen, but fallback)
          run(urlFromNav);
        }
      },
    );

    // Foreground / background share while the app is already open
    const listener = ShareMenuReactView.addNewShareListener(
      ({data}: {data?: string}) => {
        if (data && /^https?:\/\//.test(data)) {
          run(data);
        }
      },
    );

    return () => listener.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase.kind === 'warmup' || phase.kind === 'loading') {
    return <WarmupScreen stage={phase.stage} />;
  }

  if (phase.kind === 'choice') {
    return (
      <CandidateList
        candidates={phase.candidates}
        onPick={chosenUrl => run(phase.sourceUrl, chosenUrl)}
      />
    );
  }

  if (phase.kind === 'result') {
    return <ResultsScreen bundle={phase.bundle} meter={phase.meter} />;
  }

  if (phase.kind === 'error') {
    return (
      <ErrorBanner
        message={phase.message}
        onRetry={urlFromNav ? () => run(urlFromNav) : undefined}
      />
    );
  }

  // idle — nothing shown yet
  return <View style={{flex: 1, backgroundColor: tokens.bg}} />;
}
