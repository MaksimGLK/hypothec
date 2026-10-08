import { isIsoDate } from '@hypothec/core';
import { z } from 'zod';

/** Сумма в копейках: целое неотрицательное число (до ~90 трлн ₽). */
export const Kop = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Сумма в копейках, которая может быть отрицательной (разница, дефицит). */
export const SignedKop = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

export const IsoDate = z.string().refine(isIsoDate, { message: 'Дата в формате ГГГГ-ММ-ДД' });

/** Годовая ставка в процентах, строкой: "16", "5.9". */
export const RatePercent = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,3})?$/, { message: 'Ставка в процентах, например 16 или 5.9' });

export const Percent = z.string().regex(/^(100|\d{1,2})(\.\d{1,2})?$/, { message: 'Процент от 0 до 100' });

export const Id = z.string().min(1).max(64);
export const Uuid = z.uuid();

/** Версия записи для оптимистичной блокировки при совместном редактировании. */
export const Version = z.number().int().nonnegative();

export const ErrorCode = z.enum([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'invalid_credentials',
  'email_taken',
  'email_not_verified',
  'invalid_code',
  'weak_password',
  'consent_required',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const Paginated = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/** Обёртка сущности с версией и датами. */
export const Meta = z.object({
  id: Id,
  version: Version,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
