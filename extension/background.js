// ============================================================
// POWER UP PROMPTS — Background Service Worker
// Handles API calls for the content script (has access to storage)
// ============================================================

const API_BASE = 'https://power-up-prompts-api.onrender.com';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'enhance') {
    handleEnhance(msg.prompt).then(sendResponse);
    return true; // keep channel open for async response
  }
  if (msg.type === 'getAuth') {
    chrome.storage.local.get(['token'], (s) => {
      sendResponse({ token: s.token || '' });
    });
    return true;
  }
});

async function handleEnhance(prompt) {
  const { token } = await chrome.storage.local.get(['token']);
  if (!token) {
    return { error: 'not_logged_in', message: 'Please sign in via the Power Up Prompts extension first.' };
  }

  try {
    const doFetch = () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 55000);
      return fetch(`${API_BASE}/api/enhance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ prompt }),
        signal: ctrl.signal
      }).finally(() => clearTimeout(t));
    };

    let res;
    try {
      res = await doFetch();
    } catch {
      // Retry once after a brief pause (covers transient network blips)
      await new Promise(r => setTimeout(r, 2000));
      res = await doFetch();
    }

    const data = await res.json();

    if (res.status === 401) {
      return { error: 'not_logged_in', message: 'Session expired. Please sign in again.' };
    }
    if (res.status === 402 || data.error === 'limit_reached') {
      return { error: 'limit_reached', message: 'Free powerups used up. Open the extension to subscribe.' };
    }
    if (res.status === 429 && data.error === 'window_limit') {
      return { error: 'window_limit', message: data.message || 'Limit reached. Please wait.' };
    }
    if (!res.ok) {
      return { error: 'api_error', message: data.error || 'Enhancement failed.' };
    }

    // Update local powerup state
    if (data.powerups_used !== null && data.powerups_used !== undefined) {
      chrome.storage.local.set({ powerupsUsed: data.powerups_used });
    }
    if (data.is_subscribed !== undefined) {
      chrome.storage.local.set({ isSubscribed: data.is_subscribed });
    }

    const json = JSON.stringify(data.enhanced, null, 2);
    return { success: true, enhanced: json };

  } catch (e) {
    return { error: 'network', message: 'Could not reach the server. Try again.' };
  }
}
