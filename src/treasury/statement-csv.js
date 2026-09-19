const HEADER = {
  date: ['fecha', 'date', 'fecha operacion', 'fecha valor'],
  concept: ['concepto', 'descripcion', 'description', 'detalle', 'movimiento'],
  amount: ['importe', 'amount', 'cantidad'],
  debit: ['cargo', 'debe', 'debit'],
  credit: ['abono', 'haber', 'credit'],
  reference: ['referencia', 'reference', 'ref']
};
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const amount = value => { const clean = String(value ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.').replace(/[^0-9+.-]/g, ''); const parsed = Number(clean); return Number.isFinite(parsed) ? parsed : null; };
const date = value => { const text = String(value || '').trim(), match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`; return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null; };
function split(line, delimiter) { let quoted = false, cell = '', out = []; for (let i = 0; i < line.length; i++) { const char = line[i]; if (char === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = !quoted; else if (char === delimiter && !quoted) { out.push(cell); cell = ''; } else cell += char; } out.push(cell); return out; }
function find(headers, aliases) { return headers.findIndex(header => aliases.includes(norm(header))); }

export function parseStatementCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error('El CSV no contiene movimientos');
  const delimiter = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headers = split(lines[0], delimiter), indexes = Object.fromEntries(Object.entries(HEADER).map(([key, aliases]) => [key, find(headers, aliases)]));
  if (indexes.date < 0 || indexes.concept < 0 || (indexes.amount < 0 && indexes.debit < 0 && indexes.credit < 0)) throw new Error('Se necesitan columnas de fecha, concepto y un importe (o cargo/abono)');
  return lines.slice(1).map((line, offset) => {
    const cells = split(line, delimiter), parsedDate = date(cells[indexes.date]);
    const direct = indexes.amount >= 0 ? amount(cells[indexes.amount]) : null, debit = indexes.debit >= 0 ? amount(cells[indexes.debit]) : null, credit = indexes.credit >= 0 ? amount(cells[indexes.credit]) : null;
    const signed = direct ?? ((credit || 0) - Math.abs(debit || 0));
    if (!parsedDate || signed == null) throw new Error(`Fila ${offset + 2}: fecha o importe no válido`);
    return { id: `csv-${offset + 1}`, date: parsedDate, concept: cells[indexes.concept]?.trim() || 'Sin concepto', reference: indexes.reference >= 0 ? cells[indexes.reference]?.trim() || null : null, signedAmount: signed };
  });
}
