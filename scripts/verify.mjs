// Static-site checks for savethelife.io. No dependencies — runs on a bare Node.
// Usage: node scripts/verify.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (file, msg) => problems.push(`${file}: ${msg}`);

const PAGES = [
  'index.html',
  ...readdirSync(join(ROOT, 'products')).filter(f => f.endsWith('.html')).map(f => `products/${f}`),
  ...readdirSync(join(ROOT, 'apps')).filter(f => f.endsWith('.html')).map(f => `apps/${f}`),
];

const LOCALES = ['ko', 'zh', 'ja', 'es', 'ru', 'vi'];
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

// ---------------------------------------------------------------- i18n packs
// Each pack is a plain script that assigns to window and then runs an applier
// that touches browser globals; stub just enough to evaluate it.
function loadPack(file, globalName) {
  const sandbox = {
    window: {},
    WeakMap,
    URLSearchParams,
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { search: '' },
    document: {
      documentElement: { getAttribute: () => '', lang: 'en' },
      querySelectorAll: () => [],
      querySelector: () => null,
      title: '',
    },
  };
  const src = readFileSync(join(ROOT, file), 'utf8');
  const fn = new Function(...Object.keys(sandbox), `${src}\nreturn window[${JSON.stringify(globalName)}];`);
  return fn(...Object.values(sandbox));
}

let packs;
try {
  packs = {
    index: { data: loadPack('i18n.js', 'SL_I18N'), read: p => p.translations },
    products: { data: loadPack('products/products-i18n.js', 'SL_PRODUCTS_I18N'), read: p => p.t },
    apps: { data: loadPack('apps/apps-i18n.js', 'SL_APPS_I18N'), read: p => p.t },
  };
} catch (e) {
  fail('i18n', `a translation pack failed to evaluate: ${e.message}`);
  packs = null;
}

const packFor = page =>
  page === 'index.html' ? packs?.index
  : page.startsWith('products/') ? packs?.products
  : packs?.apps;

// ------------------------------------------------------------------- checks
for (const page of PAGES) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const dir = dirname(join(ROOT, page));

  // 1. tag balance
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const [, closing, tag, selfClose] = m;
    const t = tag.toLowerCase();
    if (VOID.has(t) || selfClose) continue;
    if (!closing) stack.push(t);
    else if (stack.length && stack[stack.length - 1] === t) stack.pop();
    else {
      const i = stack.lastIndexOf(t);
      if (i === -1) {
        fail(page, `stray </${t}>`);
      } else {
        // </t> closed while inner tags are still open — report them, then resync.
        fail(page, `</${t}> closes with ${stack.slice(i + 1).join(', ')} still unclosed`);
        stack.length = i;
      }
    }
  }
  if (stack.length) fail(page, `unclosed tags: ${stack.slice(-5).join(', ')}`);

  // 2. local references resolve (root-absolute resolve from the repo root)
  for (const ref of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = ref[1];
    if (/^(https?:|mailto:|data:|#|\/\/)/.test(url)) continue;
    if (url.startsWith('/_vercel/')) continue;           // injected by Vercel at runtime
    const clean = url.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = clean.startsWith('/') ? join(ROOT, clean) : join(dir, clean);
    if (!existsSync(target)) fail(page, `broken reference -> ${url}`);
  }

  // 3. every JSON-LD block parses
  for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(b[1]); } catch (e) { fail(page, `invalid JSON-LD: ${e.message}`); }
  }

  // 4. analytics tag present
  if (!html.includes('/_vercel/insights/script.js')) fail(page, 'missing Vercel Analytics script');

  // 5. i18n coverage — this is the one that breaks silently in production
  const pack = packFor(page);
  if (pack?.data) {
    const keys = [...new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map(x => x[1]))];
    if (keys.length === 0) fail(page, 'no data-i18n keys — page would never translate');
    for (const loc of LOCALES) {
      const p = pack.data[loc];
      if (!p) { fail(page, `pack has no locale "${loc}"`); continue; }
      const table = pack.read(p) ?? {};
      const missing = keys.filter(k => table[k] == null);
      if (missing.length) fail(page, `${loc} missing ${missing.length} key(s): ${missing.slice(0, 5).join(', ')}`);
    }
  }
}

// 6. translations must not break the HTML they carry
if (packs) {
  for (const [name, { data, read }] of Object.entries(packs)) {
    for (const loc of Object.keys(data)) {
      for (const [k, v] of Object.entries(read(data[loc]) ?? {})) {
        const s = String(v);
        const open = (s.match(/<(b|a|span)\b/g) || []).length;
        const close = (s.match(/<\/(b|a|span)>/g) || []).length;
        if (open !== close) fail(`${name} i18n`, `${loc}/${k}: unbalanced inline tags (${open} open, ${close} close)`);
      }
    }
  }
}

// 7. sitemap is well-formed and only lists pages that exist
const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
for (const loc of sitemap.matchAll(/<loc>https:\/\/www\.savethelife\.io\/([^<]*)<\/loc>/g)) {
  const path = loc[1];
  if (!path || path.endsWith('.pdf')) continue;
  if (!existsSync(join(ROOT, `${path}.html`)) && !existsSync(join(ROOT, path))) {
    fail('sitemap.xml', `lists a URL with no matching file: /${path}`);
  }
}

// -------------------------------------------------------------------- report
console.log(`checked ${PAGES.length} pages\n`);
if (problems.length) {
  console.error(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('PASS — markup, references, JSON-LD, analytics, i18n coverage and sitemap all OK');
