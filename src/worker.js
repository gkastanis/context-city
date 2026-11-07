import { createParser } from './parse.js';
import { compactSession } from './ui/compact.js';

// Keep fragments instead of repeatedly copying a multi-megabyte unfinished line.
export function createLineSplitter(push) {
  let fragments = [];
  return {
    write(chunk) {
      let start = 0, end;
      while ((end = chunk.indexOf('\n', start)) !== -1) {
        fragments.push(chunk.slice(start, end));
        let line = fragments.join('');
        if (line.endsWith('\r')) line = line.slice(0, -1);
        push(line); fragments = []; start = end + 1;
      }
      if (start < chunk.length) fragments.push(chunk.slice(start));
    },
    finish() {
      if (fragments.length) {
        let line = fragments.join('');
        if (line.endsWith('\r')) line = line.slice(0, -1);
        push(line);
      }
      fragments = [];
    },
  };
}

export async function consumeFile(file, { progress = () => {}, signal, yieldWork = false } = {}) {
  const parser = createParser({ sourceName: file.name });
  const lines = createLineSplitter(line => parser.push(line));
  let bytes = 0, lastProgress = -Infinity, lastYield = performance.now();
  const counted = file.stream().pipeThrough(new TransformStream({
    transform(chunk, controller) { bytes += chunk.byteLength; controller.enqueue(chunk); },
  })).pipeThrough(new TextDecoderStream());
  const reader = counted.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      lines.write(value);
      const now = performance.now();
      if (now - lastProgress >= 100) { progress(bytes, file.size); lastProgress = now; }
      if (yieldWork && now - lastYield >= 8) {
        await new Promise(resolve => setTimeout(resolve, 0)); lastYield = performance.now();
      }
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    lines.finish();
    // Yield before the parser's synchronous final reconciliation as well.
    if (yieldWork) await new Promise(resolve => setTimeout(resolve, 0));
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return parser.finish();
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = async ({ data: file }) => {
    try {
      const session = await consumeFile(file, {
        progress: (bytes, total) => postMessage({ type: 'progress', bytes, total }),
      });
      const wire = compactSession(session);
      postMessage({ type: 'session', session: wire }, [wire.tape.buffer, wire.offsets.buffer]);
      close();
    } catch (error) { postMessage({ type: 'error', message: error.message }); close(); }
  };
}
