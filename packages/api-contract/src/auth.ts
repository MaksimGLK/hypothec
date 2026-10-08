import { z } from 'zod';
import { Id } from './common.js';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Проверьте адрес почты' }))
  .refine((v) => v.length <= 254, 'Слишком длинный адрес');

/** Требования к паролю — длина и не из списка самых частых (проверяется на сервере). Без «заглавная + цифра + символ». */
export const Password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Пароль — не короче ${PASSWORD_MIN_LENGTH} символов`)
  .max(PASSWORD_MAX_LENGTH, `Пароль — не длиннее ${PASSWORD_MAX_LENGTH} символов`);

export const Platform = z.enum(['web', 'ios', 'android']);

export const DeviceInfo = z.object({
  platform: Platform,
  name: z.string().max(100).optional(),
});

export const ConsentType = z.enum(['personal_data', 'marketing']);
export const Consent = z.object({
  type: ConsentType,
  /** Версия документа, с которым согласился пользователь. */
  documentVersion: z.string().min(1).max(32),
  accepted: z.literal(true),
});

export const RegisterRequest = z.object({
  email: Email,
  password: Password,
  name: z.string().trim().min(1).max(100),
  consents: z.array(Consent).refine((c) => c.some((x) => x.type === 'personal_data'), {
    message: 'Нужно согласие на обработку персональных данных',
  }),
  device: DeviceInfo,
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  device: DeviceInfo,
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const RefreshRequest = z.object({
  /** Мобильные клиенты передают токен в теле; веб — в httpOnly-cookie, тогда поле не нужно. */
  refreshToken: z.string().min(20).max(512).optional(),
});

export const VerifyEmailRequest = z.object({ code: z.string().regex(/^\d{6}$/, 'Код из 6 цифр') });

export const ForgotPasswordRequest = z.object({ email: Email });

export const ResetPasswordRequest = z.object({
  email: Email,
  code: z.string().regex(/^\d{6}$/, 'Код из 6 цифр'),
  newPassword: Password,
});

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: Password,
});

export const User = z.object({
  id: Id,
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof User>;

export const AuthTokens = z.object({
  accessToken: z.string(),
  /** Для веба приходит в cookie и в теле не возвращается. */
  refreshToken: z.string().optional(),
  accessTokenExpiresIn: z.number().int().positive(),
});

export const AuthResponse = AuthTokens.extend({ user: User });
export type AuthResponse = z.infer<typeof AuthResponse>;

export const Session = z.object({
  id: Id,
  platform: Platform,
  deviceName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});

export const DeleteAccountRequest = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: z.string().regex(/^\d{6}$/, 'Код из 6 цифр'),
});
