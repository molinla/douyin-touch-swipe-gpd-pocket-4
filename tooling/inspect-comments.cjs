const path = require('node:path');
const { chromium } = require('playwright');
const { artifacts, browserProfile, userscript } = require('./paths.cjs');

(async () => {
  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chrome', headless: false, hasTouch: true, viewport: { width: +(process.env.DOUYIN_WIDTH || 1280), height: 800 },
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
    const icon = page.locator('[data-e2e="feed-active-video"] [data-e2e="feed-comment-icon"]').first();
    await icon.waitFor({ state: 'visible', timeout: 15000 });
    for (const locator of [saveDialog, page.getByText('我知道了', { exact: true }).first()]) {
      if (await locator.isVisible()) await locator.click({ timeout: 2000 }).catch(() => {});
    }
    const dump = () => page.evaluate(() => {
      function desc(el, withText = false) {
        const r = el.getBoundingClientRect();
        return [el.localName, el.id, el.getAttribute('class'), el.getAttribute('data-e2e'), el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('role'), el.getAttribute('aria-selected'), [r.x,r.y,r.width,r.height].map(Math.round), withText ? el.textContent.trim().slice(0,65) : null];
      }
      function chain(el) {
        const ancestors = [];
        for (; el && ancestors.length < 8; el = el.parentElement) ancestors.push(desc(el));
        return ancestors;
      }
      const visible = el => {
        const r = el.getBoundingClientRect();
        return r.width && r.height && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).visibility === 'visible';
      };
      const active = document.querySelector('[data-e2e="feed-active-video"]');
      const commentIcon = active.querySelector('[data-e2e="feed-comment-icon"]');
      const panels = [...document.querySelectorAll('[role="tablist"], .comment-mainContent, [class*="comment-panel" i], [class*="side-panel" i], [data-e2e*="comment-list"]')].filter(visible).slice(0,12);
      const buttons = [...document.querySelectorAll('button,[role="tab"],[aria-label],[title],[data-e2e*="close"],[class*="close" i]')].filter(visible).filter(el => {
        const r = el.getBoundingClientRect();
        return r.x > innerWidth - 500 && r.width < 350 && r.height < 100 && r.y > 48;
      }).slice(0,45);
      return {icon: commentIcon.outerHTML.slice(0,650), panelChains: panels.map(chain), buttons: buttons.map(el=>desc(el, true)), video: desc(active)};
    });
    console.log('closed', JSON.stringify(await dump()));
    await icon.evaluate(el => el.click());
    await page.waitForTimeout(800);
    console.log('open', JSON.stringify(await dump()));
    const pane = page.locator('[data-e2e="feed-active-video"] #relatedVideoCard');
    console.log('panel structure', await pane.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const topRight = document.elementFromPoint(rect.right - 26, rect.top + 23);
      const tab = el.querySelector('[role="tablist"]');
      const list = [];
      for (let node=topRight; node && node!==el && list.length < 5; node=node.parentElement) list.push(node.outerHTML.slice(0,650));
      return {list, tabParent: tab.parentElement.nextElementSibling?.outerHTML.slice(0,750), el: el.parentElement.outerHTML.slice(0,500)};
    }));
    await icon.evaluate(el => el.click());
    await page.waitForTimeout(450);
    console.log('second icon click', await pane.isVisible(), await page.locator('#semiTabcomment[aria-selected="true"]').count());
    await icon.evaluate(el => el.click());
    await page.waitForTimeout(450);
    const otherTab = page.locator('[data-e2e="feed-active-video"] #semiTabauthor_card');
    if (await otherTab.isVisible()) {
      await otherTab.click();
      console.log('other tab', await page.locator('#semiTabauthor_card[aria-selected="true"]').count());
      await icon.evaluate(el => el.click());
      await page.waitForTimeout(450);
      console.log('icon on other tab', await pane.isVisible(), await page.locator('#semiTabcomment[aria-selected="true"]').count());
    }
    await page.screenshot({path:path.join(artifacts, 'comments-open.png')});
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
