const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { browserProfile, userscript } = require('./paths.cjs');

(async () => {
  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chrome', headless: false, hasTouch: true, viewport: { width: 1280, height: 800 },
  });
  try {
    await context.addInitScript({ path: userscript });
    const page = context.pages()[0];
    await page.goto('https://www.douyin.com/jingxuan', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const nav = page.locator('a[href*="recommend=1"]').filter({ hasText: '推荐' }).first();
    await nav.waitFor({ state: 'visible', timeout: 16000 });
    const saveDialog = page.locator('.trust-login-dialog-button-cancel');
    if (await saveDialog.isVisible()) await saveDialog.click({ timeout: 2000 }).catch(() => {});
    await nav.click();
    await page.locator('[data-e2e="feed-item"] video, [data-e2e="feed-live"]').first().waitFor({ state: 'visible', timeout: 18000 });
    for (const locator of [saveDialog, page.getByText('我知道了', { exact: true }).first()]) {
      if (await locator.isVisible()) await locator.click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(550);

    const visible = () => page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-e2e="feed-item"]')) {
        const r = el.getBoundingClientRect();
        if (r.y > innerHeight / 2 || r.bottom <= innerHeight / 2) continue;
        const live = el.querySelector('[data-e2e="feed-live"]');
        const box = live?.getBoundingClientRect();
        return {
          top: r.y, live: Boolean(live),
          hasPrevious: el.previousElementSibling?.matches('[data-e2e="feed-item"]') ?? false,
          liveBox: box && { x: box.x, y: box.y, width: box.width, height: box.height },
          offset: el.parentElement.getBoundingClientRect().y,
          transform: el.parentElement.style.transform,
          rate: live?.querySelector('video')?.playbackRate,
        };
      }
      return null;
    });
    let current;
    let count = 0;
    for (; count < 48; count++) {
      current = await visible();
      if (current?.live) break;
      await page.evaluate(() => document.querySelector('[data-e2e="video-switch-next-arrow"]')?.click());
      await page.waitForTimeout(540);
    }
    assert.ok(current?.live, '本轮推荐未遇到直播卡片');
    console.log(`在推荐流第 ${count + 1} 次检查找到真实直播卡片`);
    const { liveBox, transform, rate } = current;
    const y = Math.round(liveBox.y + liveBox.height / 2);
    const x = Math.round(liveBox.x + liveBox.width / 2);
    const edge = Math.round(liveBox.x + liveBox.width * 0.13);
    const cdp = await context.newCDPSession(page);
    const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

    assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-e2e="live-slider"]')?.localName, [x, y]), 'a');
    await touch('touchStart', [{ x: edge, y, id: 1 }]);
    await page.waitForTimeout(430);
    assert.equal((await visible()).rate, rate);
    assert.equal(await page.getByText('2×', { exact: true }).count(), 0);
    await touch('touchCancel', []);
    console.log('直播预览两侧长按没有开启 2 倍速');

    async function slide(dy) {
      const origin = await visible();
      await touch('touchStart', [{ x, y, id: 1 }]);
      for (let step = 1; step <= 6; step++) {
        await touch('touchMove', [{ x, y: y + dy * step / 6, id: 1 }]);
      }
      await page.waitForTimeout(34);
      const moving = await visible();
      const expected = dy > 0 && !origin.hasPrevious ? dy * 0.24 : dy;
      assert.ok(Math.abs(moving.offset - origin.offset - expected) < 3, `实际偏移 ${moving.offset - origin.offset}`);
      assert.equal(moving.transform, origin.transform);
      await touch('touchEnd', []);
      await page.waitForTimeout(560);
      return visible();
    }

    const after = await slide(-165);
    assert.notEqual(after.transform, transform);
    assert.ok(Math.abs(after.top - current.top) < 3);
    const back = await slide(165);
    assert.equal(back.transform, transform);
    assert.equal(back.live, true);
    console.log('在真实直播预览上，卡片跟着手指滑动，松手切到下一条，下滑可回到直播卡片');
    const previous = await slide(165);
    if (back.hasPrevious) {
      assert.notEqual(previous.transform, transform);
      console.log('从真实直播卡片本身下滑也能回到上一条');
    } else {
      assert.equal(previous.transform, transform);
      console.log('首条是直播时下滑正确回弹');
    }
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
