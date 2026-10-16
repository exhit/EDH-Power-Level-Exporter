// Controls a single in-flight debug export run (see background.js). This
// window is the ONLY UI for that run — it deliberately doesn't rely on the
// extension popup, which closes the moment it loses focus (e.g. the user
// clicking one of the tabs being opened), which used to kill the run's
// visible progress immediately even though the run itself kept going.

const progressText = document.getElementById('progressText');
const barFill = document.getElementById('barFill');
const statusText = document.getElementById('statusText');
const stopBtn = document.getElementById('stopBtn');
const closeBtn = document.getElementById('closeBtn');

function render({ opened = 0, total = 0, delay, rateLimited, done, stopped } = {}) {
  if (total) {
    progressText.textContent = done
      ? (stopped ? `Stopped after ${opened}/${total} tabs.` : `Done — opened ${opened}/${total} tabs.`)
      : `Opening ${opened}/${total} tabs…`;
    barFill.style.width = `${Math.min(100, (opened / total) * 100)}%`;
  }

  if (rateLimited && !done) {
    statusText.textContent = `⚠ Archidekt is rate-limiting (429) — slowed to ${(delay / 1000).toFixed(1)}s between tabs.`;
    statusText.classList.remove('hidden', 'done');
  }

  if (done) {
    stopBtn.classList.add('hidden');
    closeBtn.classList.remove('hidden');
    if (!rateLimited) {
      statusText.classList.add('hidden');
    } else {
      statusText.textContent = stopped ? 'Stopped by user.' : 'Finished despite rate-limiting.';
      statusText.classList.remove('hidden');
      statusText.classList.add('done');
    }
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'debugRunUpdate') return;
  render(message);
});

stopBtn.addEventListener('click', () => {
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stopping…';
  chrome.runtime.sendMessage({ type: 'stopDebugRun' }).catch(() => {});
});

closeBtn.addEventListener('click', () => window.close());

// Closing this window (rather than clicking Stop) is handled entirely on the
// background.js side via chrome.windows.onRemoved — nothing needed here.

// Covers the window being reloaded/reopened mid-run (shouldn't normally
// happen, but keeps this view honest if it ever does).
chrome.runtime.sendMessage({ type: 'requestDebugRunState' }).catch(() => {});
