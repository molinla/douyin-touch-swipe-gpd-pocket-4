// ==UserScript==
// @name         抖音触屏优化GPD Pocket 4专版
// @namespace    local.douyin-touch-swipe
// @version      1.4.5
// @homepageURL  https://github.com/molinla/douyin-touch-swipe-gpd-pocket-4
// @supportURL   https://github.com/molinla/douyin-touch-swipe-gpd-pocket-4/issues
// @description  为 GPD Pocket 4 优化抖音网页版推荐页。触屏切换视频和直播、开关评论、长按倍速、拖动进度、进入时自动解除静音，全屏空闲时自动隐藏控件。
// @match        https://www.douyin.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const LIST = '[data-e2e="slideList"], #slidelist';
  const SLIDE = '[data-e2e="feed-item"], .dySwiperSlide.page-recommend-container';
  const ACTIVE_VIDEO = '[data-e2e="feed-active-video"]';
  const LIVE = '[data-e2e="feed-live"]';
  const COMMENT_BUTTON = '[data-e2e="feed-comment-icon"]';
  const SPEED_BUTTONS = `${COMMENT_BUTTON}, [data-e2e="video-player-collect"], [data-e2e="video-avatar"]`;
  const COMMENT_PANEL = '#relatedVideoCard';
  const COMMENT_LIST = '[data-e2e="comment-list"], .comment-mainContent';
  const COMMENT_AREA = '[data-e2e^="comment-"], .comment-mainContent';
  const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"]';
  const CONTROLS = [
    'a[href]:not([data-e2e="live-slider"])', 'button', EDITABLE,
    '[role="button"]', '[role="dialog"]', '[role="tablist"]',
    'xg-controls', 'xg-inner-controls', 'xg-outer-controls', 'xg-progress', 'xg-icon',
    '.xgplayer-controls', '.xgplayer-progress', '.douyin-player-controls',
    '[data-e2e^="feed-comment-"]', '.comment-input-container',
  ].join(', ');
  const DRAG_START = 8;
  const VERTICAL_SWIPE_PX = 48;
  const CONTROLS_IDLE_MS = 3000;
  const HIDE_CONTROLS = 'data-douyin-touch-controls-idle';
  const PROGRESS = 'xg-progress, .xgplayer-progress';
  const PLAYER_CONTROLS = `xg-controls, .xgplayer-controls, xg-inner-controls, xg-outer-controls,
    ${PROGRESS}, .xg-mini-progress, .xgplayer-mini-progress`;
  const FEED_OVERLAYS = '.player-position-box-bottom, .positionBox.immersive-player-switch-on-hide-interaction-area';
  const SEEK_TOUCH_SCALE = 1.8;
  const SEEK_DRAG_START = 4;
  const SEEK_CANCEL_DISTANCE = 48;
  const SEEK_CANCEL_RETURN = 34;
  const SCRUBBING = 'data-douyin-touch-scrubbing';
  const FULLSCREEN_DISPLAY = matchMedia('(display-mode: fullscreen)');
  const AXIS_RATIO = 1.35;
  const HOLD_MS = 330;
  const EDGE_FRACTION = 0.20;
  const MOTION_ID = 'douyin-touch-swipe';

  let gesture = null;
  let waitingTrack = null;
  let seeking = null;
  let seekTouchId = null;

  function isRecommendPage() {
    return location.pathname === '/' && new URLSearchParams(location.search).get('recommend') === '1';
  }

  function installInitialAudio() {
    const selector = `#slidelist ${ACTIVE_VIDEO} .xgplayer video`;
    const controller = new AbortController();
    const options = { capture: true, passive: true, signal: controller.signal };
    let pending = false;
    let needsInteraction = false;
    let retryOnInteraction = false;

    function currentVideo() {
      return isRecommendPage() && !document.hidden ? document.querySelector(selector) : null;
    }

    async function enableAudio(video, fromInteraction = false) {
      if (controller.signal.aborted || !video || video.paused || video.volume === 0
        || (needsInteraction && !fromInteraction)) return;
      const player = window.player;
      if (player?.video === video && player.musicMute) return;
      if (pending) {
        if (fromInteraction) retryOnInteraction = true;
        return;
      }
      if (!video.muted) {
        controller.abort();
        return;
      }

      pending = true;
      video.muted = false;
      try {
        await video.play();
        if (currentVideo() === video && !video.muted) controller.abort();
      } catch (error) {
        if (controller.signal.aborted) return;
        needsInteraction = error.name === 'NotAllowedError';
        video.muted = true;
        if (currentVideo() === video && video.paused) void video.play().catch(() => {});
      } finally {
        pending = false;
        if (retryOnInteraction) {
          retryOnInteraction = false;
          void enableAudio(currentVideo(), true);
        }
      }
    }

    window.addEventListener('timeupdate', (event) => {
      if (event.target instanceof HTMLVideoElement && event.target.matches(selector)
        && isRecommendPage() && !document.hidden) void enableAudio(event.target);
    }, options);
    function onInteraction(event) {
      if (!event.isTrusted) return;
      const video = currentVideo();
      if (!video) return;
      if (event.target instanceof Element && event.target.closest('xg-volume, .xgplayer-volume')) {
        if (event.type === 'click' || (event.type === 'keydown' && ['Enter', ' '].includes(event.key))) {
          controller.abort();
        }
        return;
      }
      if (!navigator.userActivation || navigator.userActivation.isActive) void enableAudio(video, true);
    }
    for (const name of ['pointerup', 'touchend', 'keydown', 'click']) {
      window.addEventListener(name, onInteraction, options);
    }
  }

  installInitialAudio();

  function installSidebarToggle() {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'douyin-touch-sidebar-toggle';
    button.setAttribute('aria-controls', 'douyin-navigation');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);

    const style = document.createElement('style');
    const idlePlayer = `#slidelist .xgplayer[${HIDE_CONTROLS}]`;
    const idleControls = `${idlePlayer} :is(${PLAYER_CONTROLS}),
      #slidelist .basePlayerContainer:has([${HIDE_CONTROLS}]) :is(${FEED_OVERLAYS})`;
    style.textContent = `
      [data-douyin-touch-nav="collapsed"] {
        --navigation-width: 52px;
        --navigation-expend-width: 52px;
      }
      [data-douyin-touch-nav="collapsed"] > #douyin-navigation {
        flex: 0 0 52px !important;
        visibility: hidden !important;
      }
      [data-douyin-touch-nav] :is(.playerContainer, .slider-video, .xgplayer, [data-e2e="feed-live"]) {
        touch-action: pinch-zoom;
      }
      #slidelist:is(:fullscreen, .isCssFullScreen, .isFullScreen) { touch-action: pinch-zoom; }
      #slidelist :is([data-e2e="comment-list"], .comment-mainContent) { touch-action: pan-y pinch-zoom; }
      :is(${idleControls}) {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transition: none !important;
      }
      :is(${idleControls}) * {
        visibility: hidden !important;
        pointer-events: none !important;
      }
      /* 全屏隐藏底栏后，释放播放器为控制区预留的底部空间。 */
      ${idlePlayer} :is(xg-video-container, .xg-video-container) {
        bottom: 0 !important;
        height: 100% !important;
      }
      ${idlePlayer} video {
        object-fit: contain !important;
        object-position: center !important;
      }
      #slidelist [${SCRUBBING}] :is(xg-progress, .xgplayer-progress) { opacity: 0 !important; }
      .douyin-touch-scrub-preview {
        position: absolute;
        z-index: 200;
        height: 8px;
        translate: 0 -50%;
        border-radius: 999px;
        background: rgba(254, 44, 85, .38);
        box-shadow: 0 1px 5px rgba(0, 0, 0, .45);
        pointer-events: none;
      }
      .douyin-touch-scrub-fill, .douyin-touch-scrub-thumb {
        position: absolute;
        border-radius: 999px;
        background: #fe2c55;
      }
      .douyin-touch-scrub-fill { inset: 0 auto 0 0; width: var(--douyin-touch-seek-position); }
      .douyin-touch-scrub-thumb {
        top: 50%;
        left: clamp(9px, var(--douyin-touch-seek-position), calc(100% - 9px));
        translate: -50% -50%;
        box-sizing: border-box;
        width: 18px;
        height: 18px;
        border: 2px solid #fff;
        box-shadow: 0 1px 6px rgba(0, 0, 0, .55);
      }
      .douyin-touch-scrub-label {
        position: absolute;
        bottom: calc(100% + 14px);
        left: clamp(56px, var(--douyin-touch-seek-position), calc(100% - 56px));
        translate: -50% 0;
        display: grid;
        justify-items: center;
        gap: 3px;
        padding: 7px 12px;
        border-radius: 10px;
        background: rgba(20, 21, 30, .94);
        color: #fff;
        white-space: nowrap;
        box-shadow: 0 2px 10px rgba(0, 0, 0, .35);
      }
      .douyin-touch-scrub-time { font: 700 16px/1.2 system-ui, sans-serif; font-variant-numeric: tabular-nums; }
      .douyin-touch-scrub-hint { color: rgba(255, 255, 255, .76); font: 12px/1.2 system-ui, sans-serif; }
      .douyin-touch-scrub-preview[data-cancelled] :is(.douyin-touch-scrub-fill, .douyin-touch-scrub-thumb) { opacity: .52; }
      .douyin-touch-scrub-preview[data-cancelled] .douyin-touch-scrub-hint { color: #ffb1c1; font-weight: 700; }
      #douyin-touch-sidebar-toggle {
        position: fixed;
        z-index: 503;
        top: 6px;
        left: calc(var(--navigation-width, 72px) + 4px);
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        border-radius: 12px;
        color: var(--color-text-t1, #f2f2f4);
        background: var(--color-bg-comp-Fill_hover, rgba(242, 242, 244, .08));
        cursor: pointer;
        touch-action: manipulation;
      }
      #douyin-touch-sidebar-toggle[aria-expanded="false"] { left: 4px; }
      #douyin-touch-sidebar-toggle:hover,
      #douyin-touch-sidebar-toggle:active { background: var(--semi-color-fill-1, rgba(242, 242, 244, .16)); }
      #douyin-touch-sidebar-toggle:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
      #douyin-touch-sidebar-toggle > span {
        position: relative;
        box-sizing: border-box;
        width: 22px;
        height: 17px;
        border: 1.5px solid currentColor;
        border-radius: 4px;
        pointer-events: none;
      }
      #douyin-touch-sidebar-toggle > span::before,
      #douyin-touch-sidebar-toggle > span::after { content: ''; position: absolute; }
      #douyin-touch-sidebar-toggle > span::before { top: 0; bottom: 0; left: 5px; border-left: 1.5px solid currentColor; }
      #douyin-touch-sidebar-toggle > span::after {
        top: 50%;
        left: 12px;
        width: 4px;
        height: 4px;
        border-top: 1.5px solid currentColor;
        border-right: 1.5px solid currentColor;
        transform: translate(-50%, -50%) rotate(45deg);
      }
      #douyin-touch-sidebar-toggle[aria-expanded="true"] > span::after { transform: translate(-50%, -50%) rotate(225deg); }
    `;

    let expanded = false;
    let layout = null;
    let sidebar = null;

    function render() {
      layout.setAttribute('data-douyin-touch-nav', expanded ? 'expanded' : 'collapsed');
      const label = expanded ? '收起左侧导航' : '展开左侧导航';
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', label);
      button.title = label;
    }

    button.addEventListener('click', () => {
      expanded = !expanded;
      render();
    });
    window.addEventListener('keydown', (event) => {
      if (event.target !== button || (event.key !== 'Enter' && event.key !== ' ')) return;
      consume(event);
      if (!event.repeat) button.click();
    }, { capture: true });

    function sync() {
      if (!isRecommendPage()) {
        if (!layout) return;
        button.remove();
        layout.removeAttribute('data-douyin-touch-nav');
        layout = null;
        sidebar = null;
        expanded = false;
        return;
      }
      if (document.head && !style.isConnected) document.head.append(style);
      if (button.isConnected && sidebar?.isConnected) return;

      const navigation = document.getElementById('douyin-navigation');
      const nextLayout = navigation?.parentElement;
      if (!nextLayout?.querySelector(':scope > #douyin-right-container')) return;
      if (layout !== nextLayout) layout?.removeAttribute('data-douyin-touch-nav');
      layout = nextLayout;
      sidebar = navigation;
      render();
      sidebar.after(button);
    }

    new MutationObserver(sync).observe(document, { childList: true, subtree: true });
    window.navigation?.addEventListener('navigatesuccess', sync);
    window.addEventListener('popstate', sync);
    sync();
  }

  installSidebarToggle();

  function isFeedFullscreen(root) {
    if (!root) return false;
    const full = document.fullscreenElement;
    const player = window.player;
    const activePlayer = player?.root instanceof Element && root.contains(player.root);
    return root.classList.contains('isCssFullScreen') || root.classList.contains('isFullScreen')
      || Boolean(full && (full.contains(root) || root.contains(full)))
      || (activePlayer && (player.fullscreen === true || player.isPageFullScreen === true))
      || FULLSCREEN_DISPLAY.matches;
  }

  function installFullscreenControls() {
    let player = null;
    let timer = 0;
    let lastActivity = 0;
    const heldPointers = new Set();

    function hideWhenIdle() {
      timer = 0;
      if (!player || heldPointers.size) return;
      const remaining = CONTROLS_IDLE_MS - (performance.now() - lastActivity);
      if (remaining > 0) {
        timer = setTimeout(hideWhenIdle, remaining);
      } else {
        player.setAttribute(HIDE_CONTROLS, '');
      }
    }

    function reveal() {
      if (!player) return;
      player.removeAttribute(HIDE_CONTROLS);
      lastActivity = performance.now();
      if (!timer && !heldPointers.size) timer = setTimeout(hideWhenIdle, CONTROLS_IDLE_MS);
    }

    function sync() {
      const root = document.getElementById('slidelist');
      const next = isRecommendPage() && isFeedFullscreen(root) ? root.querySelector(`${ACTIVE_VIDEO} .xgplayer`) : null;
      if (player === next) return;
      clearTimeout(timer);
      timer = 0;
      player?.removeAttribute(HIDE_CONTROLS);
      player = next;
      heldPointers.clear();
      reveal();
    }

    function pointerActivity(event) {
      if (!player) return;
      if (event.type === 'pointerdown') heldPointers.add(event.pointerId);
      if (event.type === 'pointerup' || event.type === 'pointercancel') heldPointers.delete(event.pointerId);
      reveal();
    }

    const options = { capture: true, passive: true };
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      window.addEventListener(event, pointerActivity, options);
    }
    for (const event of ['keydown', 'wheel', 'touchstart', 'touchend', 'touchcancel']) {
      window.addEventListener(event, reveal, options);
    }
    window.addEventListener('blur', () => {
      heldPointers.clear();
      reveal();
    });
    document.addEventListener('fullscreenchange', sync);
    FULLSCREEN_DISPLAY.addEventListener('change', sync);
    window.navigation?.addEventListener('navigatesuccess', sync);
    new MutationObserver(sync).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-e2e'] });
    sync();
  }

  function getSwitchAction(swipe, next) {
    const selector = next
      ? '[data-e2e="video-switch-next-arrow"], .xgplayer-playswitch-next'
      : '[data-e2e="video-switch-prev-arrow"], .xgplayer-playswitch-prev';
    const visible = (arrow) => arrow.getClientRects().length > 0 && getComputedStyle(arrow).visibility === 'visible';
    const arrow = (swipe.fullscreen && [...swipe.card.querySelectorAll(selector)].find(visible))
      || [...swipe.list.querySelectorAll(selector)].find(visible)
      || [...document.querySelectorAll(selector)].find(visible);
    const key = next ? 'ArrowDown' : 'ArrowUp';
    const keyCode = next ? 40 : 38;
    const target = swipe.card.querySelector(ACTIVE_VIDEO) || swipe.card;
    const keyboard = () => target.dispatchEvent(new KeyboardEvent('keydown', {
      key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true,
    }));
    if (!arrow) return { run: keyboard };
    if (arrow.matches(':disabled, .disabled, [aria-disabled="true"]')) {
      return swipe.fullscreen && (next ? swipe.hasNext : swipe.hasPrevious) ? { run: keyboard } : null;
    }
    return { run: () => arrow.click(), fallback: swipe.fullscreen ? keyboard : null };
  }

  function setComments(video, open) {
    if (!video?.isConnected || !video.matches(ACTIVE_VIDEO)) return;
    const panel = video.querySelector(COMMENT_PANEL);
    const shell = panel?.closest('#videoSideCard, #videoSideBar') || panel;
    const bounds = shell?.getBoundingClientRect();
    const visible = bounds?.width > 24 && bounds.height > 0 && getComputedStyle(shell).visibility === 'visible';
    const commentTab = visible && panel.querySelector('[role="tab"][id="semiTabcomment"]');
    const commentSelected = commentTab && commentTab.getAttribute('aria-selected') === 'true';

    if (open) {
      if (!commentSelected) (commentTab || video.querySelector(COMMENT_BUTTON))?.click();
      return;
    }
    if (!visible) return;

    // 关闭图标与标签栏相邻，点击原控件以保留抖音自身的面板状态。
    const close = panel.querySelector('.semi-tabs + div > svg');
    if (close) close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    else if (commentSelected) video.querySelector(COMMENT_BUTTON)?.click();
  }

  function getDragAxis(dx, dy) {
    const x = Math.abs(dx);
    const y = Math.abs(dy);
    if (x >= DRAG_START && x >= y * AXIS_RATIO) return 'horizontal';
    if (y >= DRAG_START && y >= x * AXIS_RATIO) return 'vertical';
    return null;
  }

  function allowsAxis(swipe, axis, dx) {
    if (axis === 'vertical') return !swipe.fromPanel;
    return swipe.fromPanel ? dx > 0 : swipe.hasCommentButton;
  }

  function followFinger(swipe, dy) {
    const { track, height } = swipe;
    const hasNeighbor = dy < 0 ? swipe.hasNext : swipe.hasPrevious;
    const max = height * 0.9;
    const extent = height * 2;
    const expected = Math.max(-max, Math.min(max, hasNeighbor ? dy : dy * 0.24));
    const drift = track.style.transform === swipe.nativeTransform ? 0
      : transformY(getComputedStyle(track).transform) - swipe.nativeY;
    swipe.offset = Math.max(-extent, Math.min(extent, expected - drift));
    if (!swipe.preview) {
      // 独立的 translate 叠加到抖音的滚动轨道上，保留页面自己的 transform。
      swipe.preview = track.animate({ translate: [`0px ${-extent}px`, `0px ${extent}px`] }, {
        duration: extent * 2, fill: 'both', composite: 'add',
      });
      swipe.preview.pause();
    }
    swipe.preview.currentTime = extent + swipe.offset;
  }

  function settleOffset(swipe, offset = swipe.offset) {
    swipe.preview?.cancel();
    if (!offset || !swipe.track.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    swipe.track.animate({ translate: [`0px ${offset}px`, '0px 0px'] }, {
      id: MOTION_ID,
      duration: 210,
      easing: 'cubic-bezier(.2,.75,.25,1)',
      composite: 'add',
    });
  }

  function transformY(transform) {
    return transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
  }

  function nativeAlreadySwitched(swipe) {
    const { track } = swipe;
    if (track.style.transform === swipe.nativeTransform) return false;
    // 抖音触控也会推移轨道。只有接近一整张卡片的移动才算原生切换。
    return Math.abs(transformY(track.style.transform) - swipe.nativeY) >= swipe.height * 0.8;
  }

  function returnToOrigin(swipe) {
    const { track } = swipe;
    if (swipe.axis !== 'vertical' || !track.isConnected || track.style.transform === swipe.nativeTransform
      || nativeAlreadySwitched(swipe)) {
      settleOffset(swipe);
      return;
    }

    const before = transformY(getComputedStyle(track).transform);
    track.style.transform = swipe.nativeTransform;
    const after = transformY(getComputedStyle(track).transform);
    settleOffset(swipe, swipe.offset + before - after);
  }

  function finishSwipe(swipe, action) {
    if (!action) {
      returnToOrigin(swipe);
      return;
    }
    if (!swipe.preview) {
      action.run();
      return;
    }

    const { track } = swipe;
    const cssTransform = getComputedStyle(track).transform;
    const matrix = cssTransform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(cssTransform);
    const previousTransition = track.style.getPropertyValue('transition-property');
    const previousPriority = track.style.getPropertyPriority('transition-property');

    // 把跟手时的位移交给原生轨道，从当前位置开始只播放抖音自身的切换动画。
    track.style.setProperty('transition-property', 'none', 'important');
    swipe.preview.cancel();
    track.style.transform = matrix.translate(0, swipe.offset).toString();
    track.getBoundingClientRect();
    if (previousTransition) track.style.setProperty('transition-property', previousTransition, previousPriority);
    else track.style.removeProperty('transition-property');

    const beforeSwitch = track.style.transform;
    let fallback = action.fallback;
    let timeout;
    const observer = new MutationObserver(() => {
      if (track.style.transform === beforeSwitch) return;
      clearTimeout(timeout);
      observer.disconnect();
      waitingTrack = null;
    });
    function finishWaiting() {
      const stillOnSlide = track.isConnected && track.style.transform === beforeSwitch
        && (!swipe.activeVideo || swipe.activeVideo.matches(ACTIVE_VIDEO));
      if (fallback && stillOnSlide && isRecommendPage() && isFeedFullscreen(swipe.root)) {
        const retry = fallback;
        fallback = null;
        timeout = setTimeout(finishWaiting, 250);
        retry();
        return;
      }
      observer.disconnect();
      waitingTrack = null;
      if (track.isConnected && track.style.transform === beforeSwitch) track.style.transform = swipe.nativeTransform;
    }
    timeout = setTimeout(finishWaiting, fallback ? 350 : 250);
    waitingTrack = track;
    observer.observe(track, { attributes: true, attributeFilter: ['style'] });
    action.run();
  }

  function getSpeedVideo(card, x, y, fromSpeedButton) {
    if (card.querySelector(LIVE)) return null;
    const video = card.querySelector(`${ACTIVE_VIDEO} .xgplayer video`);
    if (!video || fromSpeedButton) return video;
    const rect = video.getBoundingClientRect();
    if (!rect.width || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return null;
    const fraction = (x - rect.left) / rect.width;
    return fraction <= EDGE_FRACTION || fraction >= 1 - EDGE_FRACTION ? video : null;
  }

  function engageSpeed(video) {
    const previousRate = video.playbackRate;
    if (previousRate === 2) return () => {};

    const player = window.player;
    const keyboard = player?.video === video ? player.getPlugin?.('keyboard') || player.plugins?.keyboard : null;
    if (keyboard?.config?.playbackRate === 2 && typeof keyboard.changePlaybackRate === 'function'
      && typeof keyboard.handleKeyUp === 'function') {
      // 复用方向键的长按阶段，跳过会改变进度的短按阶段。
      keyboard.changePlaybackRate();
      if (video.playbackRate === 2) return () => keyboard.handleKeyUp();
      keyboard.handleKeyUp();
    }

    video.playbackRate = 2;
    return () => { video.playbackRate = previousRate; };
  }

  function startSpeed(swipe) {
    const video = swipe.speedVideo;
    if (gesture !== swipe || !isRecommendPage() || !video.isConnected
      || !video.closest(ACTIVE_VIDEO) || swipe.track.style.transform !== swipe.nativeTransform) return;

    swipe.releaseSpeed = engageSpeed(video);
    const indicator = document.createElement('div');
    indicator.textContent = '2×';
    indicator.setAttribute('aria-hidden', 'true');
    Object.assign(indicator.style, {
      position: 'absolute', zIndex: '100', top: '18px', left: '50%', translate: '-50% 0',
      padding: '4px 12px', borderRadius: '16px', background: 'rgba(0,0,0,.72)', color: 'white',
      font: '600 15px/1.4 system-ui, sans-serif', pointerEvents: 'none',
    });
    swipe.speedIndicator = indicator;
    swipe.card.append(indicator);
  }

  function stopSpeed(swipe) {
    clearTimeout(swipe.speedTimer);
    if (!swipe.releaseSpeed) return false;
    const release = swipe.releaseSpeed;
    swipe.releaseSpeed = null;
    try {
      release();
    } finally {
      swipe.speedIndicator.remove();
    }
    return true;
  }

  function consume(event) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }

  function cancelGesture() {
    if (!gesture) return;
    const swipe = gesture;
    gesture = null;
    stopSpeed(swipe);
    returnToOrigin(swipe);
  }

  function seekFraction(scrub, x) {
    return Math.max(0, Math.min(1, (x - scrub.rail.left) / scrub.rail.width));
  }

  function seekAt(scrub, x) {
    const { media } = scrub;
    const duration = media.duration;
    if (!isRecommendPage() || !media.isConnected || !media.closest(ACTIVE_VIDEO)
      || !Number.isFinite(duration) || duration <= 0) return;
    const time = seekFraction(scrub, x) * duration;
    if (Math.abs(media.currentTime - time) > 0.05) media.currentTime = time;
  }

  function formatSeekTime(time) {
    const seconds = Math.floor(time);
    const hours = Math.floor(seconds / 3600);
    const parts = [Math.floor(seconds / 60) % 60, seconds % 60].map(part => String(part).padStart(2, '0'));
    if (hours) parts.unshift(String(hours));
    return parts.join(':');
  }

  function scrubPart(className) {
    const part = document.createElement('span');
    part.className = `douyin-touch-scrub-${className}`;
    return part;
  }

  function showScrub(scrub, x) {
    if (!scrub.preview) {
      const { player, rail, bar } = scrub;
      const rect = player.getBoundingClientRect();
      const preview = document.createElement('div');
      preview.className = 'douyin-touch-scrub-preview';
      preview.setAttribute('aria-hidden', 'true');
      Object.assign(preview.style, { left: `${rail.left - rect.left}px`, top: `${bar.top + bar.height / 2 - rect.top}px`, width: `${rail.width}px` });
      const label = scrubPart('label');
      scrub.time = scrubPart('time');
      scrub.hint = scrubPart('hint');
      label.append(scrub.time, scrub.hint);
      preview.append(scrubPart('fill'), scrubPart('thumb'), label);
      scrub.preview = preview;
      player.append(preview);
      player.setAttribute(SCRUBBING, '');
    }
    if (!scrub.cancelled || scrub.fraction === undefined) scrub.fraction = seekFraction(scrub, x);
    scrub.preview.style.setProperty('--douyin-touch-seek-position', `${scrub.fraction * 100}%`);
    scrub.preview.toggleAttribute('data-cancelled', scrub.cancelled);
    const time = formatSeekTime(scrub.fraction * scrub.duration);
    const hint = scrub.cancelled ? '松手取消' : '上滑取消';
    if (scrub.time.textContent !== time) scrub.time.textContent = time;
    if (scrub.hint.textContent !== hint) scrub.hint.textContent = hint;
  }

  function cancelScrub() {
    if (!seeking) return;
    const scrub = seeking;
    seeking = null;
    scrub.preview?.remove();
    scrub.player.removeAttribute(SCRUBBING);
  }

  function isScrubCancelled(scrub, y) {
    const distance = scrub.cancelled ? SEEK_CANCEL_RETURN : SEEK_CANCEL_DISTANCE;
    return scrub.startY - y >= distance;
  }

  function beginScrub(event) {
    if (seeking || !event.isPrimary || (event.pointerType !== 'touch' && event.pointerType !== 'pen')
      || !isRecommendPage() || !(event.target instanceof Element)) return;
    if (event.target.closest(`${COMMENT_PANEL}, ${SPEED_BUTTONS}`)) return;
    const card = event.target.closest(ACTIVE_VIDEO);
    const player = card?.querySelector('.xgplayer');
    if (!player) return;
    const progress = player.querySelector(PROGRESS);
    const media = player.querySelector('video');
    if (!progress || !media || !Number.isFinite(media.duration) || media.duration <= 0) return;
    const control = event.target.closest(`button, a[href], ${EDITABLE}, [role="button"], xg-icon`);
    if (control && !progress.contains(control)) return;

    const bar = progress.getBoundingClientRect();
    const rail = (progress.querySelector('.xgplayer-progress-outer') || progress).getBoundingClientRect();
    const padding = bar.height * (SEEK_TOUCH_SCALE - 1) / 2;
    const { clientX: x, clientY: y } = event;
    if (!bar.height || !rail.width || x < rail.left || x > rail.right || y < bar.top - padding || y > bar.bottom + padding) return;
    const hidden = player.hasAttribute(HIDE_CONTROLS) || getComputedStyle(progress).visibility !== 'visible';
    cancelGesture();
    seeking = {
      player, media, rail, bar, duration: media.duration, pointerId: event.pointerId, startX: x, startY: y,
      seekOnTap: !hidden && y >= bar.top && y <= bar.bottom,
      moved: false, cancelled: false,
    };
    consume(event);
    progress.setPointerCapture(event.pointerId);
  }

  function moveScrub(event) {
    const scrub = seeking;
    if (!scrub || event.pointerId !== scrub.pointerId) return;
    consume(event);
    if (!scrub.media.isConnected || !scrub.media.closest(ACTIVE_VIDEO)) {
      cancelScrub();
      return;
    }
    if (Math.abs(event.clientX - scrub.startX) >= SEEK_DRAG_START) scrub.moved = true;
    scrub.cancelled = isScrubCancelled(scrub, event.clientY);
    if (scrub.moved || scrub.cancelled || scrub.preview) showScrub(scrub, event.clientX);
  }

  function endScrub(event) {
    const scrub = seeking;
    if (!scrub || event.pointerId !== scrub.pointerId) return;
    consume(event);
    const shouldSeek = event.type === 'pointerup' && !isScrubCancelled(scrub, event.clientY)
      && (scrub.moved || (scrub.seekOnTap && !scrub.preview)
        || Math.abs(event.clientX - scrub.startX) >= SEEK_DRAG_START);
    cancelScrub();
    if (shouldSeek) seekAt(scrub, event.clientX);
  }

  function isSeekTouch(event, end = false) {
    if (seekTouchId === null || ![...event.changedTouches].some(touch => touch.identifier === seekTouchId)) return false;
    if (end) seekTouchId = null;
    consume(event);
    return true;
  }

  const scrubOptions = { capture: true, passive: false };
  window.addEventListener('pointerdown', beginScrub, scrubOptions);
  window.addEventListener('pointermove', moveScrub, scrubOptions);
  window.addEventListener('pointerup', endScrub, scrubOptions);
  window.addEventListener('pointercancel', endScrub, scrubOptions);
  window.addEventListener('blur', () => {
    cancelScrub();
    seekTouchId = null;
  });
  window.addEventListener('pagehide', cancelScrub);
  // 先判断落点是否命中已显示的进度条，再处理唤醒自动隐藏的控制区。
  installFullscreenControls();

  window.addEventListener('touchstart', (event) => {
    if (seeking || seekTouchId !== null) {
      if (seekTouchId === null) seekTouchId = event.changedTouches[0]?.identifier ?? null;
      consume(event);
      return;
    }
    if (event.touches.length > 1 && gesture) {
      stopSpeed(gesture);
      settleOffset(gesture);
      gesture.preview = null;
      gesture.offset = 0;
      gesture.multitouch = true;
      return;
    }
    cancelGesture();
    if (!isRecommendPage() || event.touches.length !== event.changedTouches.length) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    const fromPanel = Boolean(target.closest(COMMENT_PANEL));
    const fromSpeedButton = !fromPanel && Boolean(target.closest(SPEED_BUTTONS));
    const inCommentList = fromPanel && target.closest(COMMENT_LIST);
    if (target.closest(inCommentList || fromSpeedButton ? EDITABLE : CONTROLS)) return;
    if (!fromPanel && target.closest(COMMENT_AREA)) return;
    const root = target.closest('#slidelist');
    const fullscreen = isFeedFullscreen(root);
    const card = target.closest(SLIDE) || (fullscreen ? root.querySelector(ACTIVE_VIDEO)?.closest(SLIDE) : null);
    const list = card?.closest(LIST);
    const track = card?.parentElement;
    if (!list || list === track || (!fullscreen && list.getAttribute('data-active') === 'false')) return;
    if (track === waitingTrack || track.getAnimations().some((animation) =>
      animation.id === MOTION_ID || animation.transitionProperty === 'transform')) return;

    const touch = event.touches[0];
    const height = card.getBoundingClientRect().height;
    if (!height) return;
    const slides = [...track.children].filter((child) => child.matches(SLIDE));
    const index = slides.indexOf(card);
    const activeVideo = card.querySelector(ACTIVE_VIDEO);
    const swipe = {
      card, list, root, fullscreen, track, height, hasNext: index + 1 < slides.length, hasPrevious: index > 0,
      nativeTransform: track.style.transform, id: touch.identifier, x: touch.clientX, y: touch.clientY,
      nativeY: transformY(getComputedStyle(track).transform),
      started: performance.now(), offset: 0, axis: null, multitouch: event.touches.length > 1,
      fromPanel, fromSpeedButton, activeVideo, hasCommentButton: Boolean(activeVideo?.querySelector(COMMENT_BUTTON)),
    };
    gesture = swipe;
    if (swipe.multitouch || fromPanel) return;
    if (!fromSpeedButton) event.stopPropagation();
    swipe.speedVideo = getSpeedVideo(card, swipe.x, swipe.y, fromSpeedButton);
    if (swipe.speedVideo) swipe.speedTimer = setTimeout(() => startSpeed(swipe), HOLD_MS);
  }, { capture: true, passive: false });

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' && gesture && !gesture.fromPanel && !gesture.fromSpeedButton
      && !gesture.multitouch) event.stopPropagation();
  }, { capture: true, passive: true });

  window.addEventListener('touchmove', (event) => {
    if (isSeekTouch(event)) return;
    const swipe = gesture;
    if (!swipe) return;
    if (swipe.multitouch) {
      event.stopPropagation();
      return;
    }
    if (swipe.releaseSpeed) {
      consume(event);
      return;
    }
    const touch = event.touches[0];
    if (event.touches.length !== 1 || touch.identifier !== swipe.id || nativeAlreadySwitched(swipe)) {
      cancelGesture();
      return;
    }

    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (Math.hypot(dx, dy) >= DRAG_START) clearTimeout(swipe.speedTimer);
    if (swipe.fromSpeedButton) return;
    const axis = swipe.axis || getDragAxis(dx, dy);
    if (swipe.fromPanel && (!axis || axis === 'vertical')) {
      swipe.axis = axis;
      // 评论滚动交给浏览器，避免外层推荐流接管纵向手势。
      event.stopPropagation();
      return;
    }
    if (!axis) {
      event.stopPropagation();
      return;
    }
    if (!allowsAxis(swipe, axis, dx)) {
      cancelGesture();
      return;
    }
    swipe.axis = axis;
    consume(event);
    if (axis === 'vertical') followFinger(swipe, dy);
  }, { capture: true, passive: false });

  window.addEventListener('touchend', (event) => {
    if (isSeekTouch(event, true)) return;
    const swipe = gesture;
    if (!swipe) return;
    if (swipe.multitouch) {
      if (!event.touches.length) gesture = null;
      event.stopPropagation();
      return;
    }
    gesture = null;
    if (stopSpeed(swipe)) {
      consume(event);
      return;
    }
    if (swipe.fromSpeedButton) return;

    const touch = [...event.changedTouches].find((point) => point.identifier === swipe.id);
    if (!touch || event.touches.length) {
      returnToOrigin(swipe);
      return;
    }
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    const axis = swipe.axis || getDragAxis(dx, dy);
    if (swipe.fromPanel && axis === 'vertical') {
      event.stopPropagation();
      return;
    }
    if (!axis || !allowsAxis(swipe, axis, dx)) return;
    const horizontal = axis === 'horizontal';
    const distance = Math.abs(horizontal ? dx : dy);
    const crossDistance = Math.abs(horizontal ? dy : dx);
    const threshold = horizontal ? 64 : VERTICAL_SWIPE_PX;
    const flick = distance >= 42 && performance.now() - swipe.started <= 200;
    const shouldSwitch = (distance >= threshold || flick) && distance >= crossDistance * AXIS_RATIO;
    if (!swipe.axis && !shouldSwitch) return;
    consume(event);

    const canSwitch = shouldSwitch && isRecommendPage() && swipe.card.isConnected
      && !nativeAlreadySwitched(swipe);
    if (horizontal) {
      if (canSwitch) setComments(swipe.activeVideo, dx < 0);
      return;
    }
    finishSwipe(swipe, canSwitch ? getSwitchAction(swipe, dy < 0) : null);
  }, { capture: true, passive: false });

  window.addEventListener('contextmenu', (event) => {
    if (gesture?.releaseSpeed && gesture.card.contains(event.target)) consume(event);
  }, { capture: true });
  window.addEventListener('touchcancel', (event) => {
    if (isSeekTouch(event, true)) cancelScrub();
    else cancelGesture();
  }, { capture: true, passive: false });
  window.addEventListener('blur', cancelGesture);
  window.addEventListener('pagehide', cancelGesture);
})();
