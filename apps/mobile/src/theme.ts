import { useColorScheme } from 'react-native';

/** Те же цвета, что у веба (apps/web/src/index.css). Позже — общий пакет ui-tokens. */
const light = { bg: '#f7f6f2', surface: '#ffffff', border: '#e3e0d8', ink: '#1d2428', ink2: '#4b555b', muted: '#7a8287', primary: '#1f6f63', primaryInk: '#ffffff', primarySoft: '#e3f0ec', ok: '#2f7d4f', warnSoft: '#fbf0d9', danger: '#b4443a' };
const dark: typeof light = { bg: '#0f1417', surface: '#161d21', border: '#2a343a', ink: '#e8ecee', ink2: '#b7c0c5', muted: '#86929a', primary: '#5cb8a6', primaryInk: '#0b1f1b', primarySoft: '#18302b', ok: '#7cc79a', warnSoft: '#33290f', danger: '#ec8a80' };

export type Theme = typeof light;
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
