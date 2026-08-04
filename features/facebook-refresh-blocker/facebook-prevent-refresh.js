/**
 * Facebook Auto-Refresh Prevention Content Script
 */

(function () {
  'use strict';

  if (window.__fbPreventRefreshInjected) return;
  window.__fbPreventRefreshInjected = true;

  try {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response && response.facebookPreventRefresh === false) {
        return;
      }
      injectMainWorldScript();
    });
  } catch {
    injectMainWorldScript();
  }

  function injectMainWorldScript() {
    const code = `
      (function() {
        if (window.__fbVisibilityOverrideInjected) return;
        window.__fbVisibilityOverrideInjected = true;

        try {
          Object.defineProperty(document, 'visibilityState', {
            get: function() { return 'visible'; },
            configurable: true
          });
          Object.defineProperty(document, 'hidden', {
            get: function() { return false; },
            configurable: true
          });
        } catch(e) { }

        const origAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
          if (type === 'visibilitychange' || type === 'webkitvisibilitychange') {
            return;
          }
          return origAddEventListener.call(this, type, listener, options);
        };

        window.addEventListener('visibilitychange', function(e) {
          e.stopImmediatePropagation();
        }, true);
      })();
    `;

    const script = document.createElement('script');
    script.textContent = code;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }
})();
