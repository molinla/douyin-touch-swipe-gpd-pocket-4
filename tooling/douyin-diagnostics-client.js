  // 诊断版仅发送触控与布局数据。内容、账号和网址参数不会写入日志。
  const diagnostic = (() => {
    const endpoint = __DIAG_URL__;
    const build = __DIAG_BUILD__;
    const session = Math.random().toString(36).slice(2, 12);
    let current = null;
    let number = 0;
    let received = 0;
    let ready = false;
    let badge = null;

    const round = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
    const localElements = new WeakMap();
    let lastElement = 0;
    function elementNumber(element) {
      if (!element) return null;
      if (!localElements.has(element)) localElements.set(element, ++lastElement);
      return localElements.get(element);
    }

    function show(text) {
      if (!document.body || !isRecommendPage()) return;
      if (!badge) {
        badge = document.createElement('div');
        Object.assign(badge.style, {
          position: 'fixed', bottom: '12px', left: '8px', zIndex: '11000', pointerEvents: 'none',
          padding: '4px 8px', borderRadius: '6px', background: '#252732', color: 'white',
          font: '12px/1.4 system-ui, sans-serif',
        });
        document.body.append(badge);
      }
      badge.textContent = text;
    }

    function send(report, done) {
      const failed = () => show('触控诊断未连接');
      try {
        GM_xmlhttpRequest({
          method: 'POST', url: endpoint, anonymous: true,
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({ ...report, session, build, source: 'browser' }),
          onload: ({ status }) => status === 204 ? done() : failed(),
          onerror: failed, onabort: failed, ontimeout: failed,
        });
      } catch { failed(); }
    }

    function connect() {
      if (ready || !isRecommendPage() || !document.body) return;
      ready = true;
      show('触控诊断正在连接');
      send({ kind: 'ready', viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, touchPoints: navigator.maxTouchPoints },
        () => show(`触控诊断 ${build} 已连接`));
    }

    function position(log) {
      const active = document.querySelector(ACTIVE_VIDEO);
      const track = log.track || active?.closest(SLIDE)?.parentElement;
      const card = log.card || active?.closest(SLIDE);
      if (!track || !card) return { track: false };
      const bounds = card.getBoundingClientRect();
      const css = getComputedStyle(track);
      const nativeY = (value) => {
        try { return round(transformY(value)); } catch { return null; }
      };
      return {
        card: elementNumber(card), active: elementNumber(active?.closest(SLIDE)),
        connected: card.isConnected, cardTop: round(bounds.top), cardHeight: round(bounds.height),
        inlineY: nativeY(track.style.transform), computedY: nativeY(css.transform),
        translateY: css.translate === 'none' ? 0 : round(parseFloat(css.translate.split(' ')[1] || '0')),
        index: [...track.children].filter(node => node.matches(SLIDE)).indexOf(card),
        waiting: waitingTrack === track,
      };
    }

    function mark(log, stage, data = {}) {
      if (!log || log.sent || log.steps.length >= 92) return;
      log.steps.push({ t: round(performance.now() - log.start), stage, ...data });
    }

    function begin(event, point) {
      connect();
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest(SLIDE);
      const log = {
        number: ++number, start: performance.now(), x: point.clientX, y: point.clientY,
        card, track: card?.parentElement, steps: [], counts: {}, lastMove: {},
      };
      current = log;
      mark(log, 'start-position', {
        target: target?.localName || '?', inSlide: Boolean(card),
        inComments: Boolean(target?.closest(COMMENT_PANEL)), onControl: Boolean(target?.closest(CONTROLS)),
        touchAction: target ? getComputedStyle(target).touchAction : null,
        ...position(log),
      });
      return log;
    }

    function end(log) {
      if (log.ending) return;
      log.ending = true;
      for (const delay of [0, 90, 300, 650]) {
        setTimeout(() => mark(log, 'position', { delay, ...position(log) }), delay);
      }
      setTimeout(() => {
        log.sent = true;
        if (!log.counts.touchmove && !log.counts.pointermove) return;
        send({ kind: 'gesture', number: log.number, counts: log.counts, steps: log.steps },
          () => show(`触控诊断 ${build} 已收到 ${++received} 次`));
      }, 720);
    }

    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      window.addEventListener(name, (event) => {
        if (!isRecommendPage() || (name.startsWith('pointer') && !['touch', 'pen'].includes(event.pointerType))) return;
        const point = event.changedTouches?.[0] || event.touches?.[0] || event;
        let log = current;
        if (name === 'pointerdown' || (name === 'touchstart' && (!log || log.ending))) log = begin(event, point);
        if (!log || log.sent) return;
        log.counts[name] = (log.counts[name] || 0) + 1;
        const move = name.endsWith('move');
        const now = performance.now();
        if (!move || log.counts[name] <= 10 || now - (log.lastMove[name] || 0) >= 70) {
          log.lastMove[name] = now;
          const dx = round(point.clientX - log.x);
          const dy = round(point.clientY - log.y);
          queueMicrotask(() => mark(log, name, { dx, dy, cancelable: event.cancelable, prevented: event.defaultPrevented, contacts: event.touches?.length ?? null }));
        }
        if (name.endsWith('up') || name.endsWith('end') || name.endsWith('cancel')) end(log);
      }, { capture: true, passive: true });
    }

    window.addEventListener('DOMContentLoaded', connect);
    window.navigation?.addEventListener('navigatesuccess', connect);
    if (document.readyState !== 'loading') connect();
    return { record: (stage, data) => mark(current, stage, data) };
  })();
