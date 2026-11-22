const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { browserProfile, userscript } = require('./paths.cjs');

const active = '[data-e2e="feed-active-video"]';
const width = Number(process.env.DOUYIN_WIDTH || 1280);

(async () => {
  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chrome', headless: false, hasTouch: true, viewport: { width, height: 800 },
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
    await page.locator(`${active} [data-e2e="feed-comment-icon"]`).first().waitFor({ state: 'visible', timeout: 16000 });
    for (const locator of [saveDialog, page.getByText('我知道了', { exact: true }).first()]) {
      if (await locator.isVisible()) await locator.click({ timeout: 2000 }).catch(() => {});
    }
    await page.locator('#douyin-touch-sidebar-toggle[aria-expanded="false"]').waitFor();

    const cdp = await context.newCDPSession(page);
    const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    async function slide(x, y, dx, dy) {
      await touch('touchStart', [{ x, y, id: 1 }]);
      for (let step = 1; step <= 8; step++) {
        await touch('touchMove', [{ x: x + dx * step / 8, y: y + dy * step / 8, id: 1 }]);
      }
      await touch('touchEnd', []);
    }
    const media = page.locator(`${active} .xgplayer video`).first();
    const pane = page.locator(`${active} #relatedVideoCard`);
    const commentTab = pane.locator('#semiTabcomment');
    const comments = pane.locator('[data-e2e="comment-list"]');
    const current = () => page.locator(active).first().getAttribute('data-e2e-vid');
    const waitLayout = () => page.waitForTimeout(330);
    async function videoSwipe(dx, dy = 0) {
      const box = await media.boundingBox();
      assert.ok(box);
      await slide(Math.round(box.x + box.width * .5), Math.round(box.y + box.height * .47), dx, dy);
    }
    async function expectOpen() {
      await pane.waitFor({ state: 'visible', timeout: 5000 });
      await pane.locator('#semiTabcomment[aria-selected="true"]').waitFor({ state: 'visible', timeout: 5000 });
      await waitLayout();
    }
    async function expectClosed() {
      await pane.waitFor({ state: 'hidden', timeout: 5000 });
      await waitLayout();
    }

    await expectClosed();
    const first = await current();
    await videoSwipe(145);
    await expectClosed();
    await videoSwipe(-32);
    await expectClosed();
    await videoSwipe(-145, 5);
    await expectOpen();
    assert.equal(await current(), first);
    await videoSwipe(-145);
    await expectOpen();
    assert.equal(await current(), first);
    console.log(`${width}px: 左滑打开评论，重复左滑继续显示；空面板时右滑和短划都不打开评论`);

    const authorTab = pane.locator('#semiTabauthor_card');
    if (await authorTab.isVisible()) {
      await authorTab.click();
      assert.equal(await commentTab.getAttribute('aria-selected'), 'false');
      await videoSwipe(-145);
      await expectOpen();
      console.log('从其他侧栏标签左滑直接切到评论');
    }

    await videoSwipe(145, -3);
    await expectClosed();
    await videoSwipe(145);
    await expectClosed();
    assert.equal(await current(), first);
    console.log('从视频画面右滑关闭，重复右滑不会重开');

    for (let index = 0; index < 5; index++) {
      await videoSwipe(-145);
      await expectOpen();
      try {
        await comments.waitFor({ state: 'visible', timeout: 2500 });
        const scrollable = await comments.evaluate(el => el.scrollHeight > el.clientHeight + 120);
        if (scrollable) break;
      } catch {}
      await videoSwipe(145);
      await expectClosed();
      await videoSwipe(0, -170);
      await page.waitForTimeout(450);
    }
    const listBox = await comments.boundingBox();
    assert.ok(listBox);
    const id = await current();
    const startX = Math.round(listBox.x + 110);
    const startY = Math.round(listBox.y + listBox.height * .62);
    await page.evaluate(() => {
      window.touchLog = [];
      for (const type of ['touchstart','touchmove','touchend','touchcancel','pointercancel']) {
        window.addEventListener(type, e => setTimeout(()=>window.touchLog.push([type,e.cancelable,e.defaultPrevented, e.target.localName, e.changedTouches?.[0]?.clientX]),0), {capture:true, passive: true});
      }
    });
    await slide(startX, startY, 0, -175);
    await page.waitForFunction(selector => document.querySelector(selector)?.scrollTop > 25, `${active} [data-e2e="comment-list"]`, { timeout: 3500 }).catch(async error => {
      console.log('侧栏滚动情况', await comments.evaluate(el=>[el.scrollTop,el.scrollHeight,el.clientHeight,window.touchLog]));
      throw error;
    });
    assert.equal(await current(), id);
    assert.ok(await pane.isVisible());
    console.log('评论列表上下滑仍可滚动，当前视频保持不变');
    await page.waitForTimeout(520);

    const closePoint = await comments.evaluate(list => {
      const rect = list.getBoundingClientRect();
      for (const dx of [130, 110, 85]) for (const dy of [.4, .57, .72]) {
        const x = Math.round(rect.x + dx);
        const y = Math.round(rect.y + rect.height * dy);
        const target = document.elementFromPoint(x, y);
        if (list.contains(target) && !target.closest('a[href],button,input,[role="button"],[contenteditable="true"]')) return [x, y];
      }
      return null;
    });
    assert.ok(closePoint, '测试触点需要落在评论列表的普通区域');
    await page.evaluate(() => { window.touchLog = []; });
    await slide(...closePoint, 140, 4);
    await expectClosed().catch(async error => { console.log('侧栏横滑事件', await page.evaluate(() => window.touchLog)); throw error; });
    assert.equal(await current(), id);
    console.log('从评论列表内右滑也可以关掉面板');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
