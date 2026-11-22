const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const local = path.join(root, '.local');
const artifacts = path.join(local, 'artifacts');
const userscript = path.join(root, 'douyin-touch-swipe.user.js');
fs.mkdirSync(artifacts, { recursive: true });

function loadTestScript(filename = userscript) {
  return "try { localStorage.setItem('douyin-touch-guide-v1', 'seen'); } catch {}\n"
    + fs.readFileSync(filename, 'utf8');
}

module.exports = {
  artifacts,
  browserProfile: path.join(local, 'douyin-test-profile'),
  userscript,
  loadTestScript,
  debugUserscript: path.join(local, 'douyin-touch-swipe.debug.user.js'),
  diagnosticConfig: path.join(local, 'douyin-diagnostics-config.json'),
  diagnosticLog: path.join(local, 'douyin-diagnostics.ndjson'),
};
