import { escapeHtml, sendMessage, cleanUrl } from '../../utils/domain-utils.js';

// ==========================================
// DOM Elements & State
// ==========================================

const statusCardContainer = document.getElementById('status-card-container');
const inputDomainEl = document.getElementById('manual-check-input');
const btnCheckEl = document.getElementById('btn-manual-check');
const resultEl = document.getElementById('manual-check-result');

const btnSettingsEl = document.getElementById('btn-settings');
const btnReportsEl = document.getElementById('btn-reports');
const btnRefreshEl = document.getElementById('btn-refresh');

const footerCountEl = document.getElementById('footer-count');
const footerUpdatedEl = document.getElementById('footer-updated');

const reportActionRow = document.getElementById('report-action-row');
const btnAddReportEl = document.getElementById('btn-add-report');
const reportCategorySelect = document.getElementById('report-category-select');

const manualAddRow = document.getElementById('manual-add-row');
const manualAddCategory = document.getElementById('manual-add-category');
const manualAddFeedback = document.getElementById('manual-add-feedback');

let currentTabDomain = null;
let currentTabUrl = null;
let lastCheckedDomain = null;
let categories = [];
let manualAddFeedbackTimeout = null;

// ==========================================
// Initialization & Event Listeners
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadCategories();

  setupEventListeners();
  checkCurrentTab();
  loadFooterStats();
});

function setupEventListeners() {
  btnCheckEl.addEventListener('click', handleManualCheck);

  inputDomainEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleManualCheck();
  });

  btnSettingsEl.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('views/settings/settings.html') });
    }
  });

  btnReportsEl.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('views/reports/reports.html') });
  });

  btnRefreshEl.addEventListener('click', handleRefresh);
  btnAddReportEl.addEventListener('click', handleAddReport);

  const btnManualAdd = document.getElementById('btn-manual-add');
  if (btnManualAdd) btnManualAdd.addEventListener('click', handleManualAdd);
}

// ==========================================
// Core Domain Checking
// ==========================================

async function checkCurrentTab() {
  try {
    const result = await sendMessage({ action: 'checkCurrentTab' });

    if (result.error || !result.currentDomain) {
      displayNoDomain(result.error);
      return;
    }

    currentTabDomain = result.currentDomain;
    currentTabUrl = result.tabUrl;

    renderStatusCard(result, statusCardContainer);
    setupTabReportControls(result);
  } catch (error) {
    displayNoDomain(error.message);
  }
}

async function handleManualCheck() {
  const input = inputDomainEl.value.trim();
  if (!input) return;

  btnCheckEl.disabled = true;
  manualAddRow.hidden = true;
  manualAddFeedback.hidden = true;

  resultEl.innerHTML = `
    <div class="status-card">
      <div class="status-card__loading">
        <div class="spinner"></div>
        <span>Checking domain ${escapeHtml(input)}...</span>
      </div>
    </div>
  `;

  try {
    const domainToQuery = extractDomainFromInput(input);
    const result = await sendMessage({
      action: 'checkDomain',
      domain: domainToQuery
    });

    lastCheckedDomain = result.cleanDomain || domainToQuery;
    renderStatusCard(result, resultEl);

    manualAddRow.hidden = false;
  } catch (error) {
    resultEl.innerHTML = `
      <div class="status-card status-card--danger">
        <div class="status-card__message">Error checking domain: ${escapeHtml(error.message)}</div>
      </div>
    `;
  } finally {
    btnCheckEl.disabled = false;
  }
}

// ==========================================
// Status Card Rendering
// ==========================================

function renderStatusCard(result, container) {
  const cardData = buildCheckCard(result);

  container.innerHTML = `
    <div class="status-card status-card--${cardData.cardClass}">
      <div class="status-card__header">
        <div class="status-card__indicator"></div>
        <div class="status-card__domain">${escapeHtml(cardData.displayDomain)}</div>
      </div>
      <div class="status-card__message">${escapeHtml(cardData.messageText)}</div>
      ${buildCheckDetails(result)}
    </div>
  `;

  container.querySelectorAll('.copy-ip-value').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ip = el.dataset.ip;
      if (!ip) return;
      try {
        await navigator.clipboard.writeText(ip);
        const icon = el.querySelector('.copy-icon');
        if (icon) {
          icon.textContent = '✔️';
          setTimeout(() => { icon.textContent = '📋'; }, 2000);
        }
      } catch { }
    });
  });
}

function buildCheckCard(result) {
  if (result.isExcluded) {
    return {
      cardClass: 'excluded',
      displayDomain: result.cleanDomain || result.currentDomain,
      messageText: 'Domain is on the excluded list'
    };
  }

  if (result.found) {
    return {
      cardClass: 'danger',
      displayDomain: result.matchedDomain || result.cleanDomain || result.currentDomain,
      messageText: '🚨 Domain found on hole.cert.pl!'
    };
  }

  return {
    cardClass: 'safe',
    displayDomain: result.cleanDomain || result.currentDomain || 'Safe',
    messageText: '✔️ Domain is NOT on the hole.cert.pl'
  };
}

function buildCheckDetails(result) {
  const details = [];

  if (result.matchedDomain && result.matchedDomain !== result.cleanDomain) {
    details.push(['Matched domain:', result.matchedDomain, false]);
  }

  if (result.ip) {
    const copyIpHtml = `
      <span class="copy-ip-value" data-ip="${escapeHtml(result.ip)}" title="Click to copy IP address">
        ${escapeHtml(result.ip)} <span class="copy-icon">📋</span>
      </span>
    `;
    details.push(['IP Address:', copyIpHtml, true]);
  }

  if (result.ipDetails) {
    const orgName = result.ipDetails.org || result.ipDetails.isp || '';
    let wafLabel = orgName;
    if (result.isIpExcluded) {
      wafLabel += wafLabel ? ' (WAF Ignored)' : 'WAF Ignored';
    }
    if (wafLabel) {
      details.push(['WAF / Provider:', wafLabel, false]);
    }
  } else if (result.isIpExcluded) {
    details.push(['WAF Status:', 'WAF Protection (Ignored)', false]);
  }

  const sslIssuer = result.sslIssuer || result.sslDetails?.issuer;
  if (sslIssuer) {
    details.push(['SSL Issuer:', sslIssuer, false]);
  }

  if (result.isHttps === false) {
    details.push(['HTTP Status:', '⚠️ Insecure connection (HTTP)', false]);
  }

  if (details.length === 0) return '';

  const rowsHtml = details.map(([label, val, isHtml]) => `
    <div class="status-card__detail">
      <span class="status-card__detail-label">${escapeHtml(label)}</span>
      <span class="status-card__detail-value">${isHtml ? val : escapeHtml(val)}</span>
    </div>
  `).join('');

  return `<div class="status-card__details">${rowsHtml}</div>`;
}

function displayNoDomain(errorMsg) {
  statusCardContainer.innerHTML = `
    <div class="status-card">
      <div class="status-card__message" style="color: var(--text-tertiary);">
        ${escapeHtml(errorMsg || 'No active website to inspect.')}
      </div>
    </div>
  `;
}

// ==========================================
// Reporting & Categories
// ==========================================

async function loadCategories() {
  try {
    const settings = await sendMessage({ action: 'getSettings' });
    categories = settings?.categories?.length > 0 ? settings.categories : ['other'];
  } catch {
    categories = ['other'];
  }

  const optionsHtml = categories.map(cat =>
    `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`
  ).join('');

  reportCategorySelect.innerHTML = optionsHtml;
  manualAddCategory.innerHTML = optionsHtml;
}

function setupTabReportControls(result) {
  if (result.isExcluded || !currentTabUrl) {
    reportActionRow.hidden = true;
    return;
  }
  reportActionRow.hidden = false;

  if (result.onLocalReportList) {
    btnAddReportEl.className = 'btn-report-add btn-report-add--disabled';
    btnAddReportEl.innerHTML = `<span>✅ Domain added</span>`;
    btnAddReportEl.disabled = true;
    reportCategorySelect.disabled = true;
  } else {
    btnAddReportEl.className = 'btn-report-add';
    btnAddReportEl.innerHTML = '<span>➕ Add to List</span>';
    btnAddReportEl.disabled = false;
    reportCategorySelect.disabled = false;
  }
}

async function handleAddReport() {
  if (!currentTabUrl) return;

  const category = reportCategorySelect.value;
  btnAddReportEl.disabled = true;

  try {
    const response = await sendMessage({
      action: 'addReport',
      url: currentTabUrl,
      category
    });

    if (response.added > 0) {
      btnAddReportEl.className = 'btn-report-add btn-report-add--success';
      btnAddReportEl.innerHTML = '<span>✅ Domain added</span>';
    } else if (response.existingDate) {
      btnAddReportEl.className = 'btn-report-add';
      btnAddReportEl.innerHTML = `<span>⚠ Already on list (${response.existingDate})</span>`;
    } else {
      btnAddReportEl.className = 'btn-report-add';
      btnAddReportEl.innerHTML = '<span>⚠ Could not add</span>';
    }
  } catch {
    btnAddReportEl.className = 'btn-report-add';
    btnAddReportEl.innerHTML = '<span>❌ Error adding</span>';
  }
}

async function handleManualAdd() {
  const raw = inputDomainEl.value.trim();
  if (!raw) return;

  const cat = manualAddCategory.value;
  const clean = cleanUrl(raw);

  if (!clean) {
    showManualAddFeedback('Invalid URL or domain', 'error');
    return;
  }

  try {
    const resp = await sendMessage({
      action: 'addReport',
      url: clean,
      category: cat
    });

    if (resp.added > 0) {
      showManualAddFeedback(`✓ Added ${clean} to report list`, 'success');
      inputDomainEl.value = '';
    } else if (resp.existingDate) {
      showManualAddFeedback(`⚠ Domain already on list (${resp.existingDate})`, 'warn');
    } else {
      showManualAddFeedback('Could not add domain', 'warn');
    }
  } catch {
    showManualAddFeedback('Error adding domain', 'error');
  }
}

function showManualAddFeedback(msg, type) {
  manualAddFeedback.hidden = false;
  manualAddFeedback.textContent = msg;
  manualAddFeedback.className = `manual-add-feedback manual-add-feedback--${type}`;

  clearTimeout(manualAddFeedbackTimeout);
  manualAddFeedbackTimeout = setTimeout(() => {
    manualAddFeedback.hidden = true;
  }, 4000);
}

// ==========================================
// Footer Stats & Cache Refresh
// ==========================================

async function loadFooterStats() {
  try {
    const status = await sendMessage({ action: 'getListStatus' });

    footerCountEl.textContent = status.totalDomains
      ? `${status.totalDomains.toLocaleString('en-US')} domains`
      : '0 domains';

    footerUpdatedEl.textContent = status.lastUpdated
      ? formatRelativeTime(status.lastUpdated)
      : 'Not updated';

  } catch {
    footerCountEl.textContent = '—';
    footerUpdatedEl.textContent = 'Offline';
  }
}

async function handleRefresh() {
  btnRefreshEl.classList.add('footer__refresh--spinning');
  btnRefreshEl.disabled = true;

  try {
    const result = await sendMessage({ action: 'forceRefresh' });
    if (result.success) {
      footerCountEl.textContent = `${result.totalDomains.toLocaleString('en-US')} domains`;
      footerUpdatedEl.textContent = 'just now';
      if (currentTabDomain) checkCurrentTab();
    }
  } catch (e) {
    console.error('Refresh error:', e);
  } finally {
    setTimeout(() => {
      btnRefreshEl.classList.remove('footer__refresh--spinning');
      btnRefreshEl.disabled = false;
    }, 600);
  }
}

// ==========================================
// Helpers
// ==========================================

function extractDomainFromInput(input) {
  let cleaned = input.toLowerCase().trim();
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      cleaned = new URL(cleaned).hostname;
    } catch { }
  }
  return cleaned;
}

function formatRelativeTime(isoString) {
  try {
    const diff = Math.floor((new Date() - new Date(isoString)) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    return `${Math.floor(diff / 86400)} d ago`;
  } catch {
    return isoString;
  }
}
