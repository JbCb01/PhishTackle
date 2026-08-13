/**
 * Facebook Auto-Refresh Prevention Content Script
 * Uses uBlock Origin's addEventListener-defuser (aeld) technique to block Facebook's
 * visibilitychange, blur, focus, afterblur, and mousemove listeners.
 */

(function () {
  'use strict';

  if (window.__fbPreventRefreshInjected) return;
  window.__fbPreventRefreshInjected = true;

  // Inject IMMEDIATELY at document_start in the MAIN world to intercept addEventListener
  // before Facebook's scripts execute.
  injectMainWorldInterceptor();

  function injectMainWorldInterceptor() {
    const code = `
      (function() {
        if (window.__fbAeldInjected) return;
        window.__fbAeldInjected = true;

        try {
          Object.defineProperty(document, 'visibilityState', {
            get: function() { return 'visible'; },
            configurable: true
          });
          Object.defineProperty(document, 'hidden', {
            get: function() { return false; },
            configurable: true
          });
        } catch { }

        const reBlockedEvents = /^(blur|focus|afterblur|mousemove|visibilitychange|webkitvisibilitychange)$/i;
        const origAddEventListener = EventTarget.prototype.addEventListener;

        EventTarget.prototype.addEventListener = function(type, listener, options) {
          if (typeof type === 'string' && reBlockedEvents.test(type.trim())) {
            return;
          }
          return origAddEventListener.call(this, type, listener, options);
        };

        if (Object.hasOwn(window, 'addEventListener')) {
          const origWinAEL = window.addEventListener;
          window.addEventListener = function(type, listener, options) {
            if (typeof type === 'string' && reBlockedEvents.test(type.trim())) {
              return;
            }
            return origWinAEL.call(this, type, listener, options);
          };
        }

        if (Object.hasOwn(document, 'addEventListener')) {
          const origDocAEL = document.addEventListener;
          document.addEventListener = function(type, listener, options) {
            if (typeof type === 'string' && reBlockedEvents.test(type.trim())) {
              return;
            }
            return origDocAEL.call(this, type, listener, options);
          };
        }
      })();
    `;

    const script = document.createElement('script');
    script.textContent = code;
    const target = document.head || document.documentElement;
    if (target) {
      target.appendChild(script);
      script.remove();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        (document.head || document.documentElement).appendChild(script);
        script.remove();
      }, { once: true });
    }
  }
})();
