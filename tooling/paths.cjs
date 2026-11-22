const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const local = path.join(root, '.local');
const artifacts = path.join(local, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });

module.exports = {
  artifacts,
  browserProfile: path.join(local, 'douyin-test-profile'),
  userscript: path.join(root, 'douyin-touch-swipe.user.js'),
  debugUserscript: path.join(local, 'douyin-touch-swipe.debug.user.js'),
  diagnosticConfig: path.join(local, 'douyin-diagnostics-config.json'),
  diagnosticLog: path.join(local, 'douyin-diagnostics.ndjson'),
};
