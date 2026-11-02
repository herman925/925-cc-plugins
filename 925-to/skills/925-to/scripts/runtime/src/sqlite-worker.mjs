import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

let db, initialized = false;
try {
  db = new DatabaseSync(workerData.path, { readOnly: workerData.readOnly });
  db.exec(`PRAGMA busy_timeout = ${workerData.busyTimeoutMs}; PRAGMA foreign_keys = ON;`);
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('Foreign-key enforcement is unavailable.');
  initialized = true;
  parentPort.postMessage({ ready: true });
} catch (error) {
  db?.close();
  parentPort.postMessage({ startupError: { message: error.message, code: error.code, errcode: error.errcode } });
  parentPort.close();
}

if (initialized) parentPort.on('message', ({ id, method, sql, params }) => {
  try {
    let rows = [];
    if (method === 'close') {
      db.close();
      parentPort.postMessage({ id, rows });
      parentPort.close();
      return;
    }
    if (method === 'exec') db.exec(sql);
    else {
      const statement = db.prepare(sql);
      rows = statement.all(...(params ? [params] : []));
    }
    parentPort.postMessage({ id, rows });
  } catch (error) {
    parentPort.postMessage({ id, error: { message: error.message, code: error.code, errcode: error.errcode } });
  }
});
