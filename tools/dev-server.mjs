// 本機開發用的靜態伺服器。零相依，node 直接跑。
// 用法：node tools/dev-server.mjs [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';

    // 防止 ../ 跳出專案目錄
    const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    const s = await stat(full).catch(() => null);
    if (!s?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
      return;
    }

    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(err));
  }
}).listen(PORT, () => {
  console.log(`site-log dev server: http://localhost:${PORT}`);
});
