const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { browserProfile, debugUserscript, diagnosticConfig, userscript } = require('./paths.cjs');

const active = '[data-e2e="feed-active-video"]';
const script = process.env.DOUYIN_TEST_SCRIPT || (process.env.DOUYIN_DIAGNOSTICS_SELF_TEST ? debugUserscript : userscript);

(async () => {
  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chrome', headless: false, hasTouch: true,
    viewport: { width: 1280, height: process.env.DOUYIN_FINE_SWIPE ? 609 : 800 },
    deviceScaleFactor: process.env.DOUYIN_FINE_SWIPE ? 2 : 1,
  });
  try {
    if (process.env.DOUYIN_DIAGNOSTICS_SELF_TEST) {
      const config = JSON.parse(fs.readFileSync(diagnosticConfig, 'utf8'));
      await context.exposeBinding('__postDouyinDiagnostic', async (_source, url, data) => {
        assert.equal(url, `http://127.0.0.1:${config.port}/touch/${config.token}`);
        const report = { ...JSON.parse(data), source: 'test' };
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
        return response.status;
      });
      const shim = `window.GM_xmlhttpRequest = (details) => window.__postDouyinDiagnostic(details.url, details.data)
        .then(status => details.onload({status}), details.onerror);`;
      const nativeNudge = process.env.DOUYIN_FINE_SWIPE?.startsWith('nudge') ? `
        window.addEventListener('touchmove', () => {
          const track = document.querySelector('[data-e2e="feed-item"]')?.parentElement;
          if (!track || window.nativeMoved) return;
          window.nativeMoved = true;
          const y = new DOMMatrixReadOnly(getComputedStyle(track).transform).m42;
          track.style.transform = 'translate3d(0px, ' + (y - 46) + 'px, 0px)';
        }, {capture:true, passive:true});` : '';
      await context.addInitScript({ content: shim + nativeNudge + '\n' + fs.readFileSync(script, 'utf8') });
    } else {
      await context.addInitScript({ path: script });
    }
    const page = context.pages()[0];
    await page.goto('https://www.douyin.com/jingxuan', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const nav = page.locator('a[href*="recommend=1"]').filter({ hasText: '推荐' }).first();
    await nav.waitFor({ state: 'visible', timeout: 16000 });
    const saveDialog = page.locator('.trust-login-dialog-button-cancel');
    if (await saveDialog.isVisible()) await saveDialog.click();
    await nav.click();
    const guide = page.getByText('我知道了', { exact: true }).first();
    await page.locator(`${active}, [data-e2e="feed-live"]`).first().waitFor({ state: 'visible', timeout: 16000 });
    if (await saveDialog.isVisible()) await saveDialog.click();
    if (await guide.isVisible()) await guide.click();
    if (!(await page.locator(active).count())) {
      await page.locator('[data-e2e="video-switch-next-arrow"]').first().click();
      await page.waitForTimeout(400);
    }
    const video = page.locator(`${active} .xgplayer video`).first();
    await video.waitFor({ state: 'visible', timeout: 16000 });

    const current = () => page.locator(active).first().getAttribute('data-e2e-vid');
    const expectActive = async (id) => {
      await page.waitForFunction(([selector, expected]) => document.querySelector(selector)?.getAttribute('data-e2e-vid') === expected, [active, id], { timeout: 5000 });
      await page.waitForTimeout(500);
      assert.equal(await current(), id);
    };
    const first = await current();
    assert.ok(first);
    await page.evaluate(() => {
      window.testArrowClicks = [];
      window.addEventListener('click', event => {
        const arrow = event.target.closest('[data-e2e^="video-switch-"]');
        if (arrow) window.testArrowClicks.push(arrow.getAttribute('data-e2e'));
      }, true);
    });
    const cdp = await context.newCDPSession(page);
    async function touch(type, points) {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    }
    async function slide(x, y, dx, dy, beforeRelease, msBetweenMoves = 0) {
      await touch('touchStart', [{ x, y, id: 1 }]);
      for (let step = 1; step <= 6; step++) {
        if (msBetweenMoves) await page.waitForTimeout(msBetweenMoves);
        await touch('touchMove', [{ x: x + dx * step / 6, y: y + dy * step / 6, id: 1 }]);
      }
      if (beforeRelease) await beforeRelease();
      await touch('touchEnd', []);
    }

    const box = await video.boundingBox();
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    if (process.env.DOUYIN_TAP) {
      await video.evaluate(el => { el.muted = true; });
      await page.waitForFunction(selector => {
        const el = document.querySelector(selector);
        return el && el.readyState >= 2 && !el.paused;
      }, `${active} .xgplayer video`, { timeout: 8000 });
      await page.touchscreen.tap(x, y);
      await page.waitForFunction(selector => document.querySelector(selector)?.paused, `${active} .xgplayer video`, { timeout: 3000 });
      await page.touchscreen.tap(x, y);
      await page.waitForFunction(selector => document.querySelector(selector)?.paused === false, `${active} .xgplayer video`, { timeout: 3000 });
      assert.equal(await current(), first);
      console.log('点击视频仍可暂停和继续播放');
      return;
    }
    if (process.env.DOUYIN_CONTROLS) {
      await page.mouse.move(x, Math.round(box.y + box.height - 12));
      const progress = page.locator(`${active} .xgplayer-progress-outer:visible`).first();
      const progressBox = await progress.boundingBox({ timeout: 3000 });
      assert.ok(progressBox);
      const point = [Math.floor(progressBox.x + progressBox.width / 2), Math.floor(progressBox.y + progressBox.height / 2)];
      assert.ok(await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('xg-progress, xg-inner-controls')), point));
      await slide(...point, 0, -120);
      await expectActive(first);
      assert.deepEqual(await page.evaluate(() => window.testArrowClicks), []);
      console.log('从进度条开始拖动未切换');
      return;
    }
    console.log('实际触点', await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return [el?.localName, el?.className, navigator.maxTouchPoints, location.pathname + location.search];
    }, [x, y]));

    const trackTop = () => page.locator(active).first().evaluate(el => el.closest('[data-e2e="feed-item"]').parentElement.getBoundingClientRect().top);
    const initialTop = await trackTop();
    if (process.env.DOUYIN_STOP_NATIVE) {
      await page.evaluate(() => {
        window.addEventListener('click', (event) => {
          if (event.target.closest('[data-e2e="video-switch-next-arrow"]')) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, { capture: true, once: true });
      });
      await slide(x, y, 0, -165);
      await expectActive(first);
      assert.ok(Math.abs(await trackTop() - initialTop) < 3);
      await slide(x, y, 0, -165);
      await page.waitForFunction(([selector, id]) => {
        const playing = document.querySelector(selector)?.getAttribute('data-e2e-vid');
        return playing && playing !== id;
      }, [active, first], { timeout: 5000 });
      console.log('原生切换被拦截时轨道会复位，下一次手势可以正常切换');
      return;
    }
    if (process.env.DOUYIN_SNAP) {
      await page.waitForFunction(selector => document.querySelector(selector)?.closest('[data-e2e="feed-item"]')?.nextElementSibling?.matches('[data-e2e="feed-item"]'), active, { timeout: 10000 });
      let next;
      for (const dy of [-165, 165, -115, 115]) {
        const floor = await trackTop();
        const before = await current();
        await slide(x, y, 0, dy, async () => {
          await page.waitForTimeout(40);
          const draggedTop = await trackTop();
          assert.ok(Math.abs(draggedTop - floor - dy) < 3, `拖动了 ${draggedTop - floor}px，预期 ${dy}px`);
          await page.evaluate(() => {
            const track = document.querySelector('[data-e2e="feed-item"]').parentElement;
            const frames = [];
            const start = performance.now();
            const sample = () => {
              const elapsed = performance.now() - start;
              const top = track.getBoundingClientRect().top;
              const translate = getComputedStyle(track).translate;
              const native = track.getAnimations().some(animation => animation.transitionProperty === 'transform');
              frames.push({ elapsed, top, translate, native });
              if (elapsed < 470) requestAnimationFrame(sample);
            };
            window.snapFrames = frames;
            sample();
          });
        });
        await page.waitForFunction(([selector, id]) => document.querySelector(selector)?.getAttribute('data-e2e-vid') !== id, [active, before], { timeout: 5000 });
        next ??= await current();
        await expectActive(dy < 0 ? next : first);
        const frames = await page.evaluate(() => window.snapFrames);
        const overlapping = frames.filter(frame => frame.native && frame.translate !== 'none').length;
        const reverse = Math.max(0, ...frames.slice(1).map((frame, index) => (frames[index].top - frame.top) * Math.sign(dy)));
        const nativeFrames = frames.filter(frame => frame.native).length;
        const endStill = frames.at(-1).top;
        console.log('松手动画', { direction: dy < 0 ? '上滑' : '下滑', overlapping, nativeFrames, reverse, endStill });
        assert.ok(frames.length >= 4);
        if (process.env.DOUYIN_SNAP === 'fixed') {
          assert.equal(overlapping, 0);
          assert.ok(nativeFrames >= 2);
          assert.ok(reverse < 2, `释放后反向移动 ${reverse}px`);
          assert.ok(Math.abs(endStill - await trackTop()) < 2);
        }
      }
      return;
    }
    if (process.env.DOUYIN_FINE_SWIPE) {
      const mode = process.env.DOUYIN_FINE_SWIPE;
      if (mode.includes('competing')) {
        await page.evaluate(() => {
          const track = document.querySelector('[data-e2e="feed-item"]').parentElement;
          window.nativeMoved = false;
          window.addEventListener('touchmove', () => {
            window.nativeMoved = true;
            track.style.transform = 'translate3d(0px, -5px, 0px)';
          }, { once: true, passive: true });
        });
      }
      const snapshot = () => page.locator(active).first().evaluate(el => {
        const card = el.closest('[data-e2e="feed-item"]');
        const track = card.parentElement;
        const r = card.getBoundingClientRect();
        return { id: el.getAttribute('data-e2e-vid'), cardTop: r.y, target: track.style.transform, translate: getComputedStyle(track).translate, nativeMoved: window.nativeMoved || false };
      });
      await touch('touchStart', [{ x, y, id: 1 }]);
      const moves = [[2,-3],[3,-5],[4,-7],[4,-11],[4,-17],[4,-23],[4,-32],[4,-49],[4,-72],[4,-96],[4,-120]];
      for (const [offsetX, offsetY] of mode === 'nudge-short' ? moves.slice(0, 7) : moves) {
        await touch('touchMove', [{ x: x + offsetX, y: y + offsetY, id: 1 }]);
        await page.waitForTimeout(14);
      }
      const during = await snapshot();
      await touch('touchEnd', []);
      await page.waitForTimeout(600);
      const after = await snapshot();
      console.log('细步竖滑', { mode, during, after, dpr: await page.evaluate(() => devicePixelRatio), switched: after.id !== first });
      if (process.env.DOUYIN_DIAGNOSTICS_SELF_TEST) {
        await page.getByText(/触控诊断.*已收到 1 次/).waitFor({ timeout: 4000 });
        if (mode === 'nudge-short') {
          assert.ok(during.nativeMoved);
          assert.ok(Math.abs(during.cardTop - initialTop + 32) < 3);
          assert.equal(after.id, first);
          assert.ok(Math.abs(after.cardTop - initialTop) < 3);
          assert.equal(after.target, 'translate3d(0px, 0px, 0px)');
          console.log('小幅原生位移和短划均正确回到起始位置');
        } else if (mode === 'nudge') {
          assert.ok(during.nativeMoved);
          assert.equal(during.translate, 'none');
          console.log('主动模拟原生轨道先位移时，诊断能记录这次提前退出');
        } else {
          await slide(x, y, -5, 95, null, 35);
          await expectActive(first);
          await page.getByText(/触控诊断.*已收到 2 次/).waitFor({ timeout: 4000 });
          console.log('本地服务确认收到两个手势的诊断记录');
        }
      }
      if (mode === 'fixed' || mode === 'competing-fixed' || mode === 'nudge-fixed') {
        assert.ok(Math.abs(during.cardTop - initialTop + 120) < 3);
        assert.notEqual(after.id, first);
        assert.ok(Math.abs(after.cardTop - 56) < 3);
        await slide(x, y, -5, 95, null, 35);
        await expectActive(first);
      } else if (mode === 'competing-baseline') {
        assert.equal(after.id, first);
      }
      return;
    }
    if (process.env.DOUYIN_MEDIUM_SWIPE) {
      await slide(x, y, 5, -64, async () => {
        await page.waitForTimeout(35);
        assert.ok(Math.abs((await trackTop()) - initialTop + 64) < 3);
        assert.equal(await current(), first);
      }, 58);

      if (process.env.DOUYIN_MEDIUM_SWIPE === 'baseline') {
        await expectActive(first);
        assert.ok(Math.abs((await trackTop()) - initialTop) < 3);
        console.log('64 CSS 像素、350 毫秒以上的上滑只回弹，未切换');
        return;
      }

      await page.waitForFunction(([selector, id]) => {
        const current = document.querySelector(selector)?.getAttribute('data-e2e-vid');
        return current && current !== id;
      }, [active, first], { timeout: 5000 });
      const next = await current();
      await expectActive(next);
      await slide(x, y, -5, 64, null, 58);
      await expectActive(first);
      await slide(x, y, 0, -32, null, 58);
      await expectActive(first);
      assert.ok(Math.abs((await trackTop()) - initialTop) < 3);
      assert.deepEqual(await page.evaluate(() => window.testArrowClicks), ['video-switch-next-arrow', 'video-switch-prev-arrow']);
      console.log('64 CSS 像素慢滑能上下切换，32 像素短划仍回弹');
      return;
    }
    await slide(x, y, 5, -160, async () => {
      await page.waitForTimeout(50);
      const shifted = await trackTop();
      assert.ok(Math.abs(shifted - initialTop + 160) < 3, `${shifted} vs ${initialTop}`);
      assert.equal(await current(), first);
      console.log('松手之前轨道已跟随手指移动 160px');
      await page.evaluate(() => {
        const track = document.querySelector('[data-e2e="feed-item"]').parentElement;
        const frames = [];
        const start = performance.now();
        const sample = () => {
          frames.push(track.getBoundingClientRect().top);
          if (performance.now() - start < 500) requestAnimationFrame(sample);
        };
        sample();
        window.swipeFrames = frames;
      });
    });
    await page.waitForFunction(([selector, id]) => {
      const current = document.querySelector(selector)?.getAttribute('data-e2e-vid');
      return current && current !== id;
    }, [active, first], { timeout: 5000 });
    const next = await current();
    await expectActive(next);
    const frames = await page.evaluate(() => window.swipeFrames);
    assert.ok(frames.length >= 3);
    assert.ok(frames.every((top, index) => !index || top <= frames[index - 1] + 3), JSON.stringify(frames));
    console.log('松手后的切换动画沿拖动方向继续，没有反向跳帧');
    console.log('上滑切到下一条');
    await slide(x, y, -4, 160);
    await expectActive(first);
    console.log('下滑回到刚才的上一条');
    assert.deepEqual(await page.evaluate(() => window.testArrowClicks), ['video-switch-next-arrow', 'video-switch-prev-arrow']);

    await slide(x, y, 140, 4);
    await expectActive(first);
    const restoredTop = await trackTop();
    await slide(x, y, 0, -34, async () => {
      await page.waitForTimeout(50);
      assert.ok(Math.abs((await trackTop()) - restoredTop + 34) < 3);
    });
    await expectActive(first);
    assert.ok(Math.abs((await trackTop()) - restoredTop) < 3);
    await touch('touchStart', [{ x, y, id: 1 }, { x: x - 90, y, id: 2 }]);
    await touch('touchMove', [{ x, y: y - 90, id: 1 }, { x: x - 90, y: y - 90, id: 2 }]);
    await touch('touchEnd', []);
    await expectActive(first);
    console.log('横滑、短划和双指均未切换');

    await slide(x, y, 0, 140);
    await expectActive(first);
    console.log('第一条下滑不会切走');

    const getRate = () => video.evaluate(el => el.playbackRate);
    await video.evaluate(el => { el.playbackRate = 1.25; });
    for (const edge of [0.12, 0.88]) {
      const edgeX = Math.round(box.x + edge * box.width);
      await touch('touchStart', [{ x: edgeX, y, id: 1 }]);
      await page.waitForTimeout(edge < 0.5 ? 420 : 680);
      assert.equal(await getRate(), 2);
      assert.ok(await page.locator(`${active} >> xpath=..`).getByText('2×', { exact: true }).isVisible());
      await touch(edge < 0.5 ? 'touchEnd' : 'touchCancel', []);
      assert.equal(await getRate(), 1.25);
      await expectActive(first);
    }
    await touch('touchStart', [{ x, y, id: 1 }]);
    await page.waitForTimeout(410);
    assert.equal(await getRate(), 1.25);
    await touch('touchEnd', []);
    console.log('两侧长按到 2 倍速，松手或取消恢复 1.25 倍，中央长按不触发');

    const speedButtons = ['feed-comment-icon', 'video-player-collect', 'video-avatar'];
    const buttonSelector = speedButtons.map(name => `[data-e2e="${name}"]`).join(', ');
    await page.evaluate(selector => {
      window.speedButtonClicks = [];
      window.recordSpeedButtonClick = event => {
        const button = event.target.closest(selector);
        if (!button) return;
        window.speedButtonClicks.push(button.dataset.e2e);
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      window.addEventListener('click', window.recordSpeedButtonClick, true);
    }, buttonSelector);
    try {
      for (const [index, name] of speedButtons.entries()) {
        const button = page.locator(`${active} [data-e2e="${name}"]`).first();
        const r = await button.boundingBox();
        assert.ok(r, name);
        const point = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), id: 1 };
        await touch('touchStart', [point]);
        await page.waitForFunction(selector => document.querySelector(selector)?.playbackRate === 2,
          `${active} video`, { timeout: 2000 });
        await touch('touchEnd', []);
        assert.equal(await getRate(), 1.25);
        assert.deepEqual(await page.evaluate(() => window.speedButtonClicks), speedButtons.slice(0, index));
        await page.touchscreen.tap(point.x, point.y);
        assert.deepEqual(await page.evaluate(() => window.speedButtonClicks), speedButtons.slice(0, index + 1));
        await expectActive(first);
      }
    } finally {
      await page.evaluate(() => window.removeEventListener('click', window.recordSpeedButtonClick, true));
    }
    console.log('评论、收藏和头像长按进入 2 倍速，短按仍产生点击');

    await page.evaluate(() => {
      for (const arrow of document.querySelectorAll('[data-e2e^="video-switch-"]')) {
        arrow.style.visibility = 'hidden';
      }
    });
    await slide(x, y, 0, -150);
    await expectActive(next);
    console.log('切换按钮隐藏时，方向键事件也能切换');
    await slide(x, y, 0, 150);
    await expectActive(first);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 160, { steps: 6 });
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.testArrowClicks), ['video-switch-next-arrow', 'video-switch-prev-arrow']);
    console.log('鼠标拖动没有触发脚本的切换按钮');
  } finally {
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
