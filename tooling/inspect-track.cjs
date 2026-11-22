const { chromium } = require('playwright');
const { browserProfile } = require('./paths.cjs');

(async () => {
  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chrome', headless: false, hasTouch: true, viewport: { width: 1280, height: 800 },
  });
  try {
    const page = context.pages()[0];
    await page.goto('https://www.douyin.com/?recommend=1&from_nav=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const nav = page.locator('a[href*="recommend=1"]').filter({ hasText: '推荐' }).first();
    await nav.waitFor({ state: 'visible', timeout: 16000 });
    const saveDialog = page.locator('.trust-login-dialog-button-cancel');
    if (await saveDialog.isVisible()) await saveDialog.click();
    await nav.click();
    await page.locator('[data-e2e="feed-item"]').first().waitFor({ state: 'visible', timeout: 15000 });
    for (const locator of [page.locator('.trust-login-dialog-button-cancel'), page.getByText('我知道了', { exact: true }).first()]) {
      if (await locator.isVisible()) await locator.click({timeout: 2000}).catch(() => {});
    }
    const shape = () => page.evaluate(() => {
      const describe = el => {
        const {x, y, width, height} = el.getBoundingClientRect();
        const css = getComputedStyle(el);
        return {tag: el.localName, id: el.id, c: el.getAttribute('class'), e: el.getAttribute('data-e2e'), active: el.getAttribute('data-active'), inline: el.getAttribute('style'), xywh: [x,y,width,height].map(v=>Math.round(v)), css: [css.position, css.overflowY, css.transform, css.translate, css.transition, css.zIndex]};
      };
      const slides = [...document.querySelectorAll('[data-e2e="feed-item"]')];
      const parents = [];
      for (let el = slides[0]?.parentElement; el && parents.length < 6; el=el.parentElement) parents.push(describe(el));
      return {slides: slides.slice(0,7).map(el=>({slide:describe(el), contents:[...el.children].slice(0,4).map(describe), live: !!el.querySelector('[data-e2e="feed-live"]')})), parents};
    });
    await page.locator('[data-e2e="feed-item"] video, [data-e2e="feed-live"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(650);
    console.log('TRACK', JSON.stringify((await shape()).parents.slice(0,3)));
    console.log('MOTION', JSON.stringify(await page.evaluate(() => new Promise(resolve => {
      const track = document.querySelector('[data-e2e="feed-item"]').parentElement;
      const frames = [];
      const start = performance.now();
      function frame() {
        const dt = Math.round(performance.now()-start);
        const style = getComputedStyle(track);
        frames.push([dt, Math.round(track.getBoundingClientRect().y), track.style.cssText, style.transition]);
        if (dt < 480) requestAnimationFrame(frame);
        else resolve(frames.filter((_, index) => index % 3 === 0));
      }
      frame();
      document.querySelector('[data-e2e="video-switch-next-arrow"]').click();
    }))));
    for (let i = 0; i < 35; i++) {
      const result = await page.evaluate(() => {
        const slides = [...document.querySelectorAll('[data-e2e="feed-item"]')];
        const active = slides.find(el => { const r = el.getBoundingClientRect(); return r.top <= innerHeight / 2 && r.bottom > innerHeight / 2; });
        const live = active?.querySelector('[data-e2e="feed-live"]');
        if (!live) return { active: active?.querySelector('[data-e2e-vid]')?.getAttribute('data-e2e-vid') };
        const r = live.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width/2,r.top + r.height/2);
        const tags = [];
        for (let el=at; el && el!==active.parentElement; el=el.parentElement) tags.push([el.localName, el.getAttribute('class'), el.getAttribute('data-e2e'), el.getAttribute('role'), el.getAttribute('href')]);
        return {live: true, tags, markup: live.outerHTML.slice(0,1100)};
      });
      console.log('CARD', i, JSON.stringify(result));
      if (result.live) break;
      await page.evaluate(() => document.querySelector('[data-e2e="video-switch-next-arrow"]')?.click());
      await page.waitForTimeout(540);
    }
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
