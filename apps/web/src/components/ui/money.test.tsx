import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MoneyInput, parseRubles } from './index.js';

describe('ввод сумм', () => {
  it('рубли с разделителями → целые копейки', () => {
    expect(parseRubles('1 250 000')).toBe(125_000_000);
    expect(parseRubles('1 250 000,50 ₽')).toBe(125_000_050);
    expect(parseRubles('0.1')).toBe(10);
    expect(parseRubles('')).toBeNull();
    expect(parseRubles('12,345')).toBeNaN();
    expect(parseRubles('abc')).toBeNaN();
  });

  it('поле группирует разряды и отдаёт копейки', () => {
    let last: number | null = null;
    function Harness() {
      const [v, setV] = useState<number | null>(null);
      return (
        <MoneyInput
          aria-label="Сумма"
          value={v}
          onChange={(k) => {
            last = k;
            setV(k);
          }}
        />
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText('Сумма') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9000000' } });
    expect(input.value).toBe('9 000 000');
    expect(last).toBe(900_000_000);
    fireEvent.change(input, { target: { value: '1500,5' } });
    expect(last).toBe(150_050);
    fireEvent.change(input, { target: { value: '' } });
    expect(last).toBeNull();
  });
});
