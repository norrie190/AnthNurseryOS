export function currencyDecimalPlaces(currency: string): number {
  const places = new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits;
  if (places === undefined) throw new Error('Currency precision is unavailable.');
  return places;
}

// Parse decimal text without floating point multiplication or rounding.
export function parseMoneyInput(text: string, currency: string): number | null {
  const value = text.trim();
  if (!value) return null;
  const places = currencyDecimalPlaces(currency);
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error('Enter a positive amount or zero, without symbols or commas.');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > places) {
    throw new Error(`Use no more than ${places} decimal places for ${currency}.`);
  }
  const minor = BigInt(whole + fraction.padEnd(places, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('This amount is too large.');
  return Number(minor);
}

export function formatPurchaseMoney(minor: number | null, currency: string): string {
  if (minor === null) return 'Not recorded';
  // Display only: stored amounts and parsing remain integers.
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(
    minor / 10 ** currencyDecimalPlaces(currency),
  );
}

export function formatMoneyInput(minor: number | null, currency: string): string {
  if (minor === null) return '';
  const places = currencyDecimalPlaces(currency);
  const digits = BigInt(minor)
    .toString()
    .padStart(places + 1, '0');
  return places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
}
