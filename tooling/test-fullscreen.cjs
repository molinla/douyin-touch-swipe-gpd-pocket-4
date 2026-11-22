const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { artifacts, browserProfile, userscript } = require('./paths.cjs');

const active = '[data-e2e="feed-active-video"]';
const marker = 'data-douyin-touch-controls-idle';

(async () => {
  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chrome', headless: false, hasTouch: !process.env.DOUYIN_MOUSE_SEEK, viewport: null,
  });
  try {
    await context.addInitScript({ path: userscript });
    const page = context.pages()[0];
    page.on('pageerror', error => console.log('page-error',error.message));
    await page.goto('https://www.douyin.com/jingxuan', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const dismiss = async () => {
      for (const item of [page.locator('.trust-login-dialog-button-cancel'), page.getByText('我知道了', { exact: true }).first()]) {
        if (await item.isVisible()) await item.click({ timeout: 1800 }).catch(() => {});
      }
    };
    await dismiss();
    await page.locator('a[href*="recommend=1"]').filter({ hasText: '推荐' }).first().click({ timeout: 16000 });
    await page.locator(`${active},[data-e2e="feed-live"]`).first().waitFor({ state: 'visible', timeout: 16000 });
    await dismiss();
    if (!(await page.locator(active).count())) await page.locator('[data-e2e="video-switch-next-arrow"]').first().click({ timeout: 3000 });

    const player = page.locator(`${active} .xgplayer`).first();
    await player.locator('video').waitFor({ state: 'visible', timeout: 12000 });
    await page.waitForFunction(selector => document.querySelector(selector)?.closest('[data-e2e="feed-item"]')?.nextElementSibling?.querySelector('[data-e2e="feed-video"]'), active, { timeout: 14000 });
    await page.waitForTimeout(450);
    const current = () => page.locator(active).first().getAttribute('data-e2e-vid');
    const initial = await current();
    const next = await page.locator(active).first().evaluate(el => el.closest('[data-e2e="feed-item"]').nextElementSibling?.querySelector('[data-e2e="feed-video"]')?.getAttribute('data-e2e-vid'));
    const mediaPoint = async () => {
      const r = await player.boundingBox();
      return [Math.round(Math.max(10,r.x + r.width * .29)), Math.round(Math.max(10,r.y + r.height * .47))];
    };
    async function hoverControls() {
      const r = await player.boundingBox();
      await page.mouse.move(r.x + r.width * .66, r.y + r.height - 22);
    }
    async function setClear(wanted) {
      if (await player.evaluate(el=>Boolean(el.closest('.immersive-player-switch-on'))) === wanted) return;
      await hoverControls();
      await player.locator('.xgplayer-immersive-switch-setting').click({ timeout: 4500 });
      await page.waitForFunction(([selector, value]) => Boolean(document.querySelector(`${selector} .xgplayer`)?.closest('.immersive-player-switch-on')) === value, [active,wanted]);
    }
    const commentPanel = page.locator(`${active} #relatedVideoCard`);
    const commentTab = commentPanel.locator('#semiTabcomment[aria-selected="true"]');
    const cdp = await context.newCDPSession(page);
    const media = player.locator('video');
    const progress = player.locator('xg-progress').first();
    const scrubPreview = player.locator('.douyin-touch-scrub-preview');

    async function seekByTouch({ expanded = true, hidden = false, cancel = false, recover = false, capture = false } = {}) {
      await page.waitForFunction(selector => Number.isFinite(document.querySelector(`${selector} video`)?.duration) && document.querySelector(`${selector} video`).duration > 2, active);
      const startingId = await current();
      await media.evaluate(el => { el.pause(); el.currentTime = el.duration * .12; });
      const bar = await progress.boundingBox();
      const rail = await progress.locator('.xgplayer-progress-outer').boundingBox();
      const y = Math.round(bar.y + (expanded ? -bar.height * .28 : bar.height * .5));
      assert.equal(y < bar.y, expanded);
      const at = fraction=>Math.round(rail.x + rail.width * fraction);
      const touch = (type, fraction, dy = 0)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:fraction===null ? [] : [{x:at(fraction),y:y+dy,id:1}]});
      const ratio = () => media.evaluate(el => el.currentTime / el.duration);
      if (hidden) assert.notEqual(await player.getAttribute(marker),null);
      if (hidden) {
        console.log('隐藏时触点', await page.evaluate(([x,y]) => {
          const chain=[];
          for(let el=document.elementFromPoint(x,y);el&&chain.length<9;el=el.parentElement)chain.push([el.localName,el.getAttribute('class'),el.getAttribute('data-e2e')]);
          window.seekTrace=[];
          for(const type of ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchend']) window.addEventListener(type,event=>{
            window.seekTrace.push([type,event.target.localName,event.target.getAttribute?.('class'),event.defaultPrevented,event.pointerType]);
          },{capture:true,passive:true});
          return chain;
        },[at(.24),y]));
      }
      await touch('touchStart',.24);
      if (hidden) {
        assert.equal(await player.getAttribute(marker),null);
        assert.ok(Math.abs(await ratio() - .12) < .05);
      }
      await touch('touchMove',.41);
      await page.waitForTimeout(145);
      await touch('touchMove',.63);
      await scrubPreview.waitFor({state:'visible'});
      const expected = await media.evaluate(el => Math.floor(el.duration * .63));
      const look = await scrubPreview.evaluate(el => {
        const fill=el.querySelector('.douyin-touch-scrub-fill');
        const thumb=el.querySelector('.douyin-touch-scrub-thumb');
        const time=el.querySelector('.douyin-touch-scrub-time');
        const bar=el.getBoundingClientRect();
        return {color:getComputedStyle(fill).backgroundColor,height:bar.height,thumb:thumb.getBoundingClientRect().width,
          value:time.textContent,valueBottom:time.getBoundingClientRect().bottom,barTop:bar.top,
          percent:parseFloat(el.style.getPropertyValue('--douyin-touch-seek-position'))};
      });
      assert.equal(look.height,8);
      assert.equal(look.thumb,18);
      assert.equal(look.color,'rgb(254, 44, 85)');
      assert.ok(Math.abs(look.percent-63)<1);
      assert.ok(look.valueBottom < look.barTop);
      const seconds = look.value.split(':').reduce((total,part)=>total*60+Number(part),0);
      assert.ok(Math.abs(seconds-expected)<=1);
      assert.equal(await scrubPreview.locator('.douyin-touch-scrub-hint').innerText(),'上滑取消');
      assert.ok(Math.abs(await ratio() - .12) < .05, `预览期间真实播放进度 ${await ratio()}`);
      if (capture) await page.screenshot({path:path.join(artifacts, 'scrub-preview.png')});
      if (cancel || recover) {
        await touch('touchMove',.68,-65);
        await scrubPreview.locator('.douyin-touch-scrub-hint').filter({hasText:'松手取消'}).waitFor();
        assert.notEqual(await scrubPreview.getAttribute('data-cancelled'),null);
        if (capture) await page.screenshot({path:path.join(artifacts, 'scrub-cancel.png')});
        if (cancel) {
          await touch('touchEnd',null);
          await scrubPreview.waitFor({state:'detached'});
          assert.ok(Math.abs(await ratio() - .12) < .05, `取消后播放进度 ${await ratio()}`);
          assert.equal(await current(),startingId);
          console.log('上滑显示「松手取消」，释放后保留原进度');
          return;
        }
        await touch('touchMove',.68,-20);
        await scrubPreview.locator('.douyin-touch-scrub-hint').filter({hasText:'上滑取消'}).waitFor();
        assert.equal(await scrubPreview.getAttribute('data-cancelled'),null);
      }
      await touch('touchMove',.73);
      await touch('touchEnd',null);
      await page.waitForTimeout(170);
      assert.equal(await scrubPreview.count(),0);
      assert.ok(Math.abs(await ratio() - .73) < .05, `松手后进度 ${await ratio()}`);
      assert.ok(await media.evaluate(el=>el.paused));
      assert.equal(await current(),startingId);
      assert.ok(!(await commentPanel.isVisible()));
      console.log('触屏拖动', {mode: hidden ? '从隐藏进度处唤醒并拖动' : '已显示', originalHeight:bar.height, offsetFromTop:y-bar.y, finalPosition:await ratio()});
    }
    async function slide(dx, dy) {
      const [x,y] = await mediaPoint();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
      for (let i=1; i<=8; i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8,id:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    const goTo = async (dx,dy,id) => {
      await slide(dx,dy);
      await page.waitForFunction(([selector,value]) => document.querySelector(selector)?.getAttribute('data-e2e-vid') === value, [active,id], { timeout: 6500 });
      await page.waitForTimeout(470);
      assert.equal(await current(),id);
    };
    async function openComments() {
      if (!(await commentTab.isVisible())) await slide(-145,0);
      await commentTab.waitFor({ state:'visible', timeout:5000 });
      await page.waitForTimeout(250);
    }
    async function closeComments() {
      if (await commentPanel.isVisible()) await slide(145,0);
      await commentPanel.waitFor({state:'hidden',timeout:5000});
      await page.waitForTimeout(200);
    }

    const isFull = (mode) => page.evaluate(which => which === 'native'
      ? document.fullscreenElement?.id === 'slidelist' : document.querySelector('#slidelist')?.classList.contains('isCssFullScreen'), mode);
    const waitForMode = (mode,wanted) => page.waitForFunction(([which,value]) => Boolean(which === 'native'
      ? document.fullscreenElement?.id === 'slidelist' : document.querySelector('#slidelist')?.classList.contains('isCssFullScreen')) === value,[mode,wanted], {timeout:7000});

    if (process.env.DOUYIN_SEEK) await seekByTouch();
    if (process.env.DOUYIN_SEEK_CANCEL) {
      await seekByTouch({cancel:true,capture:true});
      await seekByTouch({recover:true});
    }
    if (process.env.DOUYIN_MOUSE_SEEK) {
      await media.evaluate(el => { el.pause(); el.currentTime = el.duration * .14; });
      const rail = await progress.locator('.xgplayer-progress-outer').boundingBox();
      const bar = await progress.boundingBox();
      const y = bar.y + bar.height/2;
      console.log('鼠标触点',await page.evaluate(([x,y]) => {
        const target = document.elementFromPoint(x,y);
        return [target?.localName,target?.getAttribute('class'),Boolean(target?.closest('xg-progress'))];
      },[rail.x+rail.width*.24,y]));
      await page.mouse.move(rail.x + rail.width * .24,y);
      await page.mouse.down();
      await page.mouse.move(rail.x + rail.width * .66,y,{steps:8});
      await page.mouse.up();
      await page.waitForFunction(selector => {
        const el = document.querySelector(`${selector} video`);
        return Math.abs(el.currentTime / el.duration - .66) < .06;
      },active,{timeout:4200}).catch(async error=>{
        console.log('鼠标释放后进度',await media.evaluate(el => el.currentTime / el.duration));
        throw error;
      });
      assert.equal(await current(),initial);
      console.log('原生鼠标拖动可以正常定位进度');
      return;
    }
    const waitForIdleControls = () => page.waitForFunction(([selector, attribute]) =>
      document.querySelector(`${selector} .xgplayer`)?.hasAttribute(attribute), [active, marker], { timeout: 4800 });
    const readLayout = () => player.evaluate(el => {
      const video = el.querySelector('video');
      const bounds = node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return [x, y, width, height].map(Math.round);
      };
      const style = getComputedStyle(video);
      return { player: bounds(el), video: bounds(video), progress: bounds(el.querySelector('xg-progress')),
        fit: style.objectFit, alignment: style.objectPosition };
    });
    async function checkIdleLayout(shown) {
      const hidden = await readLayout();
      assert.deepEqual(hidden.video, hidden.player, '隐藏底栏后视频使用完整播放器区域');
      assert.equal(hidden.fit, 'contain');
      assert.equal(hidden.alignment, '50% 50%');
      assert.deepEqual(hidden.progress, shown.progress, '隐藏底栏时进度条命中区域保持原位');
    }

    for (const mode of (process.env.DOUYIN_FULL_MODE || 'web,native').split(',')) {
      const selector = mode === 'native' ? '.xgplayer-fullscreen' : '[data-e2e="xgplayer-page-full-screen"]';
      await setClear(false);
      await page.bringToFront();
      await hoverControls();
      await player.locator(selector).click({timeout:5000});
      await waitForMode(mode,true);
      await page.waitForTimeout(450);
      if (process.env.DOUYIN_INSPECT_BOTTOM) {
        console.log(await player.evaluate(el => {
          const box = el.getBoundingClientRect();
          return [...el.querySelectorAll('*')].filter(node => {
            const r = node.getBoundingClientRect();
            return r.height > 0 && r.width > 8 && r.top > box.bottom - 95 && r.top < box.bottom
              && (node.localName.startsWith('xg-') || /controls|progress|gradient|positionBox/.test(node.getAttribute('class') || ''));
          }).slice(0,65).map(node => {
            const r = node.getBoundingClientRect();
            return [node.localName,node.getAttribute('class'),node.parentElement.localName,node.parentElement.getAttribute('class'),Math.round(r.y),Math.round(r.height),getComputedStyle(node).visibility];
          });
        }));
        return;
      }
      assert.equal(await player.getAttribute(marker),null);
      const beforeIdle = await readLayout();
      await waitForIdleControls();
      await checkIdleLayout(beforeIdle);
      assert.equal(await progress.evaluate(el => getComputedStyle(el).visibility), 'hidden');
      for (const selector of ['.player-position-box-bottom', '.positionBox.immersive-player-switch-on-hide-interaction-area']) {
        const overlay = page.locator(`${active} ${selector}`).first();
        if (await overlay.count()) assert.equal(await overlay.evaluate(el => getComputedStyle(el).visibility), 'hidden', selector);
      }
      console.log(mode, '未开启清屏时，空闲后隐藏进度条、底部视频信息和右侧按钮');
      await setClear(true);
      const clearBeforeIdle = await readLayout();
      await waitForIdleControls();
      await checkIdleLayout(clearBeforeIdle);
      if (process.env.DOUYIN_INSPECT_HIDDEN) {
        const readHidden = () => player.evaluate((el, attribute) => {
          const nodes = [...el.querySelectorAll('xg-controls, xg-inner-controls, xg-outer-controls, xg-progress, .xgplayer-fullscreen')];
          const attributes = node=>Object.fromEntries([...node.attributes].map(a=>[a.name,a.value]));
          return { player:attributes(el), parent:el.closest('#slidelist')?.className, nodes:nodes.map(node => {
            const css=getComputedStyle(node);
            const r=node.getBoundingClientRect();
            return [node.localName, attributes(node), [css.visibility, css.opacity, css.pointerEvents, css.display, css.transition], [r.x,r.y,r.width,r.height], node.matches(`#slidelist [${attribute}] xg-controls`)];
          }) };
        },marker);
        console.log('at start',JSON.stringify(await readHidden()));
        await page.waitForTimeout(420);
        console.log('after fade',JSON.stringify(await readHidden()));
        return;
      }
      assert.equal(await progress.evaluate(el=>getComputedStyle(el).visibility),'hidden');
      for (const selector of ['xg-controls','.xgplayer-play','.xgplayer-time','.xgplayer-playback-setting','.xgplayer-fullscreen']) {
        assert.equal(await player.locator(selector).first().evaluate(el=>getComputedStyle(el).visibility),'hidden',selector);
      }
      const bottomInfo = page.locator(`${active} .player-position-box-bottom`).first();
      if (await bottomInfo.count()) assert.equal(await bottomInfo.evaluate(el=>getComputedStyle(el).visibility),'hidden');
      if (process.env.DOUYIN_SEEK) {
        await seekByTouch({hidden:true,capture:mode==='native'});
        await page.waitForFunction(([selector,attribute]) => document.querySelector(`${selector} .xgplayer`)?.hasAttribute(attribute),[active,marker],{timeout:4800});
      }
      const [x,y] = await mediaPoint();
      await page.mouse.move(x,y);
      await page.waitForFunction(([selector,attribute]) => !document.querySelector(`${selector} .xgplayer`)?.hasAttribute(attribute),[active,marker],{timeout:3000});
      assert.equal(await player.locator('xg-controls').first().evaluate(el=>getComputedStyle(el).visibility),'visible');
      assert.deepEqual((await readLayout()).video, clearBeforeIdle.video);
      console.log(mode, '全屏空闲时画面等比居中，唤醒底栏后恢复原布局');
      if (mode === 'native') {
        await page.waitForFunction(([selector,attribute]) => document.querySelector(`${selector} .xgplayer`)?.hasAttribute(attribute),[active,marker],{timeout:4800});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        await page.waitForFunction(([selector,attribute]) => !document.querySelector(`${selector} .xgplayer`)?.hasAttribute(attribute),[active,marker],{timeout:3000});
        await page.waitForTimeout(3150);
        assert.equal(await player.getAttribute(marker),null);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        console.log('触摸重新显示底部控制区，手指按住时不会自动隐藏');
      }
      await setClear(false);

      await closeComments();
      if (process.env.DOUYIN_FULL_FALLBACK) {
        await page.evaluate(() => {
          window.fallbackCalls = [];
          const arrowClick = event => {
            if (!event.target.closest?.('[data-e2e="video-switch-next-arrow"], .xgplayer-playswitch-next')) return;
            window.fallbackCalls.push('blocked-arrow');
            window.removeEventListener('click', arrowClick, true);
            event.stopImmediatePropagation();
          };
          window.addEventListener('click', arrowClick, {capture:true});
          window.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown') window.fallbackCalls.push('keyboard');
          }, {capture:true});
        });
      }
      await goTo(3,-160,next);
      if (process.env.DOUYIN_FULL_FALLBACK) {
        assert.deepEqual(await page.evaluate(() => window.fallbackCalls),['blocked-arrow','keyboard']);
        console.log('全屏切换控件无响应时，方向键后备入口只执行一次');
      }
      await goTo(-3,160,initial);
      assert.ok(await isFull(mode));
      console.log(mode, '全屏评论关闭时可以上下切换且保持全屏');
      await openComments();
      await goTo(3,-160,next);
      await openComments();
      await goTo(-3,160,initial);
      assert.ok(await isFull(mode));
      console.log(mode, '全屏评论打开时从画面上下滑可正常切换');

      await closeComments();
      await hoverControls();
      await player.locator(selector).click({timeout:5000});
      await waitForMode(mode,false);
      await page.waitForTimeout(420);
      assert.equal(await player.getAttribute(marker),null);
    }
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
