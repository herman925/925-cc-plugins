export function createBridge(parentWindow, eventWindow = window, timeoutMs = 5000) {
  const pending = new Map();
  let sequence = 0;
  eventWindow.addEventListener('message', event => {
    if (event.source !== parentWindow || event.data?.type !== 'orca-panel-action-result') return;
    const request = pending.get(event.data.requestId);
    if (!request) return;
    pending.delete(event.data.requestId);
    clearTimeout(request.timer);
    if (event.data.ok) request.resolve(event.data.value);
    else {
      const error = new Error(event.data.error || 'Orca rejected the request.');
      error.code = event.data.errorCode;
      request.reject(error);
    }
  });
  return (action, params, options = {}) => new Promise((resolve, reject) => {
    const requestId = `team-${++sequence}`;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Orca did not answer. The outcome is unconfirmed.')); }, options.timeoutMs ?? timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    parentWindow.postMessage({ type: 'orca-panel-action', requestId, action, params }, '*');
  });
}
