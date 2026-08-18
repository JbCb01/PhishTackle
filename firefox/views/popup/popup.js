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

btnSettingsEl?.addEventListener('click', () => {
  if (chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('views/settings/settings.html') });
  }
});

btnReportsEl?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('views/reports/reports.html') });
});

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkCurrentTab().catch(() => {});
  loadCategories().catch(() => {});
  loadFooterStats().catch(() => {});
});

function setupEventListeners() {
  btnCheckEl.addEventListener('click', handleManualCheck);

  inputDomainEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleManualCheck();
  });

  btnRefreshEl.addEventListener('click', handleRefresh);
  btnAddReportEl.addEventListener('click', handleAddReport);

  const btnManualAdd = document.getElementById('btn-manual-add');
  if (btnManualAdd) btnManualAdd.addEventListener('click', handleManualAdd);

  if (chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'sslDetailsUpdated') {
        if (message.domain === currentTabDomain || message.domain === activeManualDomain) {
          fetchSslUpdateOnly(message.domain, message.tabId);
        }
      }
    });
  }
}

// ==========================================
// Core Domain Checking
// ==========================================

let sslRetryCount = 0;
let manualSslRetryCount = 0;
let activeManualDomain = null;

function extractDomainFromInput(input) {
  if (!input) return '';
  try {
    return cleanUrl(input) || input;
  } catch {
    return input;
  }
}

async function checkCurrentTab() {
  let activeTab = null;

  try {
    let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0 || !tabs[0]?.url) {
      tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    }
    if (tabs && tabs.length > 0) {
      activeTab = tabs.find(t => t.url && !t.url.startsWith('about:') && !t.url.startsWith('moz-extension:') && !t.url.startsWith('chrome:'));
    }
  } catch { }

  if (!activeTab?.url) {
    displayNoDomain('No active website to inspect.');
    return;
  }

  const domain = extractDomainFromInput(activeTab.url);
  const isNewDomain = (currentTabDomain !== domain);
  currentTabDomain = domain;
  currentTabUrl = activeTab.url;

  // Render initial card ONLY if domain changed or container is empty!
  if (isNewDomain || !statusCardContainer.querySelector('.status-card')) {
    renderInitialCard(domain, activeTab.url, statusCardContainer);
  }

  try {
    const result = await sendMessage({
      action: 'checkDomainForTab',
      domain,
      tabId: activeTab.id,
      url: activeTab.url
    });

    if (result && !result.error) {
      renderStatusCard(result, statusCardContainer);
      setupTabReportControls(result);

      if (result.sslDetails?.source === 'loading' && sslRetryCount < 6) {
        sslRetryCount++;
        setTimeout(() => {
          if (currentTabDomain === domain) {
            fetchSslUpdateOnly(domain, activeTab.id);
          }
        }, 1000);
      } else if (result.sslDetails?.issuer) {
        sslRetryCount = 0;
      }
    }
  } catch (error) {
    console.error('Error checking tab domain:', error);
  }
}

async function fetchSslUpdateOnly(domain, tabId) {
  try {
    if (domain === currentTabDomain) {
      const result = await sendMessage({
        action: 'checkDomainForTab',
        domain,
        tabId: tabId || -1,
        url: currentTabUrl
      });
      if (result && !result.error && currentTabDomain === domain) {
        renderStatusCard(result, statusCardContainer);
      }
    }

    if (domain === activeManualDomain) {
      const result = await sendMessage({
        action: 'checkDomain',
        domain
      });
      if (result && !result.error && activeManualDomain === domain) {
        renderStatusCard(result, resultEl);
        manualAddRow.hidden = false;
      }
    }
  } catch { }
}

function renderInitialCard(domain, url, container) {
  const isHttps = url ? url.toLowerCase().startsWith('https:') : true;
  const initialResult = {
    currentDomain: domain,
    cleanDomain: domain,
    isHttps,
    isLoading: true,
    ip: null,
    ipDetails: null,
    sslDetails: isHttps ? { source: 'loading' } : null
  };
  renderStatusCard(initialResult, container);
}

async function handleManualCheck() {
  const input = inputDomainEl.value.trim();
  if (!input) return;

  btnCheckEl.disabled = true;
  manualAddRow.hidden = true;
  manualAddFeedback.hidden = true;

  const domainToQuery = extractDomainFromInput(input);
  activeManualDomain = domainToQuery;
  manualSslRetryCount = 0;
  renderInitialCard(domainToQuery, input, resultEl);

  try {
    const result = await sendMessage({
      action: 'checkDomain',
      domain: domainToQuery
    });

    if (activeManualDomain === domainToQuery) {
      lastCheckedDomain = result.cleanDomain || domainToQuery;
      renderStatusCard(result, resultEl);
      manualAddRow.hidden = false;

      if ((result.sslDetails?.source === 'loading' || !result.sslDetails?.issuer) && manualSslRetryCount < 6) {
        pollManualSsl(domainToQuery);
      }
    }
  } catch (error) {
    resultEl.innerHTML = `
      <div class="status-card">
        <div class="status-card__message" style="color: var(--text-tertiary);">Error checking domain: ${escapeHtml(error.message)}</div>
      </div>
    `;
  } finally {
    btnCheckEl.disabled = false;
  }
}

function pollManualSsl(domain) {
  if (manualSslRetryCount >= 6) return;
  manualSslRetryCount++;
  setTimeout(async () => {
    if (activeManualDomain === domain) {
      await fetchSslUpdateOnly(domain);
      const card = resultEl.querySelector('.status-card');
      const hasIssuer = card && !card.innerHTML.includes('[Checking...]');
      if (!hasIssuer && activeManualDomain === domain && manualSslRetryCount < 6) {
        pollManualSsl(domain);
      }
    }
  }, 1000);
}

// ==========================================
// Status Card Rendering
// ==========================================

function renderStatusCard(result, container) {
  const cardData = buildCheckCard(result);

  container.innerHTML = `
    <div class="status-card">
      <div class="status-card__header">
        <div class="status-card__indicator ${cardData.indicatorClass}"></div>
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
          icon.textContent = '[Copied]';
          setTimeout(() => { icon.textContent = '[Copy]'; }, 2000);
        }
      } catch { }
    });
  });
}

function buildCheckCard(result) {
  if (result.isLoading) {
    return {
      indicatorClass: 'status-card__indicator--checking',
      displayDomain: result.cleanDomain || result.currentDomain,
      messageText: ''
    };
  }

  if (result.isExcluded) {
    return {
      indicatorClass: 'status-card__indicator--excluded',
      displayDomain: result.cleanDomain || result.currentDomain,
      messageText: 'Domain is on the excluded list'
    };
  }

  if (result.found) {
    return {
      indicatorClass: 'status-card__indicator--danger',
      displayDomain: result.matchedDomain || result.cleanDomain || result.currentDomain,
      messageText: 'Domain found on hole.cert.pl list!'
    };
  }

  return {
    indicatorClass: 'status-card__indicator--safe',
    displayDomain: result.cleanDomain || result.currentDomain || '',
    messageText: 'Domain is NOT on hole.cert.pl list'
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
        ${escapeHtml(result.ip)} <span class="copy-icon">[Copy]</span>
      </span>
    `;
    details.push(['IP Address:', copyIpHtml, true]);
  } else {
    details.push(['IP Address:', '[Checking...]', false]);
  }

  if (result.ipDetails) {
    const orgName = result.ipDetails.org || result.ipDetails.isp || '';
    if (result.isIpExcluded) {
      const wafName = orgName || 'Detected';
      details.push(['WAF:', wafName, false]);
    } else if (orgName) {
      details.push(['Provider:', orgName, false]);
    }

    if (result.ipDetails.asn) {
      const asnStr = result.ipDetails.asn;
      const ispStr = result.ipDetails.isp && result.ipDetails.isp !== orgName ? ` (${result.ipDetails.isp})` : '';
      details.push(['ASN:', `${asnStr}${ispStr}`, false]);
    }
  } else if (result.isIpExcluded) {
    details.push(['WAF:', 'Detected', false]);
  } else if (result.isLoading || !result.ip) {
    details.push(['Provider:', '[Checking...]', false]);
    details.push(['ASN:', '[Checking...]', false]);
  }

  const sslDetails = result.sslDetails;
  const sslIssuer = result.sslIssuer || sslDetails?.issuer;

  const isDummySsl = !sslIssuer || sslIssuer.includes('Verified HTTPS') || sslIssuer === 'Unknown Issuer';

  if (!isDummySsl) {
    details.push(['SSL Issuer:', sslIssuer, false]);

    const subject = sslDetails?.subject;
    if (subject && !subject.includes('Verified HTTPS') && subject !== 'Unknown Subject') {
      details.push(['SSL Owner / Subject:', subject, false]);
    }

    if (sslDetails?.daysRemaining !== undefined && sslDetails?.daysRemaining !== null) {
      const days = sslDetails.daysRemaining;
      let expText = '';
      if (days > 0) {
        expText = `Valid (${days} ${days === 1 ? 'day' : 'days'} remaining)`;
      } else {
        expText = `Expired (${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago)`;
      }
      details.push(['SSL Expiration:', expText, false]);
    }
  } else if (result.isHttps === false) {
    details.push(['HTTP Status:', 'Insecure connection (HTTP)', false]);
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

let isAddAgainMode = false;
let addAgainTimeout = null;

function setupTabReportControls(result) {
  if (result.isExcluded || !currentTabUrl) {
    reportActionRow.hidden = true;
    return;
  }
  reportActionRow.hidden = false;
  reportCategorySelect.disabled = false;
  btnAddReportEl.disabled = false;

  if (result.onLocalReportList) {
    isAddAgainMode = true;
    btnAddReportEl.className = 'btn-report-add btn-report-add--again';
    btnAddReportEl.innerHTML = '<span>Add Again</span>';
  } else {
    isAddAgainMode = false;
    btnAddReportEl.className = 'btn-report-add';
    btnAddReportEl.innerHTML = '<span>Add to List</span>';
  }
}

async function handleAddReport() {
  if (!currentTabUrl) return;

  const category = reportCategorySelect.value;
  btnAddReportEl.disabled = true;
  reportCategorySelect.disabled = true;

  try {
    const response = await sendMessage({
      action: 'addReport',
      url: currentTabUrl,
      category,
      force: true
    });

    if (response.added > 0 || response.skipped >= 0) {
      btnAddReportEl.className = 'btn-report-add btn-report-add--success';
      btnAddReportEl.innerHTML = '<span>Domain Added</span>';

      clearTimeout(addAgainTimeout);
      addAgainTimeout = setTimeout(() => {
        isAddAgainMode = true;
        btnAddReportEl.className = 'btn-report-add btn-report-add--again';
        btnAddReportEl.innerHTML = '<span>Add Again</span>';
        btnAddReportEl.disabled = false;
        reportCategorySelect.disabled = false;
      }, 2500);
    } else {
      btnAddReportEl.className = 'btn-report-add';
      btnAddReportEl.innerHTML = '<span>Could not add</span>';
      btnAddReportEl.disabled = false;
      reportCategorySelect.disabled = false;
    }
  } catch {
    btnAddReportEl.className = 'btn-report-add';
    btnAddReportEl.innerHTML = '<span>Error adding</span>';
    btnAddReportEl.disabled = false;
    reportCategorySelect.disabled = false;
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
      showManualAddFeedback(`Added ${clean} to report list`, 'success');
      inputDomainEl.value = '';
    } else if (resp.existingDate) {
      showManualAddFeedback(`Domain already on list (${resp.existingDate})`, 'warn');
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
