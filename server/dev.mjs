import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHandler } from './handler.mjs';

const root = new URL('../public/', import.meta.url), handler = createHandler();
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return handler(req, res);
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  try { res.setHeader('Content-Type', `${file[1]}; charset=utf-8`); res.end(await readFile(fileURLToPath(new URL(file[0], root)))); }
  catch { res.writeHead(500); res.end('Could not load app'); }
});
server.listen(Number(process.env.PORT || 4310), '127.0.0.1', () => {
  console.log(`YOLO duty calendar: http://127.0.0.1:${server.address().port}`);
});
