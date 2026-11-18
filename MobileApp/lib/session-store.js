import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createSessionStore } from './session-store-core';

// In de webversie (alleen voor ontwikkeling) bestaat geen versleutelde opslag: geheimen blijven
// dan enkel in het geheugen, nooit onversleuteld op schijf.
const memory = new Map();
const secure = Platform.OS === 'web'
  ? {
      getItem: async key => memory.get(key) ?? null,
      setItem: async (key, value) => { memory.set(key, value); },
      removeItem: async key => { memory.delete(key); },
    }
  : {
      getItem: key => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: key => SecureStore.deleteItemAsync(key),
    };

const sessionStore = createSessionStore({ storage: AsyncStorage, secure });

export const saveSession = sessionStore.saveSession;
export const loadSession = sessionStore.loadSession;
