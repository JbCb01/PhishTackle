/**
 * Facebook Auto-Refresh Prevention Content Script with DevTools Debugging
 */

(function () {
  'use strict';

  if (window.__fbPreventRefreshInjected) return;
  window.__fbPreventRefreshInjected = true;

  injectMainWorldInterceptor();

  function injectMainWorldInterceptor() {
    const code = `
      (function() {
        if (window.__fbAeldInjected) return;
        window.__fbAeldInjected = true;

        console.log('[PhishTackle FB Debug] 🛡️ Facebook Refresh Blocker active in MAIN world.');

        try {
          Object.defineProperty(document, 'visibilityState', {
            get: function() { return 'visible'; },
            configurable: true
          });
          Object.defineProperty(document, 'hidden', {
            get: function() { return false; },
            configurable: true
          });
          document.hasFocus = function() { return true; };
        } catch(e) {
          console.warn('[PhishTackle FB Debug] Property override error:', e);
        }

        const reBlockedEvents = /^(blur|focus|focusin|focusout|afterblur|mousemove|pointermove|visibilitychange|webkitvisibilitychange|pageshow|pagehide)$/i;

        const origAEL = EventTarget.prototype.addEventListener;

        EventTarget.prototype.addEventListener = function(type, listener, options) {
          const t = String(type).trim();
          if (reBlockedEvents.test(t)) {
            console.log('[PhishTackle FB Debug] ⛔ BLOCKED addEventListener:', t, this);
            return;
          }
          return origAEL.call(this, type, listener, options);
        };

        const blockProps = ['onfocus', 'onblur', 'onvisibilitychange', 'onwebkitvisibilitychange', 'onpagehide', 'onpageshow'];
        for (const prop of blockProps) {
          try {
            Object.defineProperty(window, prop, {
              get() { return null; },
              set(val) {
                console.log('[PhishTackle FB Debug] ⛔ BLOCKED direct property setter window.' + prop);
              },
              configurable: true
            });
            Object.defineProperty(document, prop, {
              get() { return null; },
              set(val) {
                console.log('[PhishTackle FB Debug] ⛔ BLOCKED direct property setter document.' + prop);
              },
              configurable: true
            });
          } catch {}
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
