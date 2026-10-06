// Deterministic arithmetic checks for extracted PDF values; never infer missing amounts.
export function validateDocumentAmounts(values, toleranceCents = 1) {
  if (!values || typeof values !== 'object') throw new TypeError('Document values required');
  const fields = ['base_cents','vat_cents','withholding_cents','total_cents'];
  const present = fields.filter(field => values[field] !== undefined && values[field] !== null);
  const errors = present.filter(field => !Number.isSafeInteger(values[field]));
  if (errors.length) return { status:'review', reason:'invalid_amount', fields:errors };
  if (!Number.isSafeInteger(toleranceCents) || toleranceCents < 0 || toleranceCents > 5) throw new TypeError('Invalid tolerance');
  if (present.length !== fields.length) return { status:'review', reason:'missing_amount', fields:fields.filter(field => !present.includes(field)) };
  const expected = values.base_cents + values.vat_cents - values.withholding_cents;
  if (!Number.isSafeInteger(expected)) return { status:'review', reason:'overflow', fields };
  const difference_cents = values.total_cents - expected;
  return Math.abs(difference_cents) <= toleranceCents
    ? { status:'valid', difference_cents }
    : { status:'review', reason:'arithmetic_mismatch', difference_cents, fields };
}
