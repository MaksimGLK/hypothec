import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/api/auth';
import { useTheme } from '../src/theme';
import { Body, Button, Field } from '../src/ui';

export default function Login() {
  const { login } = useAuth();
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <View style={{ gap: 4, marginBottom: 8 }}>
          <Text style={{ color: t.muted }}>Ипотечный планировщик</Text>
          <Text style={{ color: t.ink, fontSize: 28, fontWeight: '600' }}>Вход</Text>
        </View>
        <Field label="Почта" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <Field label="Пароль" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} />
        {error && <Text style={{ color: t.danger }}>{error}</Text>}
        <Button title="Войти" onPress={submit} loading={busy} />
        <Body muted>Регистрация пока — на сайте. Аккаунт общий для сайта и приложения.</Body>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
