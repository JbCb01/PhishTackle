import { sendMessage } from '../../utils/domain-utils.js';

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);

  const domain = urlParams.get('domain') || 'Unknown domain';
  const filename = urlParams.get('filename') || 'file';
  const ext = urlParams.get('extension') || 'unknown';
  const sizeStr = urlParams.get('sizeStr') || 'Unknown size';
  const mime = urlParams.get('mimeType') || 'application/octet-stream';
  const downloadId = urlParams.get('downloadId');
  const isSimulation = urlParams.get('isSimulation') === '1';

  document.getElementById('alert-domain').textContent = `Source: ${domain}`;
  document.getElementById('alert-filename').textContent = filename;
  document.getElementById('alert-mime').textContent = mime;
  document.getElementById('alert-ext').textContent = `.${ext.toUpperCase()}`;
  document.getElementById('alert-size').textContent = sizeStr;

  document.getElementById('btn-allow').addEventListener('click', async () => {
    try {
      await sendMessage({
        action: 'resolveDownloadPrompt',
        downloadId,
        isSimulation,
        choice: 'allow'
      });
    } catch { }
    window.close();
  });

  document.getElementById('btn-safe').addEventListener('click', async () => {
    try {
      await sendMessage({
        action: 'resolveDownloadPrompt',
        downloadId,
        isSimulation,
        choice: 'safe'
      });
    } catch { }
    window.close();
  });

  document.getElementById('btn-block').addEventListener('click', async () => {
    try {
      await sendMessage({
        action: 'resolveDownloadPrompt',
        downloadId,
        isSimulation,
        choice: 'block'
      });
    } catch { }
    window.close();
  });
});
