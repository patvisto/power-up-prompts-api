// ============================================================
// POWER UP PROMPTS — Content Script
// Shows a floating ⚡ button when text is selected in input fields
// ============================================================

(() => {
  let floatBtn = null;
  let toastEl  = null;
  let focusedEl = null;
  let toastTimer = null;

  // ── Track which editable element is focused ─────────────────────────────────
  document.addEventListener('focusin', (e) => {
    if (isEditableField(e.target)) {
      focusedEl = e.target;
    }
  });

  document.addEventListener('focusout', () => {
    // Don't clear immediately — allow click on our button
    setTimeout(() => {
      const active = document.activeElement;
      if (!isEditableField(active) && (!floatBtn || !floatBtn.contains(active))) {
        focusedEl = null;
        hideButton();
      }
    }, 200);
  });

  // ── Detect if element is an editable text field ─────────────────────────────
  function isEditableField(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const type = (el.type || '').toLowerCase();
      return ['text', 'search', 'url', '', 'email'].includes(type);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  // ── Get selected text from the focused element ─────────────────────────────
  function getSelectedText() {
    if (!focusedEl) return '';

    if (focusedEl.tagName === 'TEXTAREA' || focusedEl.tagName === 'INPUT') {
      try {
        const start = focusedEl.selectionStart;
        const end   = focusedEl.selectionEnd;
        if (start === end || start == null) return '';
        return focusedEl.value.substring(start, end);
      } catch { return ''; }
    }

    // contenteditable
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    if (focusedEl.contains(sel.anchorNode)) {
      return sel.toString();
    }
    return '';
  }

  // ── Replace selected text in the focused element ───────────────────────────
  function replaceSelectedText(newText) {
    const el = focusedEl;
    if (!el) return;

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const start = el.selectionStart;
      const end   = el.selectionEnd;
      // Use execCommand for React/Vue compatibility, fall back to manual
      el.focus();
      el.setSelectionRange(start, end);

      // Try execCommand first (works with React controlled inputs)
      if (!document.execCommand('insertText', false, newText)) {
        // Manual fallback
        const before = el.value.substring(0, start);
        const after  = el.value.substring(end);
        el.value = before + newText + after;
        el.selectionStart = el.selectionEnd = start + newText.length;
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // contenteditable
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(newText));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── Create the float button once ───────────────────────────────────────────
  function createButton() {
    if (floatBtn) return;
    floatBtn = document.createElement('button');
    floatBtn.id = 'pup-float-btn';
    floatBtn.innerHTML = '<span class="pup-icon">⚡</span> Power Up';

    floatBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    floatBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleEnhance();
    });

    document.body.appendChild(floatBtn);
  }

  // ── Show / hide float button ───────────────────────────────────────────────
  function showButton(x, y) {
    createButton();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Ensure button doesn't go off-screen
    const btnWidth = 110;
    const maxX = window.innerWidth - btnWidth - 10;
    const posX = Math.max(5, Math.min(x, maxX));
    const posY = Math.max(5, y - 38);

    floatBtn.style.left = `${posX + scrollX}px`;
    floatBtn.style.top  = `${posY + scrollY}px`;
    floatBtn.style.display = 'flex';
    floatBtn.classList.remove('pup-loading');
    floatBtn.innerHTML = '<span class="pup-icon">⚡</span> Power Up';
  }

  function hideButton() {
    if (floatBtn) {
      floatBtn.style.display = 'none';
    }
  }

  // ── Position helper for textarea/input ─────────────────────────────────────
  function getButtonPosition() {
    if (!focusedEl) return null;

    if (focusedEl.tagName === 'TEXTAREA' || focusedEl.tagName === 'INPUT') {
      const rect = focusedEl.getBoundingClientRect();
      return { x: rect.left + 4, y: rect.top };
    }

    // contenteditable — use the selection range rect
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0) {
        return { x: rect.left, y: rect.top };
      }
    }

    const rect = focusedEl.getBoundingClientRect();
    return { x: rect.left + 4, y: rect.top };
  }

  // ── Toast notifications ────────────────────────────────────────────────────
  function showToast(message, type = 'error') {
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);

    toastEl = document.createElement('div');
    toastEl.id = 'pup-toast';
    toastEl.className = type === 'error' ? 'pup-toast-error' : 'pup-toast-success';
    toastEl.textContent = message;
    document.body.appendChild(toastEl);

    toastTimer = setTimeout(() => {
      if (toastEl) { toastEl.remove(); toastEl = null; }
    }, 4000);
  }

  // ── Handle enhance click — calls API directly (avoids dead service worker) ───
  async function handleEnhance() {
    const text = getSelectedText();
    if (!text || text.trim().length === 0) return;

    floatBtn.classList.add('pup-loading');
    floatBtn.innerHTML = '<span class="pup-spinner"></span> Enhancing…';

    try {
      const API_BASE = 'https://power-up-prompts-api.onrender.com';
      const { token } = await chrome.storage.local.get(['token']);

      if (!token) {
        hideButton();
        showToast('Please sign in via the Power Up Prompts extension first.', 'error');
        return;
      }

      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 55000);
      let res;
      try {
        res = await fetch(`${API_BASE}/api/enhance`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ prompt: text.trim() }),
          signal: ctrl.signal
        });
      } finally {
        clearTimeout(t);
      }

      const data = await res.json();

      if (res.status === 401) {
        hideButton();
        showToast('Session expired. Please sign in again.', 'error');
        return;
      }
      if (res.status === 402 || data.error === 'limit_reached') {
        hideButton();
        showToast('Free powerups used up. Open the extension to subscribe.', 'error');
        return;
      }
      if (res.status === 429) {
        hideButton();
        showToast(data.message || 'Limit reached. Please wait.', 'error');
        return;
      }
      if (!res.ok) {
        hideButton();
        showToast(data.error || 'Enhancement failed.', 'error');
        return;
      }

      // Update local powerup state
      if (data.powerups_used !== null && data.powerups_used !== undefined) {
        chrome.storage.local.set({ powerupsUsed: data.powerups_used });
      }
      if (data.is_subscribed !== undefined) {
        chrome.storage.local.set({ isSubscribed: data.is_subscribed });
      }

      replaceSelectedText(JSON.stringify(data.enhanced, null, 2));
      hideButton();
      showToast('Prompt enhanced!', 'success');

    } catch (e) {
      hideButton();
      showToast('Could not reach the server. Check your connection.', 'error');
    }
  }

  // ── Check selection and show/hide button ───────────────────────────────────
  function checkSelection() {
    if (!focusedEl) { hideButton(); return; }

    const text = getSelectedText();
    if (!text || text.trim().length < 3) { hideButton(); return; }

    const pos = getButtonPosition();
    if (pos) {
      showButton(pos.x, pos.y);
    }
  }

  // ── Listen for selection via mouse ─────────────────────────────────────────
  document.addEventListener('mouseup', (e) => {
    if (e.target.id === 'pup-float-btn' || (e.target.closest && e.target.closest('#pup-float-btn'))) return;
    setTimeout(checkSelection, 50);
  });

  // ── Listen for selection via keyboard (Shift+arrows, Ctrl+A, etc.) ─────────
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setTimeout(checkSelection, 50);
    } else {
      hideButton();
    }
  });

  // ── Hide on scroll ─────────────────────────────────────────────────────────
  let scrollTimer = null;
  window.addEventListener('scroll', () => {
    hideButton();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(checkSelection, 300);
  }, true);

})();
