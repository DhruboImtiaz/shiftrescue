// Only a confirmed missing/deleted event permits fallback. Connection and auth
// failures must not erase the selected event preference or masquerade as no data.
export async function recoverSavedEvent({ selectedId, events, load }) {
  const ids = [...new Set([selectedId, ...events.map(event => event.id)].filter(Boolean))];
  for (const id of ids) {
    try { return await load(id); }
    catch (error) { if (![404, 410].includes(error.status)) throw error; }
  }
  return null;
}
