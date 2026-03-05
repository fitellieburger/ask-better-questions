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

export function AnalysisScreen({route, navigation}: Props) {
  const urlFromNav = route.params?.url;
  const {phase, run} = useAnalysis();

  // Update header title to reflect current phase
  useEffect(() => {
    if (phase.kind === 'result') {
      navigation.setOptions({title: 'Results'});
    } else if (phase.kind === 'choice') {
      navigation.setOptions({title: 'Choose article'});
    } else if (phase.kind === 'error') {
      navigation.setOptions({title: 'Error'});
    } else {
      navigation.setOptions({title: 'Analyzing…'});
    }
  }, [phase.kind, navigation]);

  useEffect(() => {
    if (urlFromNav) {
      // Navigated here from the URL input — run directly, skip share menu
      run(urlFromNav);
    } else {
      // Cold launch from share sheet: read the URL the OS delivered
      ShareMenuReactView.getInitialShare()
        .then((share: {data?: string} | null) => {
          const url = share?.data;
          if (url && /^https?:\/\//.test(url)) {
            run(url);
          }
        })
        .catch(() => {
          // No initial share — opened directly, nothing to do
        });
    }

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
