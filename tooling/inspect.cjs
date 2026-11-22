const { chromium } = require('playwright');
const { browserProfile } = require('./paths.cjs');

(async () => {
  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chrome', headless: !process.env.DOUYIN_HEADED, hasTouch: true, viewport: { width: 1280, height: 800 },
  });
  try {
    const page = context.pages()[0];
    await page.goto('https://www.douyin.com/?recommend=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const recommend = page.getByText('推荐', { exact: true }).first();
    await recommend.waitFor({ state: 'visible', timeout: 20000 });
    console.log('当前路径', new URL(page.url()).pathname);
    console.log('推荐入口', await recommend.evaluate(el => (el.closest('a') ?? el).outerHTML.slice(0, 250)));
    const saveDialog = page.locator('.trust-login-dialog-button-cancel');
    if (await saveDialog.isVisible()) await saveDialog.click();
    await recommend.click({ timeout: 10000 });
    await page.locator('[data-e2e="feed-active-video"], #slidelist video').first().waitFor({ state: 'visible', timeout: 17000 }).catch(() => {});
    const result = await page.evaluate(() => {
      const attrs = el => Object.fromEntries(Array.from(el.attributes, a => [a.name, a.value]).filter(([k]) => /^(id|class|role|aria-|data-|tabindex|title)/.test(k)));
      return {
        url: location.pathname + location.search, title: document.title, body: document.body.innerText.slice(0, 1800),
        videos: [...document.querySelectorAll('video')].filter(el => el.getBoundingClientRect().height > 100).slice(0, 3).map(video => {
          const parents = [];
          for (let el = video; el && parents.length < 10; el = el.parentElement) {
            const r = el.getBoundingClientRect();
            parents.push({ tag: el.localName, ...attrs(el), r: [r.x,r.y,r.width,r.height] });
          }
          return parents;
        }),
        candidates: [...document.querySelectorAll('button,[aria-label],[title],[data-e2e],[class*=switch],[class*=Switch]')].map(el => [el.localName, attrs(el), el.innerText?.slice(0,100)]).filter(a => /上一个|下一个|上一条|下一条|arrow|swiper|switch|shortcut|评论|播放器/i.test(JSON.stringify(a))).slice(0, 80),
      };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
