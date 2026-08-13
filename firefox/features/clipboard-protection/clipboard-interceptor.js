/**
 * Clipboard Interceptor - Main World Script
 * Hooks into navigator.clipboard & document.execCommand('copy') to catch unauthorized writes.
 */

(function () {
  'use strict';

  if (window.__phishtackleClipboardInjected) return;
  window.__phishtackleClipboardInjected = true;

  let lastUserGestureTime = 0;

  // Track explicit user input gestures (click, keydown, pointerup)
  ['click', 'keydown', 'pointerup', 'mouseup', 'touchend'].forEach(eventType => {
    window.addEventListener(eventType, (e) => {
      if (e.isTrusted) {
        lastUserGestureTime = Date.now();
      }
    }, { capture: true, passive: true });
  });

  function isRecentUserGesture() {
    return (Date.now() - lastUserGestureTime) < 1200;
  }

  function notifyClipboardAttempt(textPayload, method, isGesture) {
    // Disable alerts for intentional user gestures (button click / Ctrl+C)
    if (isGesture) {
      return;
    }

    const detail = {
      domain: window.location.hostname || window.location.host || 'Unknown domain',
      payload: String(textPayload || '').slice(0, 1000),
      method: method || 'navigator.clipboard.writeText',
      trigger: 'Automatic / Unprompted'
    };

    window.postMessage({
      type: 'PHISHTACKLE_CLIPBOARD_ATTEMPT',
      detail
    }, '*');
  }

  // Hook 1: navigator.clipboard.writeText
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    const origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
    try {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: function (text) {
          const isGesture = isRecentUserGesture();
          notifyClipboardAttempt(text, 'navigator.clipboard.writeText', isGesture);
          return origWriteText(text);
        },
        configurable: true,
        writable: true
      });
    } catch { }
  }

  // Hook 2: navigator.clipboard.write
  if (navigator.clipboard && typeof navigator.clipboard.write === 'function') {
    const origWrite = navigator.clipboard.write.bind(navigator.clipboard);
    try {
      Object.defineProperty(navigator.clipboard, 'write', {
        value: async function (data) {
          const isGesture = isRecentUserGesture();
          let textPreview = '[Blob / Rich Data]';
          try {
            if (Array.isArray(data)) {
              for (const item of data) {
                if (item.types && item.types.includes('text/plain')) {
                  const blob = await item.getType('text/plain');
                  textPreview = await blob.text();
                  break;
                }
              }
            }
          } catch { }

          notifyClipboardAttempt(textPreview, 'navigator.clipboard.write', isGesture);
          return origWrite(data);
        },
        configurable: true,
        writable: true
      });
    } catch { }
  }

  // Hook 3: document.execCommand('copy')
  if (typeof document.execCommand === 'function') {
    const origExecCommand = document.execCommand.bind(document);
    try {
      document.execCommand = function (command, showUI, value) {
        if (command && String(command).toLowerCase() === 'copy') {
          const isGesture = isRecentUserGesture();
          let copiedText = '';
          try {
            copiedText = window.getSelection ? window.getSelection().toString() : '';
          } catch { }
          notifyClipboardAttempt(copiedText || '[execCommand copy]', "document.execCommand('copy')", isGesture);
        }
        return origExecCommand(command, showUI, value);
      };
    } catch { }
  }
})();
