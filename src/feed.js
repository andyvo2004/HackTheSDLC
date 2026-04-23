const feedClients = new Set();

export function broadcastPaymentEvent(payload) {
  const data = JSON.stringify(payload);
  feedClients.forEach((client) => {
    client.write(`data: ${data}\n\n`);
  });
}

export { feedClients };
