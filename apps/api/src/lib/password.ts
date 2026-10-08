import { hash, verify } from '@node-rs/argon2';
import { AppError } from './errors.js';

/** Параметры argon2id по рекомендациям OWASP. */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Хэш-заглушка: проверяем пароль даже для несуществующего email, чтобы по времени ответа нельзя было узнать, есть ли аккаунт. */
let dummyHash: Promise<string> | null = null;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash.then((h) => verifyPassword(h, password));
}

const COMMON = new Set(
  `12345678 123456789 1234567890 password password1 qwerty123 qwertyuiop 11111111 00000000 87654321 12341234
  123123123 iloveyou 1q2w3e4r 1q2w3e4r5t qwerty12 asdfghjk zxcvbnm1 abcd1234 abc12345 password123 admin123
  welcome1 monkey12 dragon12 sunshine baseball football superman letmein1 trustno1 123qweasd qazwsxedc
  qwe123qwe 1qaz2wsx йцукенгш пароль123 привет123 12qwaszx q1w2e3r4 q1w2e3r4t5 parol123 11223344 55555555
  66666666 77777777 88888888 99999999 22222222 33333333 44444444 1234qwer qwer1234 asdf1234 marina123
  natasha1 maksim123 sergey123 andrey123 vladimir alexander nikita123 samsung1 computer internet`.split(/\s+/),
);

/** Проверка пароля: длина и не из списка самых частых. Без требований «заглавная + цифра + символ». */
export function assertStrongPassword(password: string, email: string): void {
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) {
    throw new AppError('weak_password', 'Этот пароль слишком простой — его легко подобрать. Придумайте другой, можно фразу из нескольких слов.');
  }
  const local = email.split('@')[0]!.toLowerCase();
  if (local.length >= 4 && lower.includes(local)) {
    throw new AppError('weak_password', 'Пароль не должен содержать адрес почты.');
  }
}
