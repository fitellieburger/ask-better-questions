import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {AnalysisScreen} from '../screens/AnalysisScreen';
import {HomeScreen} from '../screens/HomeScreen';
import {tokens} from '../theme/tokens';

export type RootStackParamList = {
  Home: undefined;
  Analysis: {url?: string};
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {backgroundColor: tokens.bg},
        headerTintColor: tokens.yellow,
        headerTitleStyle: {fontWeight: '700'},
        contentStyle: {backgroundColor: tokens.bg},
      }}>
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{title: 'Ask Better Questions'}}
      />
      <Stack.Screen
        name="Analysis"
        component={AnalysisScreen}
        options={{title: 'Analyzing…'}}
      />
    </Stack.Navigator>
  );
}
