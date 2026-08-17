import { formatDate, parseYamlConfig, escapeHtml, sendMessage } from '../../utils/domain-utils.js';

// ==========================================
// DOM Elements
// ==========================================

const exclusionsTextarea = document.getElementById('exclusions-textarea');
const refreshIntervalSelect = document.getElementById('refresh-interval');
const cacheCountEl = document.getElementById('cache-count');
const cacheUpdatedEl = document.getElementById('cache-updated');
const cacheOnlineEl = document.getElementById('cache-online');
const btnClearCache = document.getElementById('btn-clear-cache');
const btnSave = document.getElementById('btn-save');
const btnSaveTop = document.getElementById('btn-save-top');
const saveFeedback = document.getElementById('save-feedback');
const categoriesTextarea = document.getElementById('categories-textarea');
const excludedIpsTextarea = document.getElementById('excluded-ips-textarea');
const googleSearchToggle = document.getElementById('google-search-checkboxes-toggle');
const urlscanAssistantToggle = document.getElementById('urlscan-assistant-toggle');
const facebookPreventRefreshToggle = document.getElementById('facebook-prevent-refresh-toggle');
const downloadProtectionToggle = document.getElementById('download-protection-toggle');
const clipboardProtectionToggle = document.getElementById('clipboard-protection-toggle');

// ==========================================
// Initialization & Listeners
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadCacheStatus();
  await loadShortcut();
  setupEventListeners();
});

function setupEventListeners() {
  btnSave.addEventListener('click', handleSave);
  if (btnSaveTop) btnSaveTop.addEventListener('click', handleSave);
  btnClearCache.addEventListener('click', handleClearCache);
}

async function loadShortcut() {
  const shortcutBadge = document.getElementById('shortcut-badge');

  if (chrome.commands && chrome.commands.getAll) {
    try {
      const commands = await chrome.commands.getAll();
      const actionCmd = commands.find(c => c.name === '_execute_action');
      if (actionCmd && actionCmd.shortcut && shortcutBadge) {
        shortcutBadge.textContent = actionCmd.shortcut;
      } else if (shortcutBadge) {
        shortcutBadge.textContent = 'Alt+Shift+A (Default)';
      }
    } catch {
      if (shortcutBadge) shortcutBadge.textContent = 'Alt+Shift+A';
    }
  }
}

// ==========================================
// Settings & Cache Loading
// ==========================================

async function loadSettings() {
  try {
    const settings = await sendMessage({ action: 'getSettings' });

    if (settings.exclusions?.length > 0) {
      exclusionsTextarea.value = settings.exclusions.join('\n');
    }

    if (settings.excludedIps?.length > 0) {
      excludedIpsTextarea.value = settings.excludedIps.join('\n');
    }

    if (settings.refreshHours) {
      refreshIntervalSelect.value = String(settings.refreshHours);
    }

    if (googleSearchToggle) {
      googleSearchToggle.checked = settings.googleSearchCheckboxes !== false;
    }

    if (urlscanAssistantToggle) {
      urlscanAssistantToggle.checked = settings.urlscanAssistant !== false;
    }

    if (facebookPreventRefreshToggle) {
      facebookPreventRefreshToggle.checked = settings.facebookPreventRefresh !== false;
    }

    if (downloadProtectionToggle) {
      downloadProtectionToggle.checked = settings.downloadProtection !== false;
    }

    if (clipboardProtectionToggle) {
      clipboardProtectionToggle.checked = settings.clipboardProtection !== false;
    }

    if (settings.categories?.length > 0) {
      categoriesTextarea.value = settings.categories.join('\n');
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

async function loadCacheStatus() {
  try {
    const status = await sendMessage({ action: 'getListStatus' });

    cacheCountEl.textContent = status.totalDomains
      ? status.totalDomains.toLocaleString('en-US')
      : '0';

    cacheUpdatedEl.textContent = status.lastUpdated
      ? formatDate(status.lastUpdated)
      : 'Never';

    if (status.isOnline) {
      cacheOnlineEl.textContent = 'Online';
      cacheOnlineEl.className = 'settings-status__value settings-status__value--online';
    } else {
      cacheOnlineEl.textContent = 'Offline (cache)';
      cacheOnlineEl.className = 'settings-status__value settings-status__value--offline';
    }
  } catch (error) {
    console.error('Error loading cache status:', error);
  }
}

// ==========================================
// Handlers
// ==========================================

function splitLines(text) {
  return text ? text.split('\n').map(l => l.trim()).filter(l => l.length > 0) : [];
}

async function handleSave() {
  try {
    const exclusions = splitLines(exclusionsTextarea.value);
    const excludedIps = splitLines(excludedIpsTextarea.value);
    const refreshHours = parseInt(refreshIntervalSelect.value, 10) || 1;
    const googleSearchCheckboxes = googleSearchToggle ? googleSearchToggle.checked : true;
    const urlscanAssistant = urlscanAssistantToggle ? urlscanAssistantToggle.checked : true;
    const facebookPreventRefresh = facebookPreventRefreshToggle ? facebookPreventRefreshToggle.checked : true;
    const downloadProtection = downloadProtectionToggle ? downloadProtectionToggle.checked : true;
    const clipboardProtection = clipboardProtectionToggle ? clipboardProtectionToggle.checked : true;

    await sendMessage({
      action: 'saveSettings',
      settings: { exclusions, excludedIps, refreshHours, googleSearchCheckboxes, urlscanAssistant, facebookPreventRefresh, downloadProtection, clipboardProtection }
    });

    const categories = splitLines(categoriesTextarea.value);
    await chrome.storage.local.set({ reported_categories: categories });

    showFeedback('Settings saved!', 'success');
  } catch (error) {
    showFeedback('Error saving settings', 'error');
    console.error('Error saving settings:', error);
  }
}

async function handleClearCache() {
  if (!confirm('Are you sure you want to clear the cache? The domain list will be downloaded again.')) {
    return;
  }

  try {
    const keys = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(keys).filter(k =>
      k.startsWith('phishtackle_domains') || k === 'phishtackle_meta' || k.startsWith('ultra_domains') || k === 'ultra_meta' || k.startsWith('certpl_domains') || k === 'certpl_meta'
    );
    await chrome.storage.local.remove(keysToRemove);

    await sendMessage({ action: 'forceRefresh' });
    await loadCacheStatus();

    showFeedback('Cache cleared and domain list re-downloaded', 'success');
  } catch (error) {
    showFeedback('Error clearing cache', 'error');
    console.error('Error clearing cache:', error);
  }
}

// ==========================================
// Helpers
// ==========================================

function showFeedback(message, type) {
  saveFeedback.hidden = false;
  saveFeedback.textContent = message;
  saveFeedback.className = `settings-feedback settings-feedback--${type}`;

  setTimeout(() => {
    saveFeedback.hidden = true;
  }, 3000);
}
