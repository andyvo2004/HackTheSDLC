const feedClients = new Map();

export function broadcastPaymentEvent(payload) {
  const ownerUserId = payload?.ownerUserId || null;
  if (!ownerUserId) return;
  const { ownerUserId: _omitOwner, ...safePayload } = payload;
  const data = JSON.stringify(safePayload);
  feedClients.forEach((clientUserId, client) => {
    if (clientUserId !== ownerUserId) return;
    client.write(`data: ${data}\n\n`);
  });
}

export { feedClients };
