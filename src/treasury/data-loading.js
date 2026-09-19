export async function readAllPages(createQuery, size = 500) {
  if (!Number.isInteger(size) || size < 1 || size > 1000) throw new Error('Tamaño de página inválido');
  const data = [];
  for (let page = 0; page < 10000; page++) {
    const result = await createQuery().range(page * size, (page + 1) * size - 1);
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error('Respuesta de datos incompleta');
    data.push(...result.data);
    if (result.data.length < size) return { data, error: null };
  }
  throw new Error('Historial demasiado extenso; carga cancelada sin publicar datos parciales');
}
