(function () {
  'use strict';

  let pipWin = null, placeholder = null, origStyle = '';
  let isClickThrough = false, videoObserver = null;
  let _clickCount = 0, _clickTimer = null, _hintTimer = null;
  let _ctWatchdog = null;
  let pipTitleTag = null; // eindeutige Kennung des PiP-Fensters für den Native Host

  function toSW(msg) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ target: 'ytfloat-sw', ...msg }, (r) => {
        const err = chrome.runtime.lastError;
        if (err) { resolve({ ok: false, error: err.message }); return; }
        resolve(r || { ok: false, error: 'no_response' });
      });
    });
  }

  function pipBounds() {
    if (!pipWin) return null;
    return { x: pipWin.screenX, y: pipWin.screenY, w: pipWin.outerWidth, h: pipWin.outerHeight };
  }

  // Baut die Nachricht an den Native Host: immer Titel-Marker (zuverlässig,
  // DPI-unabhängig) + aktuelle Bounds als Fallback mitschicken.
  function ctPayload(base) {
    const msg = Object.assign({}, base);
    const b = pipBounds();
    if (b) Object.assign(msg, b);
    if (pipTitleTag) msg.title = pipTitleTag;
    return msg;
  }

  // Wird vom Service Worker aufgerufen, wenn der Native Host Click-Through
  // von AUSSERHALB des Browsers umgeschaltet hat (globaler Alt+P-Hotkey).
  function syncCTFromHost(active) {
    if (!pipWin || isClickThrough === active) return;
    isClickThrough = active;
    const body = pipWin.document.body;
    const bar  = pipWin.document.getElementById('ytf-bar');
    const ctrl = pipWin.document.getElementById('ytf-ctrl');
    const ctBtn = pipWin.document.getElementById('ytf-ct');
    if (active) {
      body.style.webkitAppRegion = 'no-drag';
      body.classList.add('ytf-ct-active', 'ytf-ct-native');
      if (ctBtn) ctBtn.classList.add('ytf-on');
      if (bar)  { bar.style.display = 'none'; bar.style.pointerEvents = 'none'; }
      if (ctrl) { ctrl.style.display = 'none'; ctrl.style.pointerEvents = 'none'; }
      startCTWatchdog();
    } else {
      body.style.webkitAppRegion = 'drag';
      body.style.pointerEvents = '';
      body.classList.remove('ytf-ct-active', 'ytf-ct-native');
      if (ctBtn) ctBtn.classList.remove('ytf-on');
      if (bar)  { bar.style.display = ''; bar.style.opacity = ''; bar.style.pointerEvents = ''; }
      if (ctrl) { ctrl.style.display = ''; ctrl.style.pointerEvents = ''; }
      stopCTWatchdog();
    }
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'ytfloat-ct-sync') syncCTFromHost(!!msg.active);
  });

  // ── Float-Button + YT autohide sync ───────────────────────────────────────
  function tryInject() {
    if (document.getElementById('ytf-trigger')) return;
    const player = document.getElementById('movie_player');
    if (!player) return;

    const btn = document.createElement('button');
    btn.id = 'ytf-trigger';
    btn.title = 'Float (Alt+F)';
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
      <rect x="1" y="3" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <rect x="9" y="9" width="9" height="7" rx="1.5" fill="currentColor" opacity="0.85"/>
    </svg> Float`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFloat(); });
    player.appendChild(btn);

    const syncVis = () => {
      const hidden = player.classList.contains('ytp-autohide');
      btn.style.opacity = hidden ? '0' : '1';
      btn.style.pointerEvents = hidden ? 'none' : 'auto';
    };
    syncVis();
    new MutationObserver(syncVis).observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  // ── Hotkeys ───────────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFloat(); }
  }, true);

  function toggleFloat() {
    if (pipWin && !pipWin.closed) closeFloat(false);
    else openFloat();
  }

  // ── Open Float ────────────────────────────────────────────────────────────
  async function openFloat() {
    if (pipWin && !pipWin.closed) return;
    const video = document.querySelector('video');
    if (!video) return;
    if (!window.documentPictureInPicture) { alert('Bitte Brave/Chrome 116+ verwenden.'); return; }

    const wasPlaying = !video.paused;
    origStyle = video.getAttribute('style') || '';
    placeholder = document.createElement('div');
    placeholder.id = 'ytf-placeholder';
    video.parentNode.replaceChild(placeholder, video);



    const vRatio = (video.videoWidth || 1280) / (video.videoHeight || 720);
    const pipW   = Math.min(520, Math.round(window.innerWidth * 0.38));
    const pipH   = Math.round(pipW / vRatio);

    pipWin = await window.documentPictureInPicture.requestWindow({
      width: pipW, height: pipH, disallowReturnToOpener: false,
    });

    // Eindeutiger Marker im Fenstertitel: der Native Host findet das Fenster
    // darüber zuverlässig wieder, statt fehleranfällig über Bounds+Toleranz.
    pipTitleTag = 'ytfloat-pip-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    try { pipWin.document.title = pipTitleTag; } catch (e) {}

    const style = pipWin.document.createElement('style');
    style.id = 'ytf-style';
    style.textContent = pipCSS();
    pipWin.document.head.appendChild(style);

    video.style.cssText = `position:absolute;inset:0;width:100%;height:100%;
      display:block;object-fit:contain;margin:0;transform:none;
      clip-path:none;cursor:pointer;-webkit-app-region:no-drag;`;
    pipWin.document.body.appendChild(video);

    if (wasPlaying) video.play().catch(() => {});

    // capture:true + stopImmediatePropagation prevents YT from overriding our action
    video.addEventListener('click', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (video.paused) { video.play(); showPPIcon(false); }
      else              { video.pause(); showPPIcon(true); }
    }, true);
    video.addEventListener('play',  () => showPPIcon(false));
    video.addEventListener('pause', () => showPPIcon(true));
    video.addEventListener('timeupdate', updateCtrlBar);

    // Top-right dot bar
    const bar = pipWin.document.createElement('div');
    bar.id = 'ytf-bar';

    // Transparenz-Slider (Video/Fenster durchsichtiger machen)
    const opWrap = pipWin.document.createElement('div'); opWrap.id = 'ytf-op-wrap';
    opWrap.title = 'Transparenz';
    const opIcon = pipWin.document.createElement('span'); opIcon.id = 'ytf-op-icon'; opIcon.innerHTML = icoOpacity();
    const opSlider = pipWin.document.createElement('input');
    opSlider.type = 'range'; opSlider.id = 'ytf-op-slider';
    opSlider.min = '30'; opSlider.max = '100'; opSlider.value = '100'; opSlider.step = '1';
    opSlider.addEventListener('mousedown', (e) => e.stopPropagation());
    opSlider.addEventListener('input', (e) => { e.stopPropagation(); setPipOpacity(Number(opSlider.value)); });
    opWrap.append(opIcon, opSlider);
    bar.appendChild(opWrap);

    const mkDot = (id, svg, tip, fn) => {
      const b = pipWin.document.createElement('button');
      b.id = id; b.className = 'ytf-dot'; b.innerHTML = svg; b.title = tip;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      bar.appendChild(b); return b;
    };
    const ctBtn = mkDot('ytf-ct',   icoClick(), 'Click-Through (Alt+P, auch außerhalb des Browsers)', () => toggleCT(ctBtn));
    mkDot('ytf-crop',  icoCrop(),  'Schwarze Ränder entfernen',  () => doCrop(video));
    mkDot('ytf-close', icoClose(), 'Schließen (Alt+F)',          () => closeFloat(false));
    pipWin.document.body.appendChild(bar);

    // PP overlay
    const pp = pipWin.document.createElement('div');
    pp.id = 'ytf-pp';
    pipWin.document.body.appendChild(pp);

    // Bottom control bar
    buildCtrlBar(video);

    // Hotkeys inside pip
    pipWin.document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); toggleCT(ctBtn); }
      if (e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); closeFloat(false); }
    }, true);
    const mainKeyHandler = (e) => {
      if (e.altKey && e.key.toLowerCase() === 'p' && isClickThrough) { e.preventDefault(); toggleCT(ctBtn); }
    };
    document.addEventListener('keydown', mainKeyHandler, true);

    pipWin.addEventListener('pagehide', () => {
      closeFloat(true);
      document.removeEventListener('keydown', mainKeyHandler, true);
    });

    watchVideoLocation(video);

    await new Promise(r => setTimeout(r, 300));
    toSW(ctPayload({ type: 'pip_opened' }));
  }

  // ── Control bar ───────────────────────────────────────────────────────────
  function buildCtrlBar(video) {
    if (!pipWin) return;
    const d = pipWin.document;
    const ctrl = d.createElement('div'); ctrl.id = 'ytf-ctrl';

    const prog = d.createElement('div'); prog.id = 'ytf-prog-wrap';
    prog.innerHTML = `<div id="ytf-prog-bg"><div id="ytf-prog-fill"></div><div id="ytf-prog-thumb"></div></div>`;

    const row   = d.createElement('div'); row.id = 'ytf-btns-row';
    const left  = d.createElement('div'); left.id  = 'ytf-btns-left';
    const right = d.createElement('div'); right.id = 'ytf-btns-right';

    const mkC = (id, svg, tip, fn) => {
      const b = d.createElement('button');
      b.id = id; b.className = 'ytf-dot'; b.innerHTML = svg; b.title = tip;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };

    const playBtn = mkC('ytf-play', video.paused ? icoPlay() : icoPause(), 'Play/Pause', () => {
      video.paused ? video.play() : video.pause();
    });
    video.addEventListener('play',  () => { playBtn.innerHTML = icoPause(); });
    video.addEventListener('pause', () => { playBtn.innerHTML = icoPlay(); });

    const back5 = mkC('ytf-back5', icoBack5(), '-5s', () => { video.currentTime = Math.max(0, video.currentTime - 5); });
    const fwd5  = mkC('ytf-fwd5',  icoFwd5(),  '+5s', () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); });

    const timeEl = d.createElement('span'); timeEl.id = 'ytf-time'; timeEl.textContent = '0:00 / 0:00';

    // Volume group
    const volGroup = d.createElement('div'); volGroup.id = 'ytf-vol-group';
    const muteBtn = mkC('ytf-mute', icoMute(), 'Ton', () => {
      video.muted = !video.muted;
      updateVolSlider();
    });
    const volWrap = d.createElement('div'); volWrap.id = 'ytf-vol-wrap';
    const volBg   = d.createElement('div'); volBg.id   = 'ytf-vol-bg';
    const volFill = d.createElement('div'); volFill.id = 'ytf-vol-fill';
    const volThumb= d.createElement('div'); volThumb.id= 'ytf-vol-thumb';
    volBg.append(volFill, volThumb);
    volWrap.appendChild(volBg);

    const updateVolSlider = () => {
      const pos = (video.muted || video.volume === 0) ? 0 : Math.sqrt(video.volume) * 100;
      volFill.style.width = pos.toFixed(1) + '%';
      volThumb.style.left = pos.toFixed(1) + '%';
      muteBtn.innerHTML = (video.muted || video.volume === 0) ? icoUnmute() : icoMute();
    };
    updateVolSlider();
    video.addEventListener('volumechange', updateVolSlider);

    let volSeeking = false;
    const seekVol = (e) => {
      const r = volBg.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      video.volume = pct * pct;
      video.muted  = (pct === 0);
      updateVolSlider();
    };
    volWrap.addEventListener('mousedown', (e) => { e.stopPropagation(); volSeeking = true; seekVol(e); });
    d.addEventListener('mousemove', (e) => { if (volSeeking) { e.stopPropagation(); seekVol(e); } });
    d.addEventListener('mouseup',   ()  => { volSeeking = false; });

    volGroup.append(muteBtn, volWrap);
    left.append(playBtn, back5, fwd5, timeEl);
    right.append(volGroup);
    row.append(left, right);
    ctrl.append(prog, row);
    d.body.appendChild(ctrl);

    let seeking = false;
    const seek = (e) => {
      const bg = d.getElementById('ytf-prog-bg');
      if (!bg) return;
      const r = bg.getBoundingClientRect();
      video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (video.duration || 0);
    };
    prog.addEventListener('mousedown', (e) => { seeking = true; seek(e); });
    d.addEventListener('mousemove', (e) => { if (seeking) seek(e); });
    d.addEventListener('mouseup',   ()  => { seeking = false; });

    updateCtrlBar();
  }

  function updateCtrlBar() {
    if (!pipWin) return;
    const video  = pipWin.document.querySelector('video');
    const fill   = pipWin.document.getElementById('ytf-prog-fill');
    const thumb  = pipWin.document.getElementById('ytf-prog-thumb');
    const timeEl = pipWin.document.getElementById('ytf-time');
    if (!video || !fill || !timeEl) return;
    const cur = video.currentTime || 0, dur = video.duration || 0;
    const pct = dur ? (cur / dur * 100).toFixed(2) : 0;
    fill.style.width = pct + '%';
    if (thumb) thumb.style.left = pct + '%';
    timeEl.textContent = fmt(cur) + ' / ' + fmt(dur);
  }

  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec);
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  // ── PP overlay ────────────────────────────────────────────────────────────
  function showPPIcon(isPause) {
    if (!pipWin) return;
    const icon = pipWin.document.getElementById('ytf-pp');
    if (!icon) return;
    icon.innerHTML = isPause
      ? `<svg viewBox="0 0 24 24" fill="white" width="36" height="36"><rect x="5" y="3" width="4" height="18" rx="1.5"/><rect x="15" y="3" width="4" height="18" rx="1.5"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="white" width="36" height="36"><path d="M6 4l14 8-14 8Z"/></svg>`;
    icon.style.opacity = '1';
    icon.style.transform = 'translate(-50%,-50%) scale(1)';
    clearTimeout(icon._t);
    icon._t = setTimeout(() => {
      icon.style.opacity = '0';
      icon.style.transform = 'translate(-50%,-50%) scale(0.82)';
    }, 650);
  }

  // ── Cinema mode guard ─────────────────────────────────────────────────────
  function reStealVideo(video) {
    if (!pipWin || pipWin.closed || pipWin.document.contains(video)) return;
    video.style.cssText = `position:absolute;inset:0;width:100%;height:100%;
      display:block;object-fit:contain;margin:0;transform:none;
      clip-path:none;cursor:pointer;-webkit-app-region:no-drag;`;
    const ctrl = pipWin.document.getElementById('ytf-ctrl');
    pipWin.document.body.insertBefore(video, ctrl || null);
  }

  function watchVideoLocation(video) {
    if (videoObserver) videoObserver.disconnect();
    videoObserver = new MutationObserver(() => reStealVideo(video));
    videoObserver.observe(document.body, { childList: true, subtree: true });
    const onYT = () => setTimeout(() => reStealVideo(video), 100);
    ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'].forEach(ev => {
      document.addEventListener(ev, onYT);
      pipWin.addEventListener('pagehide', () => document.removeEventListener(ev, onYT), { once: true });
    });
    const player = document.getElementById('movie_player');
    if (player) new MutationObserver(onYT).observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  // ── Close ─────────────────────────────────────────────────────────────────
  function closeFloat(alreadyClosed = false) {
    if (!pipWin) return;
    if (videoObserver) { videoObserver.disconnect(); videoObserver = null; }
    stopCTWatchdog();
    // Always send disable – native host needs to restore window style
    toSW(ctPayload({ type: 'disable_click_through' }));
    const video = pipWin.document.querySelector('video');
    const wasPlaying = video && !video.paused;
    if (video) {
      video.style.cssText = '';
      video.setAttribute('style', origStyle);
      if (placeholder && placeholder.parentNode) placeholder.parentNode.replaceChild(video, placeholder);
      if (wasPlaying) video.play().catch(() => {});
    }

    if (!alreadyClosed && !pipWin.closed) pipWin.close();
    pipWin = null; placeholder = null; isClickThrough = false; pipTitleTag = null;
  }

  // ── Transparenz ───────────────────────────────────────────────────────────
  function setPipOpacity(pct) {
    if (!pipWin) return;
    // Sofortiges optisches Feedback als Fallback, falls Native Host fehlt.
    pipWin.document.documentElement.style.opacity = (pct / 100).toFixed(2);
    // Echte OS-Fenstertransparenz (Desktop scheint durch) via Native Host.
    const alpha = Math.round(pct / 100 * 255);
    toSW(ctPayload({ type: 'set_opacity', alpha }));
  }

  // ── Click-Through ─────────────────────────────────────────────────────────
  let _ctBusy = false; // race-condition guard

  async function toggleCT(btn) {
    if (!pipWin || _ctBusy) return;
    _ctBusy = true;

    isClickThrough = !isClickThrough;
    const body = pipWin.document.body;
    const bar  = pipWin.document.getElementById('ytf-bar');
    const ctrl = pipWin.document.getElementById('ytf-ctrl');

    if (isClickThrough) {
      // ── ENABLE ──────────────────────────────────────────────────────────
      body.style.webkitAppRegion = 'no-drag';
      btn.classList.add('ytf-on');
      startClickHint();
      startCTWatchdog();

      const result = await toSW(ctPayload({ type: 'enable_click_through' }));

      if (result && result.ok) {
        // Native host: OS-level passthrough – hide everything
        body.classList.add('ytf-ct-active', 'ytf-ct-native');
        if (bar)  { bar.style.display  = 'none'; bar.style.pointerEvents  = 'none'; }
        if (ctrl) { ctrl.style.display = 'none'; ctrl.style.pointerEvents = 'none'; }
      } else {
        // CSS fallback: pointer-events:none on body + hide ctrl, keep bar accessible
        body.classList.add('ytf-ct-active'); // NUR diese Klasse, NICHT ytf-ct-native -> Leiste bleibt bedienbar
        body.style.pointerEvents = 'none';
        if (bar)  { bar.style.display = 'flex'; bar.style.opacity = '0.6'; bar.style.pointerEvents = 'all'; }
        if (ctrl) { ctrl.style.display = 'none'; }
        showCTNotice();
      }
    } else {
      // ── DISABLE ─────────────────────────────────────────────────────────
      body.style.webkitAppRegion = 'drag';
      body.style.pointerEvents   = '';
      body.classList.remove('ytf-ct-active', 'ytf-ct-native');
      if (bar)  { bar.style.display  = ''; bar.style.opacity  = ''; bar.style.pointerEvents  = ''; }
      if (ctrl) { ctrl.style.display = ''; ctrl.style.pointerEvents = ''; }
      btn.classList.remove('ytf-on');
      stopClickHint();
      stopCTWatchdog();
      hideCTNotice();
      toSW(ctPayload({ type: 'disable_click_through' }));
    }

    _ctBusy = false;
  }

  // ── CT Watchdog: re-applies every 1.5s if Chromium resets the style ─────────
  function startCTWatchdog() {
    stopCTWatchdog();
    _ctWatchdog = setInterval(async () => {
      if (!isClickThrough || !pipWin || pipWin.closed) { stopCTWatchdog(); return; }
      toSW(ctPayload({ type: 'enable_click_through' })); // fire-and-forget re-apply
    }, 1500);
  }

  function stopCTWatchdog() {
    if (_ctWatchdog) { clearInterval(_ctWatchdog); _ctWatchdog = null; }
  }

  function showCTNotice() {
    if (!pipWin) return;
    let n = pipWin.document.getElementById('ytf-ct-notice');
    if (!n) {
      n = pipWin.document.createElement('div');
      n.id = 'ytf-ct-notice';
      n.innerHTML = '⚠ Kein Native Host';
      n.style.cssText = `position:absolute;bottom:44px;left:50%;transform:translateX(-50%);
        background:rgba(30,30,30,0.82);color:rgba(255,255,255,0.65);
        font-size:10px;font-family:Arial,sans-serif;border-radius:5px;
        padding:3px 10px;pointer-events:none;white-space:nowrap;z-index:300;
        border:1px solid rgba(255,255,255,0.1);`;
      pipWin.document.body.appendChild(n);
    }
    n.style.display = 'block';
  }
  function hideCTNotice() {
    if (!pipWin) return;
    const n = pipWin.document.getElementById('ytf-ct-notice');
    if (n) n.style.display = 'none';
  }

  // ── Click hint ────────────────────────────────────────────────────────────
  function startClickHint() {
    _clickCount = 0;
    if (!pipWin) return;
    pipWin.document.addEventListener('click', onCtClick, true);
  }
  function stopClickHint() {
    if (pipWin) pipWin.document.removeEventListener('click', onCtClick, true);
    _clickCount = 0; clearTimeout(_clickTimer); clearTimeout(_hintTimer);
  }
  function onCtClick() {
    if (!isClickThrough) return;
    _clickCount++;
    clearTimeout(_clickTimer);
    _clickTimer = setTimeout(() => { _clickCount = 0; }, 2000);
    if (_clickCount >= 2) showAltHint();
  }
  function showAltHint() {
    if (!pipWin) return;
    let h = pipWin.document.getElementById('ytf-alt-hint');
    if (!h) {
      h = pipWin.document.createElement('div');
      h.id = 'ytf-alt-hint'; h.textContent = 'Alt+P';
      pipWin.document.body.appendChild(h);
    }
    h.style.opacity = '1';
    clearTimeout(_hintTimer);
    _hintTimer = setTimeout(() => { h.style.opacity = '0'; _clickCount = 0; }, 2500);
  }

  // ── Crop ──────────────────────────────────────────────────────────────────
  function doCrop(video) {
    if (!pipWin) return;
    const vW = video.videoWidth, vH = video.videoHeight;
    if (!vW || !vH) return;
    const winW = pipWin.innerWidth, winH = pipWin.innerHeight;
    const dW = pipWin.outerWidth - winW, dH = pipWin.outerHeight - winH;
    const vR = vW / vH, cR = winW / winH;
    if (Math.abs(vR - cR) < 0.01) return;
    const newW = vR > cR ? winW : Math.round(winH * vR);
    const newH = vR > cR ? Math.round(winW / vR) : winH;
    pipWin.resizeTo(newW + dW, newH + dH);
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  function pipCSS() {
    return `
      *{margin:0;padding:0;box-sizing:border-box;}
      button{background:none;border:none;padding:0;margin:0;outline:none;
        font:inherit;cursor:pointer;-webkit-appearance:none;appearance:none;
        box-sizing:border-box;color:inherit;}
      body{background:#000;width:100vw;height:100vh;overflow:hidden;
        position:relative;font-family:Arial,sans-serif;-webkit-app-region:drag;}
      video{position:absolute;inset:0;width:100%;height:100%;
        display:block;object-fit:contain;cursor:pointer;-webkit-app-region:no-drag;}

      #ytf-pp{position:absolute;top:50%;left:50%;
        transform:translate(-50%,-50%) scale(0.82);
        pointer-events:none;z-index:200;width:60px;height:60px;
        border-radius:50%;background:rgba(0,0,0,0.42);
        display:flex;align-items:center;justify-content:center;
        opacity:0;transition:opacity .22s,transform .22s;}

      .ytf-dot{
        width:28px!important;height:28px!important;border-radius:50%!important;
        background:rgba(12,12,12,0.85)!important;
        border:1px solid rgba(255,255,255,0.22)!important;
        color:rgba(255,255,255,0.92)!important;
        display:flex!important;align-items:center!important;justify-content:center!important;
        flex-shrink:0;transition:background .12s,transform .1s;
        backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
      .ytf-dot:hover{
        background:rgba(255,255,255,0.18)!important;transform:scale(1.08);
        border-color:rgba(255,255,255,0.4)!important;}
      #ytf-ct.ytf-on{background:rgba(140,0,0,0.7)!important;
        border-color:rgba(220,50,50,0.5)!important;}

      #ytf-bar{position:absolute;top:8px;right:8px;z-index:100;
        display:flex;align-items:center;gap:6px;opacity:0;pointer-events:none;
        transition:opacity .18s;-webkit-app-region:no-drag;}
      body:hover #ytf-bar{opacity:1;pointer-events:all;}

      #ytf-op-wrap{display:flex;align-items:center;gap:4px;
        background:rgba(12,12,12,0.85);border:1px solid rgba(255,255,255,0.22);
        border-radius:14px;padding:0 8px 0 6px;height:28px;
        backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
      #ytf-op-icon{display:flex;align-items:center;color:rgba(255,255,255,0.8);flex-shrink:0;}
      #ytf-op-slider{-webkit-appearance:none;appearance:none;width:54px;height:3px;
        background:rgba(255,255,255,0.28);border-radius:2px;cursor:pointer;outline:none;}
      #ytf-op-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
        width:11px;height:11px;border-radius:50%;background:#fff;cursor:pointer;}
      #ytf-op-slider::-moz-range-thumb{width:11px;height:11px;border-radius:50%;
        background:#fff;border:none;cursor:pointer;}
      /* Native-Host aktiv: OS übernimmt Click-Through komplett, Leiste unnötig */
      body.ytf-ct-native #ytf-bar,
      body.ytf-ct-native:hover #ytf-bar{display:none!important;}
      body.ytf-ct-native *{pointer-events:none!important;}
      /* Fallback ohne Native Host: Ctrl-Leiste ausblenden, Dot-Leiste bleibt bedienbar */
      body.ytf-ct-active #ytf-ctrl,
      body.ytf-ct-active:hover #ytf-ctrl{display:none!important;pointer-events:none!important;}
      #ytf-ctrl{position:absolute;bottom:0;left:0;right:0;
        padding:2px 8px 6px;display:flex;flex-direction:column;gap:4px;
        -webkit-app-region:no-drag;z-index:150;
        opacity:0;transition:opacity .18s;pointer-events:none;
        background:linear-gradient(transparent,rgba(0,0,0,0.62));}
      body:hover #ytf-ctrl{opacity:1;pointer-events:all;}

      #ytf-prog-wrap{width:100%;height:14px;display:flex;align-items:center;cursor:pointer;}
      #ytf-prog-bg{position:relative;width:100%;height:3px;
        background:rgba(255,255,255,0.22);border-radius:2px;}
      #ytf-prog-fill{position:absolute;left:0;top:0;height:100%;
        background:#ff0000;border-radius:2px;pointer-events:none;}
      #ytf-prog-thumb{position:absolute;top:50%;transform:translate(-50%,-50%);
        width:12px;height:12px;border-radius:50%;background:#ff0000;
        opacity:0;transition:opacity .12s;pointer-events:none;}
      #ytf-prog-wrap:hover #ytf-prog-thumb{opacity:1;}
      #ytf-prog-wrap:hover #ytf-prog-bg{height:5px;}

      #ytf-btns-row{display:flex;align-items:center;justify-content:space-between;}
      #ytf-btns-left{display:flex;align-items:center;gap:5px;}
      #ytf-btns-right{display:flex;align-items:center;}
      #ytf-time{color:rgba(255,255,255,0.85);font-size:11px;margin-left:7px;
        white-space:nowrap;user-select:none;pointer-events:none;font-family:Arial,sans-serif;}

      #ytf-vol-group{display:flex;align-items:center;gap:5px;}
      #ytf-vol-wrap{width:0;overflow:hidden;transition:width .2s ease;
        display:flex;align-items:center;cursor:pointer;height:28px;}
      #ytf-vol-group:hover #ytf-vol-wrap{width:60px;}
      #ytf-vol-bg{position:relative;width:56px;height:3px;
        background:rgba(255,255,255,0.25);border-radius:2px;flex-shrink:0;}
      #ytf-vol-fill{position:absolute;left:0;top:0;height:100%;
        background:#fff;border-radius:2px;pointer-events:none;}
      #ytf-vol-thumb{position:absolute;top:50%;transform:translate(-50%,-50%);
        width:10px;height:10px;border-radius:50%;background:#fff;
        opacity:0;transition:opacity .12s;pointer-events:none;}
      #ytf-vol-group:hover #ytf-vol-thumb{opacity:1;}

      #ytf-alt-hint{position:absolute;bottom:48px;right:8px;z-index:300;
        color:rgba(255,255,255,0.55);font-size:10px;font-family:Arial,sans-serif;
        background:rgba(0,0,0,0.45);border-radius:4px;padding:2px 6px;
        pointer-events:none;opacity:0;transition:opacity .2s;user-select:none;}
    `;
  }

  // ── Icons (24px viewBox, thick strokes) ───────────────────────────────────
  function icoOpacity() {
    return `<svg viewBox="0 0 24 24" fill="none" width="14" height="14">
      <path d="M12 3C12 3 5 11 5 15.5A7 7 0 0 0 19 15.5C19 11 12 3 12 3Z"
        fill="currentColor" fill-opacity="0.45" stroke="currentColor" stroke-width="1.5"/>
    </svg>`;
  }
  function icoClick() {
    return `<svg viewBox="0 0 24 24" fill="none" width="15" height="15">
      <path d="M5 3l14 9-7 1.5L9 21z" fill="currentColor"/>
    </svg>`;
  }
  function icoCrop() {
    return `<svg viewBox="0 0 24 24" fill="none" width="15" height="15">
      <polyline points="6,3 6,6 3,6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="18,3 18,6 21,6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="6,21 6,18 3,18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="18,21 18,18 21,18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function icoClose() {
    return `<svg viewBox="0 0 24 24" fill="none" width="14" height="14">
      <line x1="5" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="19" y1="5" x2="5" y2="19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
  }
  function icoPlay() {
    return `<svg viewBox="0 0 24 24" fill="none" width="14" height="14">
      <path d="M6 4l13 8-13 8Z" fill="currentColor"/>
    </svg>`;
  }
  function icoPause() {
    return `<svg viewBox="0 0 24 24" fill="none" width="14" height="14">
      <rect x="5"  y="4" width="4" height="16" rx="1.5" fill="currentColor"/>
      <rect x="15" y="4" width="4" height="16" rx="1.5" fill="currentColor"/>
    </svg>`;
  }
  function icoBack5() {
    return `<svg viewBox="0 0 24 24" fill="none" width="17" height="17">
      <path d="M22 12A10 10 0 1 1 14 2.3" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
      <polyline points="10,2 14,2 14,6" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="12" y="16.5" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor" font-family="Arial,sans-serif" stroke="none">5</text>
    </svg>`;
  }
  function icoFwd5() {
    return `<svg viewBox="0 0 24 24" fill="none" width="17" height="17">
      <path d="M2 12A10 10 0 1 0 10 2.3" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
      <polyline points="14,2 10,2 10,6" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="12" y="16.5" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor" font-family="Arial,sans-serif" stroke="none">5</text>
    </svg>`;
  }
  function icoMute() {
    return `<svg viewBox="0 0 24 24" fill="none" width="15" height="15">
      <path d="M3 9H7L13 4V20L7 15H3z" fill="currentColor"/>
      <path d="M17 9c1.5 0.8 2.5 2 2.5 3s-1 2.2-2.5 3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
  }
  function icoUnmute() {
    return `<svg viewBox="0 0 24 24" fill="none" width="15" height="15">
      <path d="M3 9H7L13 4V20L7 15H3z" fill="currentColor"/>
      <line x1="17" y1="9"  x2="21" y2="15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="21" y1="9"  x2="17" y2="15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
  }

  // ── Observer ──────────────────────────────────────────────────────────────
  let dbt;
  new MutationObserver(() => { clearTimeout(dbt); dbt = setTimeout(tryInject, 800); })
    .observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'complete') tryInject();
  else window.addEventListener('load', tryInject);

})();
