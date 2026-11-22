const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { debugUserscript, diagnosticConfig, userscript } = require('./paths.cjs');

let script = fs.readFileSync(userscript, 'utf8').replace(/\r\n/g, '\n');

function replace(anchor, replacement) {
  if (script.split(anchor).length !== 2) throw new Error('Expected one match for ' + anchor);
  script = script.replace(anchor, () => replacement);
}

function instrument(anchor, statement) {
  replace(anchor, statement + '\n' + anchor);
}

const [, versionLine, version] = script.match(/^(\/\/ @version[ \t]+(\S+))$/m);
const [name] = script.match(/^\/\/ @name[ \t]+.+$/m);
const [namespace] = script.match(/^\/\/ @namespace[ \t]+\S+$/m);
const [description] = script.match(/^\/\/ @description[ \t]+.+$/m);
replace(name, name + '（本机诊断）');
replace(namespace, namespace + '.diagnostics');
replace(versionLine, versionLine + '.1');
replace('// @grant        none', '// @grant        GM_xmlhttpRequest\n// @connect      127.0.0.1');
replace(description, '// @description  v' + version + ' 诊断版，诊断数据仅发送到本机 127.0.0.1。');

if (!fs.existsSync(diagnosticConfig)) {
  fs.writeFileSync(diagnosticConfig, JSON.stringify({ port: 17846, token: randomBytes(20).toString('hex') }));
}
const { port, token } = JSON.parse(fs.readFileSync(diagnosticConfig, 'utf8'));
const client = fs.readFileSync(path.join(__dirname, 'douyin-diagnostics-client.js'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace('__DIAG_BUILD__', JSON.stringify(version))
  .replace('__DIAG_URL__', JSON.stringify('http://127.0.0.1:' + port + '/touch/' + token));
replace('  let waitingTrack = null;', '  let waitingTrack = null;\n\n' + client);

instrument('    if (!arrow) return { run: keyboard };',
  "    diagnostic.record('switch-control', { next, button: Boolean(arrow), disabled: Boolean(arrow?.matches(':disabled, .disabled, [aria-disabled=\"true\"]')) });");
instrument('      // 独立的 translate', "      diagnostic.record('preview-start', { dy, offset: swipe.offset, hasNeighbor });");
replace('  function finishSwipe(swipe, action) {',
  "  function finishSwipe(swipe, action) {\n    diagnostic.record('finish', { action: Boolean(action), preview: Boolean(swipe.preview), offset: Math.round(swipe.offset) });");
instrument('      clearTimeout(timeout);', "      diagnostic.record('native-transform-changed');");
replace('    function finishWaiting() {',
  "    function finishWaiting() {\n      diagnostic.record('native-transform-timeout');");
const invalidLayout = "    if (!list || list === track || (!fullscreen && list.getAttribute('data-active') === 'false'))";
replace(invalidLayout + ' return;',
  invalidLayout + " {\n      diagnostic.record('gesture-rejected-layout', { card: Boolean(card), list: Boolean(list), same: list === track });\n      return;\n    }");
const movingTrack = "    if (track === waitingTrack || track.getAnimations().some((animation) =>\n      animation.id === MOTION_ID || animation.transitionProperty === 'transform'))";
replace(movingTrack + ' return;',
  movingTrack + " {\n      diagnostic.record('gesture-rejected-animation', { waiting: track === waitingTrack });\n      return;\n    }");
replace('    gesture = swipe;\n    if (swipe.multitouch || fromPanel) return;',
  "    gesture = swipe;\n    diagnostic.record('gesture-start', { fromPanel, index, count: slides.length, next: swipe.hasNext, previous: swipe.hasPrevious });\n    if (swipe.multitouch || fromPanel) return;");
const invalidMove = '    if (event.touches.length !== 1 || touch.identifier !== swipe.id || nativeAlreadySwitched(swipe)) {';
replace(invalidMove, invalidMove
  + "\n      diagnostic.record('move-rejected', { contacts: event.touches.length, sameId: touch?.identifier === swipe.id, transformChanged: swipe.track.style.transform !== swipe.nativeTransform });");
instrument('    swipe.axis = axis;\n    consume(event);',
  "    if (!swipe.axis) diagnostic.record('axis-locked', { axis, dx: Math.round(dx), dy: Math.round(dy), cancelable: event.cancelable });");
const touchEnd = '    const swipe = gesture;\n    if (!swipe) return;\n    if (swipe.multitouch) {\n      if (!event.touches.length)';
replace(touchEnd, touchEnd.replace('    if (!swipe) return;',
  "    diagnostic.record('end-handler', { tracked: Boolean(swipe) });\n    if (!swipe) return;"));
replace('      && !nativeAlreadySwitched(swipe);\n    if (horizontal)',
  "      && !nativeAlreadySwitched(swipe);\n    diagnostic.record('end-decision', { axis, dx: Math.round(dx), dy: Math.round(dy), shouldSwitch, canSwitch, connected: swipe.card.isConnected, nativePositionChanged: swipe.track.style.transform !== swipe.nativeTransform });\n    if (horizontal)");

fs.writeFileSync(debugUserscript, script);
console.log(debugUserscript);
