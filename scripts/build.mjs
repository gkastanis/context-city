import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compactSession } from '../src/ui/compact.js';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');
const moduleId = (from, target) => path.posix.normalize(path.posix.join(path.posix.dirname(from), target));

// Split declaration lists only at the outer level. Initializers can contain
// commas, strings, templates, object literals, comments and nested expressions.
function declarations(source) {
  let depth = 0, quote = '', comment = '', start = 0;
  const parts = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      if (comment === 'block' && c === '*' && next === '/') { comment = ''; i++; }
      continue;
    }
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (depth === 0 && (c === ',' || c === ';')) {
      parts.push(source.slice(start, i)); start = i + 1;
      if (c === ';') return parts;
    }
  }
  throw new Error('Export declaration needs a terminating semicolon');
}

// Modules keep their own scopes and are evaluated on demand. In particular,
// three.js is imported only when the app reaches its guarded scene import.
export async function bundle(entry, replacements = new Map(), readModule = read) {
  const asynchronous = entry !== 'src/worker.js';
  const modules = new Map(), visiting = new Set(), exported = new Map();
  async function visit(id) {
    if (modules.has(id)) return;
    if (visiting.has(id)) throw new Error(`Circular import at ${id}`);
    visiting.add(id);
    let source = replacements.get(id) ?? await readModule(id);
    const dependencies = [], imports = [], names = new Map();
    let asyncModule = asynchronous;
    const bind = (bindings, dependency) => {
      if (bindings.startsWith('* as ')) return `const ${bindings.slice(5)} = ${asynchronous ? 'await ' : ''}__load(${JSON.stringify(dependency)});`;
      if (!bindings.startsWith('{')) throw new Error(`Unsupported bindings ${bindings}`);
      const fields = bindings.slice(1, -1).split(',').map(n => n.trim()).filter(Boolean).map(n => {
        const [original, alias] = n.split(/\s+as\s+/);
        imports.push({ dependency, name: original });
        return alias ? `${original}: ${alias}` : original;
      });
      return `const { ${fields.join(', ')} } = ${asynchronous ? 'await ' : ''}__load(${JSON.stringify(dependency)});`;
    };
    source = source.replace(/^export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm, (_, list, target) => {
      const dependency = moduleId(id, target); dependencies.push(dependency);
      for (const field of list.split(',')) {
        const [original, alias] = field.trim().split(/\s+as\s+/);
        if (original) names.set(alias ?? original, alias ?? original);
      }
      return bind(`{${list}}`, dependency);
    });
    source = source.replace(/^import\s+(.+?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, bindings, target) => {
      if (/^https:\/\//.test(target)) {
        if (!target.startsWith('https://cdn.jsdelivr.net/npm/three@0.160.0/')) throw new Error(`Unexpected external import ${target}`);
        asyncModule = true;
        const value = bindings.startsWith('* as ') ? bindings.slice(5) : bindings.replace(/\bas\b/g, ':');
        return `const ${value} = await import(${JSON.stringify(target)});`;
      }
      if (!target.startsWith('.')) throw new Error(`Unsupported import ${target}`);
      const dependency = moduleId(id, target); dependencies.push(dependency);
      return bind(bindings, dependency);
    });
    source = source.replace(/import\(['"]([^'"]+)['"]\)/g, (statement, target) => {
      if (target.startsWith('https://')) return statement;
      if (!target.startsWith('.')) throw new Error(`Unsupported dynamic import ${target}`);
      const dependency = moduleId(id, target); dependencies.push(dependency);
      return `Promise.resolve().then(() => __load(${JSON.stringify(dependency)}))`;
    });
    for (const dependency of dependencies) await visit(dependency);
    source = source.replace(/^export\s+(const|let|var)\s+/gm, (statement, kind, offset, full) => {
      for (const part of declarations(full.slice(offset + statement.length))) {
        const name = part.trim().match(/^([A-Za-z_$][\w$]*)\s*(?:=|$)/)?.[1];
        if (!name) throw new Error(`Unsupported exported declaration in ${id}`);
        names.set(name, name);
      }
      return `${kind} `;
    });
    source = source.replace(/^export\s+((?:async\s+)?function|class)\s+([\w$]+)/gm, (_, kind, name) => {
      names.set(name, name); return `${kind} ${name}`;
    });
    source = source.replace(/^export\s*\{([^}]+)\};?\s*$/gm, (_, list) => {
      for (const field of list.split(',').map(n => n.trim()).filter(Boolean)) {
        const [original, alias] = field.split(/\s+as\s+/); names.set(alias ?? original, original);
      }
      return '';
    });
    if (/^\s*(?:import\s|export\s)/m.test(source)) throw new Error(`Unresolved module syntax in ${id}`);
    for (const { dependency, name } of imports) {
      if (!exported.get(dependency)?.has(name)) throw new Error(`${id} imports ${name}, not exported by ${dependency}`);
    }
    exported.set(id, names);
    const result = [...names].map(([alias, original]) => `${alias}: ${original}`).join(', ');
    modules.set(id, `__factories[${JSON.stringify(id)}] = ${asyncModule ? 'async ' : ''}() => {\n${source}\nreturn { ${result} };\n};`);
    visiting.delete(id);
  }
  await visit(entry);
  return `const __modules = Object.create(null), __factories = Object.create(null);
function __load(id) { return __modules[id] ??= __factories[id](); }
${[...modules.values()].join('\n')}
await __load(${JSON.stringify(entry)});`;
}

export async function build({ sample = null, pages = false } = {}) {
  // Worker code has no top-level await: classic Blob workers cannot parse it.
  const worker = (await bundle('src/worker.js')).replace(/await __load\("src\/worker.js"\);$/, () => '__load("src/worker.js");');
  if (/await import\(/.test(worker)) throw new Error('Worker must have no external imports');
  sample ??= await read('sample/fresh-session.json');
  const rawExamples = [sample, await read('sample/real-session-redacted.json'), await read('sample/agents-session.json')];
  const examples = rawExamples.map(raw => {
    const value = JSON.parse(raw);
    const wire = value.blocks && value.requests ? compactSession(value) : value;
    return JSON.stringify(wire, (_, field) => field instanceof Int32Array ? Array.from(field) : field);
  });
  const replacements = new Map([
    ['src/ui/loader.js', (await read('src/ui/loader.js')).replace('null; /* WORKER_SOURCE */', () => `${JSON.stringify(worker)}; /* WORKER_SOURCE */`)],
    ['src/app.js', (await read('src/app.js')).replace('null; /* SAMPLE_DATA */', () => `${JSON.stringify(examples)}; /* SAMPLE_DATA */`)],
  ]);
  const javascript = await bundle('src/app.js', replacements);
  const asciiJS = javascript.replace(/[^\x00-\x7f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/<\/script/gi, match => '<\\/' + match.slice(2)).replace(/<!--/g, () => '<\\!--')
    .replace(/<script/gi, match => '\\u003c' + match.slice(1));
  const css = (await read('src/ui/app.css')).replace(/[^\x00-\x7f]/g, c => `\\${c.charCodeAt(0).toString(16)} `);
  const fallback = 'Loading the 3D view. If this stays, your network blocks cdn.jsdelivr.net, which serves the 3D library.';
  const fragment = `<title>Context City</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>\n${css}\n</style>\n<link rel="icon" href="data:,">\n<div id="app"><p>${fallback}</p></div>\n<script type="module">\n${asciiJS}\n</script>\n`;
  const output = pages ? `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${fragment.slice(0, fragment.indexOf('<div id="app">'))}</head><body>${fragment.slice(fragment.indexOf('<div id="app">'))}</body></html>\n` : fragment;
  if (/(?:from\s*|import\s*\()(['"])\.{1,2}\//.test(output)) throw new Error('Relative import remains');
  if (/innerHTML\s*=/.test(output)) throw new Error('Unsafe HTML assignment');
  if (javascript.includes('\u2014')) throw new Error('Em dash in artifact');
  if (/[^\x00-\x7f]/.test(output)) throw new Error('Artifact must be pure ASCII');
  if (asciiJS.includes('<!--')) throw new Error('Unescaped HTML comment in script');
  if (/<\/?(?:html|head|body)(?:\s|>)/i.test(fragment)) throw new Error('Artifact contains document wrapper tags');
  const size = Buffer.byteLength(output);
  if (size > 3 * 1024 * 1024) throw new Error(`Artifact exceeds 3 MB (${size} bytes)`);
  const directory = pages ? 'site' : 'dist';
  await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, directory, 'index.html'), output);
  return { output, size, exampleSizes: rawExamples.map((raw, i) => ({ before: Buffer.byteLength(raw), after: Buffer.byteLength(examples[i]) })) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pages = process.argv.includes('--pages');
  const { size, exampleSizes } = await build({ pages });
  console.log(`${pages ? 'site' : 'dist'}/index.html: ${size} bytes (ASCII)`);
  console.log(JSON.stringify({ exampleSizes }));
}
