const fs = require('node:fs');
const http = require('node:http');
const { diagnosticConfig, diagnosticLog } = require('./paths.cjs');

const config = JSON.parse(fs.readFileSync(diagnosticConfig, 'utf8'));
const endpoint = `/touch/${config.token}`;
const maxBytes = 24000;

function reply(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(message);
}

const server = http.createServer((request, response) => {
  if (request.headers.host !== `127.0.0.1:${config.port}`) return reply(response, 403, 'Forbidden');
  if (request.method === 'GET' && request.url === '/health') return reply(response, 200, 'Douyin touch diagnostics ready');
  if (request.method !== 'POST' || request.url !== endpoint || !/^application\/json\b/i.test(request.headers['content-type'] ?? '')) {
    return reply(response, 404, 'Not found');
  }

  let bytes = 0;
  const body = [];
  request.on('error', () => {});
  request.on('data', chunk => {
    bytes += chunk.length;
    if (bytes <= maxBytes) body.push(chunk);
  });
  request.on('end', () => {
    if (bytes > maxBytes) return reply(response, 413, 'Too large');
    let report;
    try { report = JSON.parse(Buffer.concat(body).toString('utf8')); }
    catch { return reply(response, 400, 'Invalid JSON'); }
    if (!report || !['ready', 'gesture'].includes(report.kind) || !['browser', 'test'].includes(report.source)
      || typeof report.session !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(report.session)
      || (report.kind === 'gesture' && (!Number.isInteger(report.number) || !Array.isArray(report.steps) || report.steps.length > 100))) {
      return reply(response, 400, 'Invalid report');
    }
    fs.appendFileSync(diagnosticLog, JSON.stringify({ received: new Date().toISOString(), ...report }) + '\n');
    console.log(`${report.source} ${report.kind}${report.number ? ` ${report.number}` : ''}`);
    return reply(response, 204, '');
  });
});

server.listen(config.port, '127.0.0.1', () => console.log(`Listening on 127.0.0.1:${config.port}`));
