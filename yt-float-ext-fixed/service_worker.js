const HOST = 'com.ytfloat.helper';
let port = null;
let pendingCallbacks = {};
let msgId = 0;
let lastError = null;

function ensureConnected() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST);
    lastError = null;

    port.onMessage.addListener((msg) => {
      const id = msg._id;
      if (id !== undefined && pendingCallbacks[id]) {
        pendingCallbacks[id](msg);
        delete pendingCallbacks[id];
        return;
      }
      // Unaufgeforderte Nachricht vom Host, z.B. globaler Alt+P-Hotkey
      // (funktioniert auch, wenn der Browser nicht fokussiert ist).
      if (msg && msg.type === 'ct_toggled') {
        chrome.tabs.query({ url: '*://www.youtube.com/*' }, (tabs) => {
          (tabs || []).forEach((t) => {
            chrome.tabs.sendMessage(t.id, { type: 'ytfloat-ct-sync', active: msg.active }, () => {
              void chrome.runtime.lastError; // Tab ohne PiP-Fenster ignoriert das einfach
            });
          });
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // chrome.runtime.lastError MUST be read here or Chrome throws
      const err = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'disconnected';
      lastError = err;
      console.warn('[YTFloat SW] Native host disconnected:', err);
      port = null;
      Object.keys(pendingCallbacks).forEach((k) => {
        pendingCallbacks[k]({ ok: false, error: err });
        delete pendingCallbacks[k];
      });
    });

  } catch (e) {
    lastError = e && e.message ? e.message : String(e);
    port = null;
    console.warn('[YTFloat SW] connectNative failed:', lastError);
  }
}

function sendToHost(msg) {
  return new Promise(function(resolve) {
    ensureConnected();
    if (!port) {
      resolve({ ok: false, error: lastError || 'not_connected' });
      return;
    }
    const id = ++msgId;
    msg._id = id;
    pendingCallbacks[id] = resolve;
    port.postMessage(msg);

    // 5s timeout (give host more time to find window)
    setTimeout(function() {
      if (pendingCallbacks[id]) {
        delete pendingCallbacks[id];
        resolve({ ok: false, error: 'timeout' });
      }
    }, 5000);
  });
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.target !== 'ytfloat-sw') return;

  (function() {
    var p;
    switch (msg.type) {
      case 'pip_opened':
        p = sendToHost({ type: 'pip_opened', x: msg.x, y: msg.y, w: msg.w, h: msg.h, title: msg.title });
        break;
      case 'enable_click_through':
        p = sendToHost({ type: 'enable_click_through', x: msg.x, y: msg.y, w: msg.w, h: msg.h, title: msg.title });
        break;
      case 'disable_click_through':
        p = sendToHost({ type: 'disable_click_through', title: msg.title });
        break;
      case 'set_opacity':
        p = sendToHost({ type: 'set_opacity', alpha: msg.alpha, x: msg.x, y: msg.y, w: msg.w, h: msg.h, title: msg.title });
        break;
      case 'get_status':
        // If not connected yet, try now
        ensureConnected();
        if (!port) {
          sendResponse({ ok: false, error: lastError || 'not_connected' });
          return;
        }
        p = sendToHost({ type: 'get_status' });
        break;
      default:
        sendResponse({ ok: false, error: 'unknown_type' });
        return;
    }
    p.then(sendResponse);
  })();

  return true; // async
});
