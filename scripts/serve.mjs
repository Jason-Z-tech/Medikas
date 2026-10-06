// Kleiner lokaler Webserver für die Vorschau – nur Node-Bordmittel, keine Pakete.
// Aufruf: node scripts/serve.mjs   → http://localhost:8080
// (Per Doppelklick geöffnete Seiten laden in Chrome die Schriften nicht, weil file:// keine
//  Schriften nachladen darf. Über diesen Server sieht die Seite aus wie online.)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

export function startServer(port = 8080) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      // Nur Dateien innerhalb des Projektordners ausliefern.
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT) || /[\\/]\.(git|github)([\\/]|$)/.test(file)) throw new Error('verboten');
      if (!(await stat(file)).isFile()) throw new Error('keine Datei');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>Nicht gefunden</title><p>Nicht gefunden. <a href="/">Zum Medi-Lexikon</a></p>');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT) || 8080;
  await startServer(port);
  console.log(`Vorschau läuft: http://localhost:${port}  (beenden mit Strg+C)`);
}
