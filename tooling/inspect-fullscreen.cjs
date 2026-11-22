const path = require('node:path');
const { chromium } = require('playwright');
const { artifacts, browserProfile, userscript } = require('./paths.cjs');

(async () => {
  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chrome', headless: Boolean(process.env.DOUYIN_HEADLESS), hasTouch: true,
    viewport: process.env.DOUYIN_NATIVE_VIEWPORT ? null : { width: 1280, height: 800 },
  });
  try {
    await context.addInitScript({ path: userscript });
    await context.addInitScript(() => {
      window.fullscreenTrace = [];
      for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) {
        const api = Element.prototype[name];
        if (!api) continue;
        Element.prototype[name] = function (...args) {
          window.fullscreenTrace.push([name, this.localName, this.id, String(this.className), navigator.userActivation?.isActive]);
          const result = api.apply(this, args);
          result?.catch?.(error => window.fullscreenTrace.push([error.name, error.message]));
          return result;
        };
      }
      for (const event of ['fullscreenchange','fullscreenerror']) {
        document.addEventListener(event, () => window.fullscreenTrace.push([event,document.fullscreenElement?.id,document.fullscreenElement?.className]));
      }
    });
    const page = context.pages()[0];
    await page.goto('https://www.douyin.com/jingxuan', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const saveDialog = page.locator('.trust-login-dialog-button-cancel');
    if (await saveDialog.isVisible()) await saveDialog.click({ timeout: 2000 }).catch(() => {});
    await page.locator('a[href*="recommend=1"]').filter({ hasText: '推荐' }).first().click({ timeout: 16000 });
    const active = '[data-e2e="feed-active-video"]';
    const live = '[data-e2e="feed-live"]';
    await page.locator(`${active},${live}`).first().waitFor({ state: 'visible', timeout: 15000 });
    for (const popup of [saveDialog, page.getByText('我知道了', { exact: true }).first()]) {
      if (await popup.isVisible()) await popup.click({ timeout: 2200 }).catch(() => {});
    }
    if (!(await page.locator(active).count())) await page.locator('[data-e2e="video-switch-next-arrow"]').first().click({ timeout: 3000 });
    await page.locator(`${active} .xgplayer video`).first().waitFor({ state: 'visible', timeout: 12000 });
    await page.waitForTimeout(500);

    const snapshot = () => page.evaluate(() => {
      const watch = ['id','class','data-e2e','data-state','data-active','aria-checked','data-status','aria-label','title','style','role'];
      function element(el) {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [el.localName, Object.fromEntries(watch.map(key => [key,el.getAttribute(key)]).filter(([,v])=>v !== null)), [r.x,r.y,r.width,r.height].map(Math.round)];
      }
      function chain(el) {
        const out = [];
        for (let i=0; el && i<13; i++,el=el.parentElement) out.push(element(el));
        return out;
      }
      const active = document.querySelector('[data-e2e="feed-active-video"]');
      const player = active?.querySelector('.xgplayer');
      const xg = window.player;
      const plugin = xg?.getPlugin?.('playswitch') || xg?.plugins?.playswitch;
      const instance = xg && {
        matches: xg.root === player, flags: ['fullscreen','isFullscreen','isCssFullScreen','isPageFullScreen'].map(key=>[key, typeof xg[key] === 'boolean' ? xg[key] : typeof xg[key]]),
        plugins: Object.keys(xg.plugins || {}).filter(key => /switch|full|progress|immersiv/i.test(key)),
        methods: ['getFullscreen','getCssFullscreen','exitFullscreen','getPlugin','next','prev','playNext','playPrev'].map(key=>[key,typeof xg[key]]),
        switchPlugin: plugin && Object.getOwnPropertyNames(Object.getPrototypeOf(plugin)),
      };
      const buttons = [...document.querySelectorAll('[data-e2e*="full"], xg-icon[class*="full"], .xgplayer-immersive-switch-setting')].filter(el => el.getBoundingClientRect().width > 0).slice(0,16).map(el => ({ el:element(el), text:el.textContent.trim().slice(0,35), button: element(el.querySelector('button, [role="switch"], .xg-switch')) }));
      const points = [[innerWidth*.4,innerHeight*.43],[innerWidth*.62,innerHeight*.48]];
      const controls = ['.xg-inner-controls','xg-progress','.xgplayer-progress-outer','.xgplayer-immersive-switch-setting'];
      return { instance, dims:[innerWidth,innerHeight,screen.width,screen.height], displayFullscreen:matchMedia('(display-mode: fullscreen)').matches,
        native:element(document.fullscreenElement), body:element(document.body), player:element(player),
        playerChain:chain(player), hits:points.map(([x,y]) =>chain(document.elementFromPoint(x,y))),
        buttons, controls:controls.map(selector => [selector,element(player?.querySelector(selector))]),
        lists:[...document.querySelectorAll('#slidelist,[data-e2e="slideList"]')].map(element),
        arrows:[...document.querySelectorAll('[data-e2e^="video-switch-"]')].map(element) };
    });

    async function dump(label) {
      const state = await snapshot();
      console.log(label, JSON.stringify(state));
    }
    await dump('normal');
    const player = page.locator(`${active} .xgplayer`).first();
    const reveal = async () => {
      const r = await player.boundingBox();
      await page.mouse.move(r.x + r.width * .67, r.y + r.height - 23);
    };
    const clear = player.locator('.xgplayer-immersive-switch-setting').first();
    await reveal();
    if (!(await clear.locator('.xg-switch-checked').count())) await clear.click({timeout:4000});
    await page.waitForTimeout(380);
    await dump('clear');

    const web = player.locator('[data-e2e="xgplayer-page-full-screen"], .xgplayer-page-full-screen').first();
    const native = player.locator('[data-e2e="xgplayer-fullscreen"], .xgplayer-fullscreen').first();
    if (await web.count()) {
      await reveal();
      await web.click({timeout:4000});
      await page.waitForTimeout(500);
      await dump('web-full-clear');
      const cdp = await context.newCDPSession(page);
      const [x,y,before] = await page.evaluate(() => [Math.round(innerWidth*.39),Math.round(innerHeight*.54),document.querySelector('[data-e2e="feed-active-video"]')?.getAttribute('data-e2e-vid')]);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
      for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*22,id:1}]});
      const drag = await page.evaluate(() => { const track=document.querySelector('[data-e2e="feed-active-video"]').closest('[data-e2e="feed-item"]').parentElement;return [track.style.transform,getComputedStyle(track).translate];});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(550);
      const now = await page.evaluate(() => document.querySelector('[data-e2e="feed-active-video"]')?.getAttribute('data-e2e-vid'));
      console.log('web-gesture',JSON.stringify({titleChanged:before!==now,drag}));
      await reveal();
      await web.click({timeout:4000});
      await page.waitForTimeout(320);
    }
    await reveal();
    console.log('native-controls', await native.count());
    await page.bringToFront();
    await native.click({ timeout:4500 });
    await page.waitForTimeout(700);
    if (!(await page.evaluate(() => Boolean(document.fullscreenElement)))) {
      await page.keyboard.press('h');
      await page.waitForTimeout(600);
    }
    console.log('native-trace', JSON.stringify(await page.evaluate(() => [document.fullscreenEnabled, ...window.fullscreenTrace])));
    await dump('native-full-clear');
    if (await page.evaluate(() => Boolean(document.fullscreenElement))) {
      console.log('native-player-controls', JSON.stringify(await page.evaluate(() => {
        const xg = window.player;
        const info = root => root && [root.localName, root.getAttribute?.('class')];
        return {
          progress: info(xg?.getPlugin?.('progress')?.root), mini: info(xg?.getPlugin?.('miniprogress')?.root),
          clear: info(xg?.getPlugin?.('immersiveswitchsettingplugin')?.root),
          arrows: [...document.querySelectorAll('[data-e2e^="video-switch-"]')].map(el=>[el.getAttribute('data-e2e'),el.parentElement.className,el.parentElement.parentElement.className,document.fullscreenElement.contains(el),getComputedStyle(el).visibility,el.classList.contains('disabled')]),
        };
      })));
      await page.evaluate(() => {
        window.fullInput = [];
        for (const name of ['touchstart','touchend','touchcancel','pointercancel','click','keydown']) {
          window.addEventListener(name, event => {
            const target = event.target;
            const arrow = target.closest?.('[data-e2e^="video-switch-"]');
            window.fullInput.push([name,target.localName,arrow?.getAttribute('data-e2e'),arrow && document.fullscreenElement.contains(arrow),event.key]);
          }, {capture:true,passive:true});
        }
      });
      const cdp = await context.newCDPSession(page);
      async function simulate(direction) {
        const [x,y,before] = await page.evaluate(() => [Math.round(innerWidth*.34),Math.round(innerHeight*.48),document.querySelector('[data-e2e="feed-active-video"]')?.getAttribute('data-e2e-vid')]);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+i*22*direction,id:1}]});
        const drag = await page.evaluate(() => {
          const track = document.querySelector('#slidelist [data-e2e="feed-item"]')?.parentElement;
          return [track.style.transform,getComputedStyle(track).translate];
        });
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitForTimeout(600);
        console.log('native-gesture',JSON.stringify({dir:direction,changed:before!==await page.locator(active).first().getAttribute('data-e2e-vid').catch(()=>null),drag,input:await page.evaluate(()=>window.fullInput.splice(0))}));
      }
      await simulate(-1);
      await simulate(1);
      const comment = page.locator(`${active} [data-e2e="feed-comment-icon"]`).first();
      if (await comment.count()) await comment.evaluate(el=>el.click());
      await page.waitForTimeout(500);
      await simulate(-1);
      await simulate(1);
      for (const [key,keyCode] of [['ArrowUp',38],['ArrowDown',40]]) {
        const before = await page.locator(active).first().getAttribute('data-e2e-vid');
        await page.locator(active).first().evaluate((el,[key,keyCode]) => el.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,which:keyCode,keyCode,bubbles:true,cancelable:true})),[key,keyCode]);
        await page.waitForTimeout(480);
        console.log('native-key', JSON.stringify({key,changed:before!==await page.locator(active).first().getAttribute('data-e2e-vid')}));
      }
    }
    await page.screenshot({ path:path.join(artifacts, 'fullscreen-test.png') });
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
