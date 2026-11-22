const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { userscript } = require('./paths.cjs');

const origin = 'https://www.douyin.com';
const feed = origin + '/?recommend=1';

function silentAudio() {
  const rate = 8000;
  const pcmBytes = rate * 2 * 8;
  const audio = Buffer.alloc(44 + pcmBytes);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(rate, 24);
  audio.writeUInt32LE(rate * 2, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(pcmBytes, 40);
  return audio;
}

const markup = `<!doctype html><button id="interact">互动</button>
<main id="slidelist"><div data-e2e="feed-active-video"><div class="xgplayer">
<video id="active" autoplay muted loop></video>
</div></div><video id="preload" muted></video></main>
<script>
  const media = document.querySelector('#active');
  const play = media.play.bind(media);
  window.audioAttempts = [];
  media.play = function () {
    const attempt = { muted: this.muted, activation: navigator.userActivation.hasBeenActive };
    window.audioAttempts.push(attempt);
    return play().catch(error => {
      attempt.error = error.name;
      throw error;
    });
  };
  const start = () => { media.src = '/test-audio.wav'; };
  if (location.hash === '#deferred') {
    document.querySelector('#interact').addEventListener('click', start, { once: true });
  } else {
    start();
  }
</script>`;

async function waitForState(read, condition) {
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    const state = await read();
    if (condition(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('Unexpected audio state: ' + JSON.stringify(await read()));
}

async function withPage(browser, action) {
  const context = await browser.newContext({ hasTouch: true });
  try {
    await context.addInitScript({ path: userscript });
    await context.route(origin + '/**', route => route.request().url().endsWith('/test-audio.wav')
      ? route.fulfill({ contentType: 'audio/wav', body: silentAudio() })
      : route.fulfill({ contentType: 'text/html', body: markup }));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    async function evaluate(expression) {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
      assert.equal(exceptionDetails, undefined);
      return result.value;
    }
    const read = () => evaluate(`({
      muted: document.querySelector('#active').muted,
      preloadMuted: document.querySelector('#preload').muted,
      paused: document.querySelector('#active').paused,
      active: navigator.userActivation.hasBeenActive,
      currentTime: document.querySelector('#active').currentTime,
      attempts: window.audioAttempts
    })`);
    await action(page, read, evaluate);
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies'],
  });
  try {
    await withPage(browser, async (page, read, evaluate) => {
      await page.goto(feed);
      const initial = await waitForState(read, state => state.muted && !state.paused && state.currentTime > 0.5
        && state.attempts.some(attempt => attempt.error === 'NotAllowedError'));
      assert.equal(initial.active, false);
      assert.equal(initial.attempts.filter(attempt => !attempt.muted).length, 1);

      await page.locator('#interact').tap();
      const audible = await waitForState(read, state => !state.muted && !state.paused);
      assert.equal(audible.preloadMuted, true);
      assert.equal(audible.active, true);

      await evaluate("document.querySelector('#active').muted = true");
      const manual = await waitForState(read, state => state.currentTime > audible.currentTime + 0.5);
      assert.equal(manual.muted, true);
    });
    await withPage(browser, async (page, read) => {
      await page.goto(feed + '#deferred');
      await page.locator('#interact').tap();
      const audible = await waitForState(read, state => !state.muted && !state.paused);
      assert.equal(audible.preloadMuted, true);
      assert.equal(audible.attempts.some(attempt => attempt.error), false);
    });
    await withPage(browser, async (page, read) => {
      await page.goto(origin + '/jingxuan');
      const elsewhere = await waitForState(read, state => state.currentTime > 0.5);
      assert.equal(elsewhere.muted, true);
      assert.deepEqual(elsewhere.attempts, []);
    });
    console.log('开声成功、浏览器拦截后的恢复、手动静音和推荐页范围均通过');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
