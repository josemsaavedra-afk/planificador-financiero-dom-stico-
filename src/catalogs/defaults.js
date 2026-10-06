// Safe defaults: no account numbers, persons, merchants, or private information.
export const DEFAULT_CATEGORIES = Object.freeze([
  ['Alimentación','expense'],['Vivienda','expense'],['Suministros','expense'],
  ['Transporte','expense'],['Seguros','expense'],['Salud','expense'],
  ['Educación','expense'],['Ocio','expense'],['Impuestos','expense'],
  ['Otros gastos','expense'],['Ingresos habituales','income'],
  ['Ingresos variables','income'],['Reembolsos','income']
].map(([name,kind]) => Object.freeze({name,kind})));
const key = c => c.name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-ES') + ':' + c.kind;
// Return only missing rows; no mutation, no overwrites, no reactivation of intentionally disabled entries.
export function missingDefaultCategories(existing = []) {
  if (!Array.isArray(existing)) throw new TypeError('existing must be an array');
  const known = new Set(existing.filter(x => x && typeof x.name === 'string' && typeof x.kind === 'string').map(key));
  return DEFAULT_CATEGORIES.filter(c => !known.has(key(c)));
}
export const DEFAULT_EXPENSE_SCOPES = Object.freeze(['domestic','professional','mixed']);
export const DEFAULT_INCOME_SOURCES = Object.freeze(['habitual','variable']);
