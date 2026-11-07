import { consumeFile } from '../worker.js';
import { compactSession, expandSession } from './compact.js';

// The builder replaces this sentinel with the standalone worker source.
const embeddedWorker = null; /* WORKER_SOURCE */
export function createParseWorker() {
  if (embeddedWorker != null) {
    const url = URL.createObjectURL(new Blob([embeddedWorker], { type: 'text/javascript' }));
    try { return new Worker(url); } finally { URL.revokeObjectURL(url); }
  }
  return new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
}

export function parseFile(file, progress) {
  const controller = new AbortController();
  let worker, rejectTask, settled = false, fallbackStarted = false;
  const promise = new Promise((resolve, reject) => {
    rejectTask = reject;
    const finish = session => { if (!settled) { settled = true; worker?.terminate(); resolve(session); } };
    const fail = error => { if (!settled) { settled = true; worker?.terminate(); reject(error); } };
    const fallback = () => {
      if (settled || fallbackStarted) return;
      fallbackStarted = true; worker?.terminate();
      consumeFile(file, { progress, signal: controller.signal, yieldWork: true })
        .then(value => expandSession(compactSession(value))).then(finish, fail);
    };
    try {
      worker = createParseWorker();
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.type === 'progress') progress(data.bytes, data.total);
        else if (data.type === 'session') {
          try { finish(expandSession(data.session)); } catch (error) { fail(error); }
        }
        else fail(new Error(data.message));
      };
      worker.onerror = event => { event.preventDefault(); fallback(); };
      worker.postMessage(file);
    } catch { fallback(); }
  });
  return { promise, cancel() {
    if (settled) return;
    settled = true; controller.abort(); worker?.terminate();
    rejectTask(new DOMException('Cancelled', 'AbortError'));
  } };
}
