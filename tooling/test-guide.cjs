const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { userscript } = require('./paths.cjs');

const url = 'https://www.douyin.com/?recommend=1';
const labels = ['展开与收起导航', '左滑打开评论', '右滑关闭评论', '上下滑切换视频', '拖动进度条', '全屏自动隐藏底栏'];

const slide = id => `<article data-e2e="feed-item">
  <div data-e2e="${id === 1 ? 'feed-active-video' : 'feed-video'}" data-e2e-vid="${id}">
    <div class="xgplayer">
      <xg-video-container><video></video></xg-video-container>
      <div data-e2e="feed-comment-icon">评论</div>
      <xg-controls><xg-progress><xg-outer class="xgplayer-progress-outer"></xg-outer></xg-progress>
        <button class="xgplayer-fullscreen">全屏</button>
      </xg-controls>
    </div>
    <aside id="relatedVideoCard" hidden><div class="semi-tabs"><button role="tab" id="semiTabcomment" aria-selected="true">评论</button></div>
      <div><svg width="16" height="16"></svg></div>
      <div class="comment-mainContent">评论列表</div>
    </aside>
  </div>
</article>`;

const markup = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;background:#121215;color:white}
  #layout{display:flex}#douyin-navigation{flex:0 0 84px}#douyin-right-container{flex:1;min-width:0}
  #slidelist{position:relative;overflow:hidden}.isCssFullScreen{position:fixed!important;inset:0}
  article,[data-e2e="slideList"]{height:100vh}article{position:relative}
  .xgplayer{position:relative;height:100vh;background:#2b3149}
  xg-video-container{position:absolute;inset:0 0 48px}video{display:block;width:100%;height:100%}
  [data-e2e="feed-comment-icon"]{position:absolute;right:14px;top:48%}
  [data-e2e="video-switch-next-arrow"]{position:absolute;right:5px;top:15%;z-index:2}
  #relatedVideoCard{position:absolute;right:12px;top:12%;width:min(240px,45%);height:72%;background:#20222d}
  .comment-mainContent{height:82%;overflow:auto}
  xg-controls{position:absolute;bottom:0;left:0;right:0;height:48px}
  xg-progress,xg-outer{display:block;height:12px;background:#999}
  .xgplayer-fullscreen{position:absolute;right:14px;bottom:4px}
  [data-e2e="recommend-guide-mask"]{position:fixed;inset:0;background:#16161e99;z-index:1000}
</style>
<div id="layout"><nav id="douyin-navigation">推荐</nav><main id="douyin-right-container">
  <div id="slidelist"><div data-e2e="slideList" data-active="true">
    <div id="track" style="transform:translate3d(0px,0px,0px)">${slide(1)}${slide(2)}</div>
    <button data-e2e="video-switch-next-arrow">下一条视频</button>
  </div></div>
</main></div>
<div data-e2e="recommend-guide-mask"><button id="native">我知道了</button></div>
<script>
  const feed = document.querySelector('#slidelist');
  document.querySelector('#native').onclick = event => { event.target.parentNode.hidden = true; };
  for (const media of feed.querySelectorAll('video')) {
    Object.defineProperty(media, 'readyState', { value: 4 });
    Object.defineProperty(media, 'duration', { value: 120 });
  }
  for (const article of feed.querySelectorAll('article')) {
    const comments = article.querySelector('#relatedVideoCard');
    article.querySelector('[data-e2e="feed-comment-icon"]').onclick = () => { comments.hidden = !comments.hidden; };
    article.querySelector('svg').onclick = () => { comments.hidden = true; };
    article.querySelector('.xgplayer-fullscreen').onclick = () => feed.classList.add('isCssFullScreen');
  }
  feed.querySelector('[data-e2e="video-switch-next-arrow"]').onclick = () => {
    feed.querySelector('[data-e2e="feed-active-video"]').dataset.e2e = 'feed-video';
    feed.querySelector('[data-e2e-vid="2"]').dataset.e2e = 'feed-active-video';
    document.querySelector('#track').style.transform = 'translate3d(0px,' + -innerHeight + 'px,0px)';
  };
</script>`;

async function main() {
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  try {
    const context = await browser.newContext({ hasTouch:true, viewport:{width:1040,height:670} });
    await context.addInitScript({path:userscript});
    await context.route(url, route => route.fulfill({ contentType:'text/html', body:markup }));
    const page = await context.newPage();
    await page.goto(url);
    const cdp = await context.newCDPSession(page);
    const guide = page.locator('#douyin-touch-guide');
    const spot = guide.locator('.dt-guide-spot');
    const card = guide.locator('.dt-guide-card');
    async function step(index) {
      await guide.getByRole('heading', { name:labels[index], exact:true }).waitFor({ timeout:5000 });
      const [a,b] = await Promise.all([spot.boundingBox(), card.boundingBox()]);
      assert.ok(a && b);
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
      assert.equal(await spot.evaluate(el => getComputedStyle(el).borderTopStyle), 'dashed');
    }
    async function drag(dx,dy) {
      const r = await spot.boundingBox();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', {type,touchPoints});
      await send('touchStart', [{ x,y,id:1 }]);
      await send('touchMove', [{ x:x + dx,y:y + dy,id:1 }]);
      await send('touchEnd', []);
    }

    assert.equal(await guide.isVisible(), false);
    await page.locator('#native').click();
    await step(0);
    const sidebar = page.locator('#douyin-touch-sidebar-toggle');
    await sidebar.tap();
    await guide.getByText(/导航已展开/).waitFor();
    await sidebar.tap();
    await step(1);
    await drag(-130,0);
    await step(2);
    await drag(110,0);
    await step(3);
    await drag(0,-150);
    await step(4);
    await drag(155,0);
    await step(5);
    await page.locator('[data-e2e="feed-active-video"] .xgplayer-fullscreen').click();
    await guide.getByText(/停 3 秒/).waitFor({timeout:5000});
    await guide.waitFor({state:'detached',timeout:6000});
    assert.equal(await page.evaluate(() => localStorage.getItem('douyin-touch-guide-v1')), 'seen');
    await page.reload();
    await page.locator('#native').click();
    assert.equal(await guide.count(),0);
    await page.evaluate(() => localStorage.removeItem('douyin-touch-guide-v1'));
    await page.setViewportSize({width:470,height:430});
    await page.reload();
    await page.locator('#native').click();
    await step(0);
    await guide.getByRole('button',{name:'下一步'}).click();
    await step(1);
    await guide.getByRole('button',{name:'跳过'}).click();
    await guide.waitFor({state:'detached'});
    console.log('原生引导避让、六步实际手势、窄屏布局、自动关闭和记住完成状态均通过');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
