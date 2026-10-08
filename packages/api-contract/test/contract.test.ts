import type { AllocationSettings as CoreAllocationSettings, IncomeInput, LoanInput, PrepaymentInput, TaxMemberInput, WizardAnswers as CoreWizard } from '@hypothec/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  AllocationSettings,
  CreateIncomeRequest,
  CreateLoanRequest,
  CreatePrepaymentRequest,
  IsoDate,
  Kop,
  RatePercent,
  RegisterRequest,
  TaxMember,
  UpdateExpenseRequest,
  WizardAnswers,
} from '../src/index.js';

describe('контракт совместим с ядром', () => {
  it('типы запросов подходят на вход функциям ядра', () => {
    expectTypeOf<z.infer<typeof CreateLoanRequest> & { id: string }>().toExtend<LoanInput>();
    expectTypeOf<z.infer<typeof CreateIncomeRequest> & { id: string }>().toExtend<IncomeInput>();
    expectTypeOf<z.infer<typeof CreatePrepaymentRequest> & { id: string }>().toExtend<PrepaymentInput>();
    expectTypeOf<z.infer<typeof TaxMember>>().toExtend<TaxMemberInput>();
    expectTypeOf<z.infer<typeof AllocationSettings>>().toExtend<CoreAllocationSettings>();
    expectTypeOf<z.infer<typeof WizardAnswers>>().toExtend<CoreWizard>();
  });
});

describe('валидация', () => {
  it('деньги — только целые копейки', () => {
    expect(Kop.safeParse(100).success).toBe(true);
    expect(Kop.safeParse(100.5).success).toBe(false);
    expect(Kop.safeParse(-1).success).toBe(false);
  });

  it('даты и ставки', () => {
    expect(IsoDate.safeParse('2027-02-29').success).toBe(false);
    expect(IsoDate.safeParse('2028-02-29').success).toBe(true);
    expect(RatePercent.safeParse('16').success).toBe(true);
    expect(RatePercent.safeParse('5.9').success).toBe(true);
    expect(RatePercent.safeParse('16,5').success).toBe(false);
  });

  it('регистрация требует согласия на обработку ПДн и пароль от 8 символов', () => {
    const base = { email: ' Ivan@Example.RU ', password: 'длинный пароль', name: 'Иван', device: { platform: 'web' } };
    const ok = RegisterRequest.parse({ ...base, consents: [{ type: 'personal_data', documentVersion: '2026-10', accepted: true }] });
    expect(ok.email).toBe('ivan@example.ru');
    expect(RegisterRequest.safeParse({ ...base, consents: [] }).success).toBe(false);
    expect(RegisterRequest.safeParse({ ...base, password: 'short', consents: [{ type: 'personal_data', documentVersion: '1', accepted: true }] }).success).toBe(false);
  });

  it('разовый доход без даты и ежемесячный без дня — ошибка с понятным текстом', () => {
    const r = CreateIncomeRequest.safeParse({ name: 'Вычет', type: 'tax_refund', amountKop: 100, periodicity: 'once', reliability: 'expected' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe('Укажите дату поступления');
  });

  it('обновление требует версию записи', () => {
    expect(UpdateExpenseRequest.safeParse({ planKop: 100 }).success).toBe(false);
    expect(UpdateExpenseRequest.safeParse({ planKop: 100, version: 3 }).success).toBe(true);
  });

  it('кредит: значения по умолчанию', () => {
    const loan = CreateLoanRequest.parse({ name: 'Ипотека', principalKop: 100_000_00, annualRate: '16', termMonths: 120, type: 'annuity', issueDate: '2026-10-15' });
    expect(loan.interestMode).toBe('monthly');
    expect(loan.rateChanges).toEqual([]);
  });
});
