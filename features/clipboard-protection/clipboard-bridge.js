/**
 * Clipboard Protection Content Script Bridge
 * Injects main-world interceptor script and relays messages to background service worker.
 */

(function () {
  'use strict';

  if (window.__ultraClipboardBridgeInjected) return;
  window.__ultraClipboardBridgeInjected = true;

  // Inject main-world interceptor script into webpage context
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('features/clipboard-protection/clipboard-interceptor.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  } catch (e) {
    console.warn('[ULTRA Phish Catcher] Main world injection error:', e);
  }

  // Relay messages from main world to background service worker
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'ULTRA_CLIPBOARD_ATTEMPT') {
      try {
        chrome.runtime.sendMessage({
          action: 'clipboardAttempt',
          detail: event.data.detail
        });
      } catch (e) {
        // Extension context invalidated
      }
    }
  });
})();
