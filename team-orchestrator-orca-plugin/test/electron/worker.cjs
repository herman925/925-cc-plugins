const { pathToFileURL } = require('node:url');
const commands = new Map(); const pending = new Map(); let nextId = 0;
process.on('message', async m => {
  if (m.type === 'hostResult') { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error)) : p.resolve(m.value); }
  if (m.type === 'command') {
    try { process.send({ type: 'result', id: m.id, value: await commands.get(m.commandId)(m.args) }); }
    catch (error) { process.send({ type: 'result', id: m.id, error: error.message }); }
  }
});
(async () => {
  const activate = (await import(pathToFileURL(process.env.ORCA_TEST_PLUGIN + '/main.mjs').href)).default;
  await activate({ commands: { register: (id, fn) => commands.set(id, fn) }, events: { on() {} }, host: { call: (method, params) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); process.send({ type: 'host', id, method, params }); }) }, log: text => process.stdout.write(text + '\n') });
  process.send({ type: 'ready', commands: [...commands.keys()] });
})().catch(error => process.send({ type: 'fatal', error: error.stack }));
