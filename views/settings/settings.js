import { formatDate, parseYamlConfig, escapeHtml, sendMessage } from '../../utils/domain-utils.js';

// ==========================================
// DOM Elements
// ==========================================

const exclusionsTextarea = document.getElementById('exclusions-textarea');
const exclusionsPreview = document.getElementById('exclusions-preview');
const exclusionsPreviewList = document.getElementById('exclusions-preview-list');
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
const facebookPreventRefreshToggle = document.getElementById('facebook-prevent-refresh-toggle');
const downloadProtectionToggle = document.getElementById('download-protection-toggle');
const clipboardProtectionToggle = document.getElementById('clipboard-protection-toggle');

// ==========================================
// Initialization & Listeners
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadCacheStatus();
  setupEventListeners();
});

function setupEventListeners() {
  exclusionsTextarea.addEventListener('input', updatePreview);
  btnSave.addEventListener('click', handleSave);
  if (btnSaveTop) btnSaveTop.addEventListener('click', handleSave);
  btnClearCache.addEventListener('click', handleClearCache);
}

// ==========================================
// Settings & Cache Loading
// ==========================================

async function loadSettings() {
  try {
    const settings = await sendMessage({ action: 'getSettings' });

    if (settings.exclusions?.length > 0) {
      exclusionsTextarea.value = settings.exclusions.join('\n');
      updatePreview();
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

    if (facebookPreventRefreshToggle) {
      facebookPreventRefreshToggle.checked = settings.facebookPreventRefresh !== false;
    }

    if (downloadProtectionToggle) {
      downloadProtectionToggle.checked = settings.downloadProtection !== false;
    }

    if (clipboardProtectionToggle) {
      clipboardProtectionToggle.checked = settings.clipboardProtection !== false;
    }

    const result = await chrome.storage.local.get('reported_categories');
    const res = await fetch(chrome.runtime.getURL('config.yaml'));
    const text = await res.text();
    const config = parseYamlConfig(text);
    const defaultCategories = config.categories || ['other'];

    const categories = result.reported_categories || defaultCategories;
    categoriesTextarea.value = categories.join('\n');

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
// Handlers & Rule Parsing
// ==========================================

function updatePreview() {
  const text = exclusionsTextarea.value.trim();

  if (!text) {
    exclusionsPreview.hidden = true;
    return;
  }

  const rules = parseRules(text);
  exclusionsPreview.hidden = false;

  exclusionsPreviewList.innerHTML = rules.map(rule => {
    if (!rule.valid) {
      return `<span class="settings-preview__tag settings-preview__tag--invalid" title="Invalid rule">${escapeHtml(rule.text)}</span>`;
    }
    if (rule.isWildcard) {
      return `<span class="settings-preview__tag settings-preview__tag--wildcard" title="Wildcard: matches domain and subdomains">✱ ${escapeHtml(rule.text)}</span>`;
    }
    return `<span class="settings-preview__tag" title="Exact match">${escapeHtml(rule.text)}</span>`;
  }).join('');
}

function parseRules(text) {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const isWildcard = line.startsWith('*.');
      const valid = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(line);
      return { text: line, isWildcard, valid };
    });
}

function splitLines(text) {
  return text ? text.split('\n').map(l => l.trim()).filter(l => l.length > 0) : [];
}

async function handleSave() {
  try {
    const exclusions = splitLines(exclusionsTextarea.value);
    const excludedIps = splitLines(excludedIpsTextarea.value);
    const refreshHours = parseInt(refreshIntervalSelect.value, 10) || 6;
    const googleSearchCheckboxes = googleSearchToggle ? googleSearchToggle.checked : true;
    const facebookPreventRefresh = facebookPreventRefreshToggle ? facebookPreventRefreshToggle.checked : true;
    const downloadProtection = downloadProtectionToggle ? downloadProtectionToggle.checked : true;
    const clipboardProtection = clipboardProtectionToggle ? clipboardProtectionToggle.checked : true;

    await sendMessage({
      action: 'saveSettings',
      settings: { exclusions, excludedIps, refreshHours, googleSearchCheckboxes, facebookPreventRefresh, downloadProtection, clipboardProtection }
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
      k.startsWith('ultra_domains') || k === 'ultra_meta' || k.startsWith('certpl_domains') || k === 'certpl_meta'
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
