/**
 * Google Search Checkboxes - Content Script
 */

(function () {
  'use strict';

  if (window.__ultraCheckboxesInit) return;
  window.__ultraCheckboxesInit = true;

  let isEnabled = false;
  let categories = [];
  let reportedUrls = {};
  let actionBar = null;
  let feedbackTimeout = null;
  let mutationTimeout = null;

  const domainStatusCache = new Map();

  // ==========================================
  // DOM & Checkbox Elements
  // ==========================================

  /** Builds wrapper element containing checkbox and badge. */
  function buildCheckboxWrap(domain, resultUrl) {
    const status = getDomainStatus(domain);

    const wrap = document.createElement('span');
    wrap.className = 'ultra-wrap';
    wrap.dataset.domain = domain;
    wrap.dataset.url = resultUrl;
    wrap.addEventListener('click', (e) => e.stopPropagation());

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'ultra-cb';
    cb.title = `Check to add ${domain} to report list`;
    cb.dataset.domain = domain;
    cb.dataset.url = resultUrl;

    if (status.onCertList) cb.classList.add('ultra-cb--cert');
    else if (status.onLocalList) cb.classList.add('ultra-cb--local');

    cb.addEventListener('change', updateActionBar);

    appendBadge(wrap, status);
    wrap.appendChild(cb);
    return wrap;
  }

  /** Appends status badge to checkbox wrapper. */
  function appendBadge(wrap, status) {
    wrap.querySelectorAll('.ultra-badge').forEach(b => b.remove());

    let badge = null;
    if (status.onCertList) {
      badge = document.createElement('span');
      badge.className = 'ultra-badge ultra-badge--cert';
      badge.textContent = 'BLOCKED';
      badge.title = 'Domain is on the blocklist';
    } else if (status.onLocalList) {
      badge = document.createElement('span');
      badge.className = 'ultra-badge ultra-badge--local';
      badge.textContent = 'on list';
      badge.title = 'Domain is already in your local report list';
    }

    if (badge) {
      const cb = wrap.querySelector('.ultra-cb');
      if (cb) wrap.insertBefore(badge, cb);
      else wrap.appendChild(badge);
    }
  }

  /** Refreshes classes and badges for all injected search checkboxes. */
  function refreshAllCheckboxStatuses() {
    document.querySelectorAll('.ultra-wrap').forEach(wrap => {
      const domain = wrap.dataset.domain;
      if (!domain) return;
      const status = getDomainStatus(domain);
      const cb = wrap.querySelector('.ultra-cb');
      if (!cb) return;

      cb.classList.remove('ultra-cb--cert', 'ultra-cb--local');
      if (status.onCertList) cb.classList.add('ultra-cb--cert');
      else if (status.onLocalList) cb.classList.add('ultra-cb--local');

      appendBadge(wrap, status);
    });
  }

  /** Injects checkbox wrapper into Google search result H3 element. */
  function injectIntoH3(h3) {
    const anchor = h3.closest('a[href]');
    if (!anchor || anchor.dataset.ultraWrapped) return;
    anchor.dataset.ultraWrapped = '1';

    const href = anchor.href;
    if (!href || href.startsWith('javascript:') || href === '#') return;

    const resolvedUrl = resolveGoogleUrl(href);
    const domain = extractCleanDomain(resolvedUrl);
    if (!domain || isGoogleDomain(domain)) return;

    const wrap = buildCheckboxWrap(domain, resolvedUrl);
    h3.insertBefore(wrap, h3.firstChild);
  }

  /** Scans search result container for H3 headers. */
  function processPage() {
    const rso = document.getElementById('rso') || document.getElementById('search') || document.body;
    if (!rso) return;

    rso.querySelectorAll('h3').forEach(injectIntoH3);
  }

  /** Queries background worker for domain blocklist statuses and applies badges. */
  async function fetchAndApplyStatuses() {
    const rso = document.getElementById('rso') || document.getElementById('search') || document.body;
    const domainsToCheck = [];
    const seen = new Set();

    rso.querySelectorAll('a[data-ultra-wrapped]').forEach(anchor => {
      const url = resolveGoogleUrl(anchor.href);
      const domain = extractCleanDomain(url);
      if (domain && !seen.has(domain) && !isGoogleDomain(domain)) {
        seen.add(domain);
        domainsToCheck.push(domain);
      }
    });

    if (domainsToCheck.length === 0) return;

    try {
      const response = await sendMessage({ action: 'checkMultipleDomains', domains: domainsToCheck });
      if (!Array.isArray(response?.results)) return;

      for (const item of response.results) {
        const cleanDom = extractCleanDomain(item.domain) || item.domain;
        domainStatusCache.set(item.domain, {
          onCertList: item.onCertList,
          onLocalList: item.onLocalList || isOnLocalList(cleanDom)
        });
        domainStatusCache.set(cleanDom, {
          onCertList: item.onCertList,
          onLocalList: item.onLocalList || isOnLocalList(cleanDom)
        });
      }

      refreshAllCheckboxStatuses();
    } catch (e) {
      console.warn('[ULTRA Phish Catcher] Error querying domain statuses:', e.message);
    }
  }

  // ==========================================
  // Bottom Action Bar UI
  // ==========================================

  /** Retrieves selected domains from checked checkboxes. */
  function getCheckedDomains() {
    const seen = new Set();
    const checked = [];
    document.querySelectorAll('.ultra-cb:checked').forEach(cb => {
      const { domain, url } = cb.dataset;
      if (domain && !seen.has(domain)) {
        seen.add(domain);
        checked.push({ domain, url });
      }
    });
    return checked;
  }

  /** Shows bottom action bar. */
  function showActionBar() {
    if (actionBar) return;

    actionBar = document.createElement('div');
    actionBar.id = 'ultra-action-bar';

    const catOptions = categories
      .map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`)
      .join('');

    actionBar.innerHTML = `
      <span class="ultra-bar__icon">🛡️</span>
      <span class="ultra-bar__count">Selected: <span id="ultra-bar-count-num">0</span> domains</span>
      <select class="ultra-bar__select" id="ultra-bar-category">${catOptions}</select>
      <button class="ultra-bar__btn" id="ultra-bar-add">Add to list</button>
      <button class="ultra-bar__dismiss" id="ultra-bar-dismiss">✕ Deselect</button>
    `;

    document.body.appendChild(actionBar);

    document.getElementById('ultra-bar-add').addEventListener('click', handleAddToList);
    document.getElementById('ultra-bar-dismiss').addEventListener('click', () => {
      document.querySelectorAll('.ultra-cb').forEach(cb => { cb.checked = false; });
      updateActionBar();
    });
  }

  /** Hides bottom action bar. */
  function hideActionBar() {
    if (!actionBar) return;
    actionBar.classList.add('ultra-bar--hiding');
    setTimeout(() => {
      if (actionBar) {
        actionBar.remove();
        actionBar = null;
      }
    }, 220);
  }

  /** Updates action bar counter or hides bar if no checkboxes selected. */
  function updateActionBar() {
    const checked = getCheckedDomains();
    if (checked.length === 0) {
      hideActionBar();
      return;
    }
    if (!actionBar) showActionBar();
    const el = document.getElementById('ultra-bar-count-num');
    if (el) el.textContent = checked.length;
  }

  /** Submits multiple selected domains to report list. */
  async function handleAddToList() {
    const checked = getCheckedDomains();
    if (checked.length === 0) return;

    const selectEl = document.getElementById('ultra-bar-category');
    const category = selectEl?.value || categories[0] || 'other';

    const addBtn = document.getElementById('ultra-bar-add');
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Adding...'; }

    try {
      const domains = Array.from(new Set(checked.map(c => c.domain || c.url)));
      const response = await sendMessage({
        action: 'addMultipleToReport',
        urls: domains,
        category
      });

      if (response) {
        const storage = await chrome.storage.local.get('reported_urls');
        reportedUrls = storage.reported_urls || {};

        for (const { domain } of checked) {
          const existing = domainStatusCache.get(domain) || { onCertList: false };
          domainStatusCache.set(domain, { ...existing, onLocalList: true });
        }

        refreshAllCheckboxStatuses();

        const msg = response.added === 0
          ? '✓ All domains already on list'
          : `✓ Added ${response.added}` +
            (response.skipped > 0 ? ` (${response.skipped} skipped — duplicates)` : '');
        showBarFeedback(msg, 'success');

        document.querySelectorAll('.ultra-cb').forEach(cb => { cb.checked = false; });
        updateActionBar();
      }
    } catch (e) {
      showBarFeedback('✗ Add error', 'error');
      console.error('[ULTRA Phish Catcher]', e);
    } finally {
      if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add to list'; }
    }
  }

  /** Displays feedback message in bottom action bar. */
  function showBarFeedback(text, type) {
    if (!actionBar) return;
    actionBar.querySelectorAll('.ultra-bar__feedback').forEach(f => f.remove());
    clearTimeout(feedbackTimeout);

    const fb = document.createElement('span');
    fb.className = `ultra-bar__feedback ultra-bar__feedback--${type}`;
    fb.textContent = text;
    actionBar.appendChild(fb);

    feedbackTimeout = setTimeout(() => fb.remove(), 4000);
  }

  // ==========================================
  // Domain Helpers & Initialization
  // ==========================================

  /** Extracts hostname from URL. */
  function extractCleanDomain(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
      const urlToParse = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
      let host = new URL(urlToParse).hostname.toLowerCase();
      return host.startsWith('www.') ? host.slice(4) : host;
    } catch {
      return null;
    }
  }

  /** Checks if domain is an internal Google infrastructure domain. */
  function isGoogleDomain(domain) {
    if (!domain) return true;
    const skip = ['google.', 'gstatic.com', 'googleapis.com', 'youtube.com', 'googleusercontent.com', 'ampproject.org'];
    return skip.some(s => domain.includes(s));
  }

  /** Resolves Google search redirect URL (/url?q=...). */
  function resolveGoogleUrl(href) {
    try {
      const u = new URL(href);
      if ((u.hostname === 'www.google.com' || u.hostname === 'google.com') && u.pathname === '/url') {
        return u.searchParams.get('q') || href;
      }
    } catch { }
    return href;
  }

  function getDomainStatus(domain) {
    return domainStatusCache.get(domain) || { onCertList: false, onLocalList: false };
  }

  function isOnLocalList(domain) {
    for (const list of Object.values(reportedUrls)) {
      if (Array.isArray(list) && list.some(url => extractCleanDomain(url) === domain)) {
        return true;
      }
    }
    return false;
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(async () => {
      processPage();
      await fetchAndApplyStatuses();
    }, 400);
  });

  async function init() {
    try {
      const settingsResp = await sendMessage({ action: 'getSettings' });
      isEnabled = settingsResp?.googleSearchCheckboxes !== false;
      if (!isEnabled) return;

      categories = settingsResp?.categories?.length > 0 ? settingsResp.categories : ['other'];

      const storage = await chrome.storage.local.get('reported_urls');
      reportedUrls = storage.reported_urls || {};

      processPage();
      await fetchAndApplyStatuses();

      const rso = document.getElementById('rso') || document.getElementById('search') || document.body;
      observer.observe(rso, { childList: true, subtree: true });
    } catch (e) {
      console.warn('[ULTRA Phish Catcher] Initialization error:', e.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
