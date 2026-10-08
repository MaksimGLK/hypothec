import type { ErrorCode } from '@hypothec/api-contract';

const STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  invalid_credentials: 401,
  email_taken: 409,
  email_not_verified: 403,
  invalid_code: 400,
  weak_password: 400,
  consent_required: 400,
  internal_error: 500,
};

/** Ошибка с кодом из контракта API; текст — для человека, по-русски. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = 'Запись') => new AppError('not_found', `${what} не найдена`);
export const forbidden = (message = 'Недостаточно прав') => new AppError('forbidden', message);
export const conflict = () =>
  new AppError('conflict', 'Данные уже изменились — возможно, их правил другой участник семьи. Обновите страницу и повторите.');
