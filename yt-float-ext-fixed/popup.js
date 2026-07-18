const extId   = chrome.runtime.id;
const dotHost = document.getElementById('dot-host');
const txtHost = document.getElementById('txt-host');
const errEl   = document.getElementById('err');
const extIdEl = document.getElementById('ext-id');

extIdEl.textContent = extId;

function setStatus(ok, text, err) {
  dotHost.className = 'dot ' + (ok ? 'ok' : 'fail');
  txtHost.textContent = text;
  if (err) { errEl.style.display = 'block'; errEl.textContent = err; }
  else      { errEl.style.display = 'none'; }
}

function testConnection() {
  setStatus(false, 'Verbinde...', null);
  dotHost.className = 'dot warn';

  chrome.runtime.sendMessage(
    { target: 'ytfloat-sw', type: 'get_status' },
    (result) => {
      if (chrome.runtime.lastError) {
        setStatus(false, 'Service Worker Fehler', chrome.runtime.lastError.message);
        return;
      }
      if (!result) {
        setStatus(false, 'Keine Antwort', 'Service Worker antwortet nicht.');
        return;
      }
      if (result.ok) {
        setStatus(true, 'Verbunden ✓', null);
      } else {
        setStatus(false, 'Nicht verbunden', result.error || 'Unbekannter Fehler');
      }
    }
  );
}

document.getElementById('btn-test').addEventListener('click', testConnection);
document.getElementById('btn-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(extId).then(() => {
    document.getElementById('btn-copy').textContent = 'Kopiert ✓';
    setTimeout(() => { document.getElementById('btn-copy').textContent = 'Extension-ID kopieren'; }, 2000);
  });
});

// Auto-test on open
testConnection();
