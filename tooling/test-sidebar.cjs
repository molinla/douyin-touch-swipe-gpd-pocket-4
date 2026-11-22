const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { artifacts, browserProfile, loadTestScript } = require('./paths.cjs');

(async () => {
  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chrome', headless: false, hasTouch: true, viewport: { width: 1280, height: 800 },
  });
  try {
    await context.addInitScript({ content: loadTestScript() });
    const page = context.pages()[0];
    const url = 'https://www.douyin.com/jingxuan';
    const toggle = page.locator('#douyin-touch-sidebar-toggle');
    const recommend = page.locator('a[href*="recommend=1"]').filter({ hasText: '推荐' }).first();
    const dismiss = async () => {
      for (const popup of [page.locator('.trust-login-dialog-button-cancel'), page.getByText('我知道了', { exact: true }).first()]) {
        if (await popup.isVisible()) await popup.click({ timeout: 2000 }).catch(() => {});
      }
    };
    const enter = async () => {
      try {
        await toggle.waitFor({ state: 'visible', timeout: 6000 });
      } catch {
        await dismiss();
        await recommend.click({ timeout: 7000 });
        await toggle.waitFor({ state: 'visible', timeout: 8000 });
      }
      await page.locator('[data-e2e="feed-active-video"], [data-e2e="feed-live"]').first().waitFor({ state: 'visible', timeout: 14000 });
      await dismiss();
    };
    const layout = () => page.evaluate(() => {
      const nav = document.querySelector('#douyin-navigation');
      const sidebar = nav.querySelector('[data-e2e="douyin-navigation"]');
      const button = document.querySelector('#douyin-touch-sidebar-toggle');
      const get = selector => document.querySelector(selector)?.getBoundingClientRect();
      const controls = button.getBoundingClientRect();
      const content = get('#douyin-right-container');
      const header = get('#douyin-header');
      const slides = get('#slidelist');
      const search = get('[data-e2e="searchbar-button"]');
      const covering = [];
      for (let el = document.elementFromPoint(controls.x + controls.width / 2, controls.y + controls.height / 2); el && el !== button && covering.length < 6; el = el.parentElement) covering.push([el.id, el.getAttribute('class'), getComputedStyle(el).zIndex, getComputedStyle(el).position]);
      return {
        nav: nav.getBoundingClientRect().width, bar: getComputedStyle(sidebar).visibility,
        body: [content.x, content.right], header: [header.x, header.right], slides: [slides.x, slides.right],
        button: [controls.x, controls.y, controls.width, controls.height],
        buttonReceivesTap: document.elementFromPoint(controls.x + controls.width / 2, controls.y + controls.height / 2) === button,
        search: search.x, scrollWidth: document.documentElement.scrollWidth, covering,
      };
    });

    async function assertLayout(collapsed, width, expandedWidth) {
      const navWidth = collapsed ? 52 : expandedWidth;
      await page.waitForFunction(expected => {
        const aligned = ['#douyin-right-container','#douyin-header','#slidelist'].every(selector => document.querySelector(selector)?.getBoundingClientRect().x === expected);
        return aligned && Boolean(document.querySelector('[data-e2e="searchbar-button"]'));
      }, navWidth, { timeout: 6000 }).catch(async error => { console.error('路径', page.url(), '状态', width, collapsed, '展开', await toggle.getAttribute('aria-expanded'), await layout().catch(() => null)); throw error; });
      const actual = await layout();
      console.log(width, collapsed ? 'collapsed' : 'expanded', actual);
      assert.equal(await toggle.getAttribute('aria-expanded'), String(!collapsed));
      assert.equal(actual.nav, navWidth);
      assert.equal(actual.bar, collapsed ? 'hidden' : 'visible');
      assert.deepEqual(actual.body, [navWidth, width]);
      assert.deepEqual(actual.header, [navWidth, width]);
      assert.deepEqual(actual.slides, [navWidth, width]);
      assert.deepEqual(actual.button, [collapsed ? 4 : navWidth + 4, 6, 44, 44]);
      assert.ok(actual.buttonReceivesTap);
      assert.ok(actual.button[0] + actual.button[2] < actual.search);
      assert.equal(actual.scrollWidth, width);
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismiss();
    await recommend.click();
    await enter();
    await assertLayout(true, 1280, 160);
    await page.screenshot({ path: path.join(artifacts, 'sidebar-collapsed.png') });
    await toggle.tap();
    await assertLayout(false, 1280, 160);
    await page.screenshot({ path: path.join(artifacts, 'sidebar-expanded.png') });
    await toggle.press('Enter');
    await assertLayout(true, 1280, 160);

    await page.setViewportSize({ width: 900, height: 760 });
    await assertLayout(true, 900, 72);
    await toggle.tap();
    await assertLayout(false, 900, 72);
    await page.screenshot({ path: path.join(artifacts, 'sidebar-narrow.png') });
    await toggle.press('Space');
    await assertLayout(true, 900, 72);
    await toggle.tap();
    await assertLayout(false, 900, 72);

    await page.locator('#douyin-navigation a[href*="/jingxuan"]').filter({ hasText: '精选' }).first().click();
    await page.waitForURL(url => url.pathname === '/jingxuan');
    await toggle.waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-douyin-touch-nav]').count(), 0);
    await recommend.click();
    await enter();
    await assertLayout(true, 900, 72);

    await toggle.tap();
    await assertLayout(false, 900, 72);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enter();
    await assertLayout(true, 900, 72);
    console.log('触屏、键盘、窄屏、路由切换和刷新均通过');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
