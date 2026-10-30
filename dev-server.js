// Local dev server: serves /public and runs /api/chat, no extra packages needed.
//   ANTHROPIC_API_KEY=sk-ant-... node dev-server.js
// Then open http://localhost:3000 (see README for testing on your phone).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import chat from './api/chat.js';

const PORT = process.env.PORT || 3000;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8',
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/api/chat') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      req.body = raw;
      return chat(req, res);
    }

    const path = normalize(join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!path.startsWith(ROOT)) {
      res.statusCode = 403;
      return res.end();
    }
    try {
      const data = await readFile(path);
      res.setHeader('Content-Type', TYPES[extname(path)] || 'application/octet-stream');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  })
  .listen(PORT, () => console.log(`AR Buddy running at http://localhost:${PORT}`));
