import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [relative(root, p).split('\\').join('/')];
});

test('le service worker met en cache tous les fichiers de l\'application (et seulement des fichiers existants)', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]));
  const onDisk = ['css', 'js', 'vendor', 'assets'].flatMap((d) => walk(join(root, d))).filter((f) => !/LICENSE/.test(f));
  for (const f of [...onDisk, 'index.html', 'manifest.webmanifest']) assert.ok(listed.has(f), `absent du précache : ${f}`);
  for (const f of listed) assert.ok(statSync(join(root, f)).isFile(), `fichier inexistant dans le précache : ${f}`);
});

test('manifest : champs requis pour l\'installation', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.lang, 'fr');
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512') && m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(statSync(join(root, i.src)).isFile(), i.src);
});
