// A separate thread per connection is essential: synchronous SQLite calls on the
// test thread would serialize the "concurrent" writes before they reach SQLite.
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(workerData.path);
db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) {
  throw new Error('SQLite foreign-key enforcement is required.');
}
parentPort.postMessage({ ready: true });
parentPort.on('message', ({ id, method, sql, params }) => {
  try {
    if (method === 'close') {
      db.close();
      parentPort.postMessage({ id, result: [] });
      parentPort.close();
      return;
    }
    const names = new Set([...sql.matchAll(/:([a-z_]+)/g)].map(match => match[1]));
    const bound = params && Object.fromEntries(Object.entries(params).filter(([name]) => names.has(name)));
    const result = method === 'exec' ? (db.exec(sql), []) : db.prepare(sql).all(...(bound ? [bound] : []));
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: { message: error.message, code: error.code, errcode: error.errcode } });
  }
});
