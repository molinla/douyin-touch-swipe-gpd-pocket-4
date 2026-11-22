const path = require('node:path');
const { chromium } = require('playwright');
const { artifacts, browserProfile, userscript } = require('./paths.cjs');

(async () => {
  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chrome', headless: false, hasTouch: true, viewport: { width: 1280, height: 800 },
  });
  try {
    const page = context.pages()[0];
    if (process.env.DOUYIN_SCRIPT) await context.addInitScript({ path: userscript });
    await page.goto('https://www.douyin.com/?recommend=1&from_nav=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const nav = page.locator('a[href*="recommend=1"]').filter({ hasText: '推荐' }).first();
    await nav.waitFor({ state: 'visible', timeout: 16000 });
    const saveDialog = page.locator('.trust-login-dialog-button-cancel');
    if (await saveDialog.isVisible()) await saveDialog.click({ timeout: 2000 }).catch(() => {});
    await nav.click();
    await page.locator('[data-e2e="feed-item"]').first().waitFor({ state: 'visible', timeout: 16000 });
    for (const locator of [saveDialog, page.getByText('我知道了', { exact: true }).first()]) {
      if (await locator.isVisible()) await locator.click({ timeout: 2000 }).catch(() => {});
    }
    if (process.env.DOUYIN_LAYOUT) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const {root} = await cdp.send('DOM.getDocument');
      const ids = await page.evaluate(() => {
        const layout = document.querySelector('#douyin-right-container').parentElement;
        const nav = layout.querySelector('[data-e2e="douyin-navigation"]');
        function describe(el) {
          const r = el.getBoundingClientRect();
          return [el.localName, el.id, el.getAttribute('class'), el.getAttribute('data-e2e'), [r.x,r.y,r.width,r.height].map(Math.round), getComputedStyle(el).position];
        }
        const list = [...layout.children];
        const ancestry = [];
        for (let el = nav; el && el !== layout; el = el.parentElement) ancestry.push(el);
        [...new Set([...list, ...ancestry, ...ancestry.at(-1).children])].forEach((el,i) => { el.setAttribute('data-sidebar-inspect', String(i)); });
        return [...layout.querySelectorAll('[data-sidebar-inspect]')].map(el => [el.getAttribute('data-sidebar-inspect'), describe(el), [...el.children].slice(0,10).map(describe), [...getComputedStyle(el)].filter(k => /^--.*(nav|menu|sidebar|header).*(width|size)/i.test(k)).map(k=> [k,getComputedStyle(el).getPropertyValue(k)] )]);
      });
      for (const [id, element, children, vars] of ids) {
        const {nodeId} = await cdp.send('DOM.querySelector', {nodeId:root.nodeId, selector:`[data-sidebar-inspect="${id}"]`});
        const matched = await cdp.send('CSS.getMatchedStylesForNode', {nodeId});
        const rules = (matched.matchedCSSRules ?? []).map(({rule}) => [rule.selectorList.text, rule.media?.map(q=>q.text), rule.style.cssProperties.filter(p=>/^(width|min-width|max-width|flex|flex-shrink|left|padding-left|margin-left|z-index|container-type|--.*(?:nav|aside|sidebar|header))/.test(p.name)).map(p=>[p.name,p.value])]).filter(r=>r[2].length);
        console.log(JSON.stringify({id, element, children, vars, rules}));
      }
      await page.screenshot({path:path.join(artifacts, 'sidebar-original.png')});
      return;
    }
    const describe = () => page.evaluate(() => {
      const link = document.querySelector('a[href*="recommend=1"]');
      function desc(el) {
        const r = el.getBoundingClientRect();
        const css = getComputedStyle(el);
        return [el.localName, el.id, el.getAttribute('class'), el.getAttribute('style'), el.getAttribute('data-e2e'),
          [r.x,r.y,r.width,r.height].map(v=>Math.round(v)), [css.position,css.display,css.flex,css.width,css.minWidth,css.paddingLeft,css.overflowX,css.backgroundColor]];
      }
      const ancestors = [];
      for (let el = link; el && ancestors.length < 10; el = el.parentElement) ancestors.push(desc(el));
      const content = [];
      for (let el = document.querySelector('#douyin-right-container'); el && content.length < 5; el = el.parentElement) content.push(desc(el));
      const buttons = [...document.querySelectorAll('button,[role="button"],[title],[aria-label],[data-e2e]')].filter(el => {
        const r = el.getBoundingClientRect();
        return (r.left < 185 || r.top < 57) && r.width > 1 && r.width < 200 && r.height > 1 && r.height < 75;
      }).slice(0,80).map(el => [el.localName,el.getAttribute('class'),el.getAttribute('title'),el.getAttribute('aria-label'),el.getAttribute('data-e2e'),el.textContent.slice(0,55).trim(),Boolean(el.querySelector('svg'))]);
      const toggles = [...document.querySelectorAll('[class*="collapse" i],[class*="fold" i],[class*="unfold" i],[data-e2e*="sidebar"]')].slice(0,40).map(el=>[el.localName,el.id,el.getAttribute('class'),el.getAttribute('title'),el.getAttribute('aria-label'),el.getAttribute('data-e2e'),el.getBoundingClientRect().width]);
      const left = link?.closest('#douyin-sidebar, #douyin-navigation, aside') || link?.parentElement?.parentElement?.parentElement?.parentElement;
      const vars = left ? [...getComputedStyle(left)].filter(k=>/^--.*(side|aside|nav|menu|background|hover|radius|text)/i.test(k)).slice(0,50).map(k=>[k,getComputedStyle(left).getPropertyValue(k)]) : [];
      return {ancestors, content, buttons, toggles, vars};
    });
    console.log('1280', JSON.stringify(await describe()));
    await page.screenshot({ path: path.join(artifacts, 'sidebar-original.png') });
    await page.setViewportSize({ width: 970, height: 760 });
    await page.waitForTimeout(450);
    console.log('970', JSON.stringify(await describe()));
    await page.setViewportSize({ width: 760, height: 680 });
    await page.waitForTimeout(450);
    console.log('760', JSON.stringify(await describe()));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
