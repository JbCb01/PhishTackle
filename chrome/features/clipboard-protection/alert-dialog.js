import { sendMessage } from '../../utils/domain-utils.js';

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);

  const domain = urlParams.get('domain') || 'Unknown domain';
  const payload = urlParams.get('payload') || '';
  const method = urlParams.get('method') || 'navigator.clipboard.writeText';
  const trigger = urlParams.get('trigger') || 'Automatic / Unprompted';

  document.getElementById('alert-domain').textContent = `Source: ${domain}`;
  document.getElementById('alert-method').textContent = method;
  document.getElementById('alert-payload').textContent = payload || '(Empty string)';

  const triggerEl = document.getElementById('alert-trigger');
  triggerEl.textContent = trigger;
  if (trigger.toLowerCase().includes('auto') || trigger.toLowerCase().includes('unprompted')) {
    triggerEl.className = 'info-value info-value--warn';
  } else {
    triggerEl.className = 'info-value';
  }

  document.getElementById('btn-keep').addEventListener('click', async () => {
    try {
      await sendMessage({
        action: 'resolveClipboardPrompt',
        domain,
        choice: 'keep',
        payload
      });
    } catch { }
    window.close();
  });

  document.getElementById('btn-clear').addEventListener('click', async () => {
    try {
      await sendMessage({
        action: 'resolveClipboardPrompt',
        domain,
        choice: 'clear',
        payload: ''
      });
    } catch { }
    window.close();
  });
});
