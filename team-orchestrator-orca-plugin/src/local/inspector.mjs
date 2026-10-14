export async function connectInspector(url, timeoutMs = 4000) {
  const address = new URL(url);
  if (address.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) throw new Error('Inspector must be loopback-only.');
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Inspector connection timed out.')); }, timeoutMs);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Inspector connection failed.')); }, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const fail = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  socket.addEventListener('close', () => fail(new Error('Inspector disconnected.')));
  socket.addEventListener('error', () => fail(new Error('Inspector transport failed.')));
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  return {
    async evaluate(expression) {
      const id = ++sequence;
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Inspector evaluation timed out.')); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result?.value;
    },
    close() { fail(new Error('Inspector session closed.')); socket.close(); }
  };
}
