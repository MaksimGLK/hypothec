import { ScrollView } from 'react-native';
import { useAuth } from '../../src/api/auth';
import { Body, Button, Card } from '../../src/ui';

export default function More() {
  const { user, logout } = useAuth();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card title={user?.name ?? 'Профиль'}>
        <Body muted>{user?.email}</Body>
      </Card>
      <Card title="Это заготовка приложения">
        <Body muted>Сейчас здесь главный экран, траты и калькулятор досрочки. Остальные разделы, push-напоминания и вход через VK ID, Яндекс ID и Сбер ID появятся на следующих этапах — API для них уже готово.</Body>
      </Card>
      <Button title="Выйти" variant="secondary" onPress={() => void logout()} />
    </ScrollView>
  );
}
