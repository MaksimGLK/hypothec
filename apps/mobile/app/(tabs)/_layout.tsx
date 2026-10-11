import { Tabs } from 'expo-router';
import { useTheme } from '../../src/theme';

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.ink,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Главная' }} />
      <Tabs.Screen name="budget" options={{ title: 'Траты' }} />
      <Tabs.Screen name="prepayment" options={{ title: 'Досрочка' }} />
      <Tabs.Screen name="more" options={{ title: 'Ещё' }} />
    </Tabs>
  );
}
