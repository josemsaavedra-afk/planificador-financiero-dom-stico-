// Explicit port; no Supabase discovery, network client, or automatic queue replay.
export function createTreasuryPersistence({ enabled = false, backend = null, getContext = () => null, timeoutMs = 15000 } = {}) {
  let active = enabled === true, generation = 0;
  const state = () => !active ? 'local' : typeof backend?.execute === 'function' ? 'persistent' : 'blocked';
  async function execute(operation, payload) {
    if (state() !== 'persistent') throw new Error('Persistencia desactivada o sin backend explícito');
    if (!['import', 'checkpoint', 'confirm', 'revoke', 'read'].includes(operation)) throw new Error('Operación no admitida');
    const context = structuredClone(getContext()), start = generation;
    if (!context?.userId || !context?.householdId) throw new Error('Sesión y hogar requeridos');
    const controller = new AbortController();let timer;
    try {
      const result = await Promise.race([
        backend.execute(operation, structuredClone(payload), context, controller.signal),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort();reject(new Error('Resultado desconocido por timeout; consultar o reintentar con la misma identidad')); }, timeoutMs); })
      ]);
      if (!active || generation !== start || JSON.stringify(getContext()) !== JSON.stringify(context)) throw new Error('Respuesta obsoleta: el contexto o la autorización ha cambiado');
      return result;
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({ state, execute, setEnabled(value) { active = value === true; generation++; } });
}
