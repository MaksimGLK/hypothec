import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { useTheme } from './theme';

export function Screen({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.screen, { backgroundColor: t.bg }]}>{children}</View>;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      {title && <Text style={[styles.cardTitle, { color: t.ink }]}>{title}</Text>}
      {children}
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontSize: 13 }}>{children}</Text>;
}

export function Big({ children, color }: { children: ReactNode; color?: string }) {
  const t = useTheme();
  return <Text style={{ color: color ?? t.ink, fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const t = useTheme();
  return <Text style={{ color: muted ? t.ink2 : t.ink, fontSize: 15, lineHeight: 21 }}>{children}</Text>;
}

export function Field(props: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Label>{props.label}</Label>
      <TextInput placeholderTextColor={t.muted} {...props} style={[styles.input, { borderColor: t.border, color: t.ink, backgroundColor: t.surface }]} accessibilityLabel={props.label} />
    </View>
  );
}

export function Button({ title, onPress, loading, variant = 'primary' }: { title: string; onPress(): void; loading?: boolean; variant?: 'primary' | 'secondary' }) {
  const t = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [styles.button, { backgroundColor: primary ? t.primary : t.surface, borderColor: t.border, opacity: pressed || loading ? 0.7 : 1 }]}
    >
      {loading ? <ActivityIndicator color={primary ? t.primaryInk : t.ink} /> : <Text style={{ color: primary ? t.primaryInk : t.ink, fontWeight: '600', fontSize: 16 }}>{title}</Text>}
    </Pressable>
  );
}

export function Disclaimer() {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontSize: 12, marginTop: 8 }}>Расчёты носят информационный характер и строятся только на данных, которые вы ввели.</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  input: { height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
  button: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
