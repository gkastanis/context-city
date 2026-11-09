import { agentRun, attachAgents } from './agents.js';
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

// DirectoryReader can return entries in several batches, including empty folders.
export async function droppedFiles(transfer) {
  async function visit(entry) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      Object.defineProperty(file, 'dropPath', { value: entry.fullPath });
      return [file];
    }
    if (!entry.isDirectory) return [];
    const reader = entry.createReader(), files = [];
    while (true) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) return files;
      for (const child of batch) files.push(...await visit(child));
    }
  }
  const entries = Array.from(transfer.items ?? [], item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return Array.from(transfer.files ?? []);
  const files = [];
  for (const entry of entries) files.push(...await visit(entry));
  return files;
}

// Descriptors retain File identity through an optional file field. No file contents are read here.
export function selectFiles(files, sessionId = null, chosen = null) {
  const agents = files.filter(f => /^agent-.+\.jsonl$/i.test(f.name));
  const candidates = files.filter(f => /\.jsonl$/i.test(f.name) && !agents.includes(f))
    .sort((a, b) => b.size - a.size);
  const main = chosen ?? candidates[0] ?? agents[0] ??
    (files.length === 1 && /\.json$/i.test(files[0].name) && !/^agent-.+\.meta\.json$/i.test(files[0].name) ? files[0] : null);
  const id = sessionId ?? main?.name?.replace(/\.jsonl$/i, '');
  const runs = agents.filter(f => f !== main && (!f.path?.includes('/subagents/') ||
    `/${f.path}`.includes(`/${id}/subagents/`)));
  return { main, runs, skipped: candidates.filter(f => f !== main).length };
}

export function parseFiles(files, progress = () => {}, existing = null) {
  let task, cancelled = false;
  const promise = (async () => {
    const descriptors = Array.from(files, file => ({ file, name: file.name,
      path: file.webkitRelativePath || file.dropPath || '', size: file.size }));
    const read = async descriptor => {
      if (cancelled) throw new DOMException('Cancelled', 'AbortError');
      task = parseFile(descriptor.file, (bytes, total) => progress(bytes, total, descriptor.name));
      return await task.promise;
    };
    let chosen = existing ? descriptors.find(f => f.name === existing.meta.sourceName) ?? { name: existing.meta.sourceName } : null;
    let main = existing;
    if (!main) {
      const candidates = descriptors.filter(f => /\.jsonl$/i.test(f.name) && !/^agent-.+\.jsonl$/i.test(f.name))
        .sort((a, b) => b.size - a.size);
      for (const candidate of candidates) {
        const value = await read(candidate);
        if (value.meta.thread === 'main') { chosen = candidate; main = value; break; }
      }
      if (!main) {
        chosen = descriptors.find(f => /^agent-.+\.jsonl$/i.test(f.name)) ??
          (descriptors.length === 1 ? selectFiles(descriptors).main : null);
        if (chosen) main = await read(chosen);
      }
    }
    if (!main) throw new Error('Choose a .jsonl or .json transcript file.');
    const selection = selectFiles(descriptors, main.meta.sessionId ?? main.meta.sourceName?.replace(/\.jsonl$/i, ''), chosen);
    const runs = [];
    for (const descriptor of selection.runs) {
      const value = await read(descriptor);
      if (value.meta.thread !== 'agent') continue;
      const id = /^agent-(.+)\.jsonl$/i.exec(descriptor.name)[1];
      const meta = descriptors.find(f => f.name === `agent-${id}.meta.json` &&
        (!descriptor.path || f.path === descriptor.path.replace(/\.jsonl$/i, '.meta.json')));
      let metadata;
      try { if (meta) metadata = JSON.parse(await meta.file.text()); }
      catch { /* Optional metadata does not hide a run. */ }
      runs.push(agentRun(value, descriptor.name, metadata));
    }
    if (cancelled) throw new DOMException('Cancelled', 'AbortError');
    return { session: runs.length ? attachAgents(main, runs) : main,
      skipped: selection.skipped, added: runs.length };
  })();
  return { promise, cancel() { cancelled = true; task?.cancel(); } };
}
