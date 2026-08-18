/**
 * Google Search Checkboxes - Chrome Content Script
 */

(function () {
  'use strict';

  if (window.__phishtackleCheckboxesInit) return;
  window.__phishtackleCheckboxesInit = true;

  let isEnabled = true;
  let categories = ['other'];
  let reportedUrls = {};
  let actionBar = null;
  let feedbackTimeout = null;
  let mutationTimeout = null;

  const domainStatusCache = new Map();

  // ==========================================
  // DOM & Checkbox Elements
  // ==========================================

  /** Builds wrapper element containing checkbox and status badge. */
  function buildCheckboxWrap(domain, resultUrl) {
    const status = getDomainStatus(domain);

    const wrap = document.createElement('span');
    wrap.className = 'phishtackle-wrap';
    wrap.dataset.domain = domain || '';
    wrap.dataset.url = resultUrl || '';

    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      setTimeout(updateActionBar, 0);
    });
    wrap.addEventListener('mousedown', (e) => e.stopPropagation());

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'phishtackle-cb';
    cb.title = domain ? `Check to add ${domain} to report list` : 'Check to add to report list';
    cb.dataset.domain = domain || '';
    cb.dataset.url = resultUrl || '';

    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      setTimeout(updateActionBar, 0);
    });
    cb.addEventListener('change', updateActionBar);
    cb.addEventListener('mousedown', (e) => e.stopPropagation());

    if (status.onCertList) cb.classList.add('phishtackle-cb--cert');
    else if (status.onLocalList) cb.classList.add('phishtackle-cb--local');

    appendBadge(wrap, status);
    wrap.appendChild(cb);
    return wrap;
  }

  /** Appends status badge to checkbox wrapper (CERT / LIST). */
  function appendBadge(wrap, status) {
    wrap.querySelectorAll('.phishtackle-badge').forEach(b => b.remove());

    let badge = null;
    if (status.onCertList) {
      badge = document.createElement('span');
      badge.className = 'phishtackle-badge phishtackle-badge--cert';
      badge.textContent = 'CERT';
      badge.title = 'Domain is on the blocklist';
    } else if (status.onLocalList) {
      badge = document.createElement('span');
      badge.className = 'phishtackle-badge phishtackle-badge--local';
      badge.textContent = 'LIST';
      badge.title = 'Domain is already in your local report list';
    }

    if (badge) {
      const cb = wrap.querySelector('.phishtackle-cb');
      if (cb) wrap.insertBefore(badge, cb);
      else wrap.appendChild(badge);
    }
  }

  /** Refreshes classes and badges for all injected search checkboxes. */
  function refreshAllCheckboxStatuses() {
    document.querySelectorAll('.phishtackle-wrap').forEach(wrap => {
      const domain = wrap.dataset.domain;
      if (!domain) return;
      const status = getDomainStatus(domain);
      const cb = wrap.querySelector('.phishtackle-cb');
      if (!cb) return;

      cb.classList.remove('phishtackle-cb--cert', 'phishtackle-cb--local');
      if (status.onCertList) cb.classList.add('phishtackle-cb--cert');
      else if (status.onLocalList) cb.classList.add('phishtackle-cb--local');

      appendBadge(wrap, status);
    });
  }

  /** Finds the target search result anchor link pointing to a NON-Google domain. */
  function findResultAnchor(h3) {
    const card = h3.closest('.yuRUbf, .g, .MjjYud, div[data-hveid], div[data-ved], div[data-snc]') || h3.parentElement;

    const candidates = [
      h3.closest('a[href]'),
      h3.querySelector('a[href]'),
      h3.parentElement?.closest('a[href]'),
      h3.parentElement?.querySelector('a[href]')
    ];

    if (card) {
      card.querySelectorAll('a[href]').forEach(a => candidates.push(a));
    }

    for (const a of candidates) {
      if (!a) continue;
      const rawHref = a.getAttribute('href') || a.getAttribute('data-href') || a.href;
      if (!rawHref || rawHref.startsWith('javascript:') || rawHref === '#') continue;

      const resolvedUrl = resolveGoogleUrl(rawHref);
      const domain = extractCleanDomain(resolvedUrl);

      if (domain && !isGoogleDomain(domain)) {
        return { anchor: a, rawHref, resolvedUrl, domain };
      }
    }

    return null;
  }

  /** Injects checkbox wrapper into Google search result title element (H3 / .LC20lb). */
  function injectIntoH3(h3) {
    if (h3.dataset.phishtackleWrapped || h3.querySelector('.phishtackle-wrap')) return;

    const match = findResultAnchor(h3);
    const domain = match ? match.domain : null;
    const resolvedUrl = match ? match.resolvedUrl : null;
    const anchor = match ? match.anchor : (h3.closest('a[href]') || h3.querySelector('a[href]'));

    h3.dataset.phishtackleWrapped = '1';
    if (anchor) anchor.dataset.phishtackleWrapped = '1';

    const wrap = buildCheckboxWrap(domain, resolvedUrl);
    h3.insertBefore(wrap, h3.firstChild);
  }

  /** Scans search result container for H3 headers and search titles. */
  function processPage() {
    if (!isEnabled) return;
    const rso = document.getElementById('rso') || document.getElementById('search') || document.body;
    if (!rso) return;

    const headings = rso.querySelectorAll('h3, .LC20lb, div[role="heading"]');
    headings.forEach(injectIntoH3);
  }

  /** Queries background worker for domain blocklist statuses and applies badges. */
  async function fetchAndApplyStatuses() {
    if (!isEnabled) return;
    const rso = document.getElementById('rso') || document.getElementById('search') || document.body;
    const domainsToCheck = [];
    const seen = new Set();

    rso.querySelectorAll('.phishtackle-wrap').forEach(wrap => {
      const domain = wrap.dataset.domain;
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
      console.warn('[PhishTackle] Error querying domain statuses:', e.message);
    }
  }

  // ==========================================
  // Bottom Action Bar UI
  // ==========================================

  /** Retrieves selected domains from checked checkboxes. Resolves domain dynamically if needed. */
  function getCheckedDomains() {
    const seen = new Set();
    const checked = [];
    const checkedCbs = Array.from(document.querySelectorAll('.phishtackle-cb:checked'));

    checkedCbs.forEach(cb => {
      let domain = cb.dataset.domain;
      let url = cb.dataset.url;

      if (!domain || isGoogleDomain(domain)) {
        domain = extractCleanDomain(url);
      }

      // Dynamic fallback: resolve from parent card if dataset had empty domain
      if (!domain || isGoogleDomain(domain)) {
        const wrap = cb.closest('.phishtackle-wrap');
        const card = wrap?.closest('.yuRUbf, .g, .MjjYud, div[data-hveid]') || wrap?.parentElement;
        if (card) {
          const anchors = Array.from(card.querySelectorAll('a[href]'));
          for (const a of anchors) {
            const rawHref = a.getAttribute('href') || a.href;
            if (!rawHref || rawHref.startsWith('javascript:') || rawHref === '#') continue;
            const resUrl = resolveGoogleUrl(rawHref);
            const dom = extractCleanDomain(resUrl);
            if (dom && !isGoogleDomain(dom)) {
              domain = dom;
              url = resUrl;
              cb.dataset.domain = dom;
              cb.dataset.url = resUrl;
              break;
            }
          }
        }
      }

      if (domain && !isGoogleDomain(domain) && !seen.has(domain)) {
        seen.add(domain);
        checked.push({ domain, url: url || `https://${domain}` });
      }
    });

    return checked;
  }

  /** Shows bottom action bar. */
  function showActionBar() {
    if (actionBar) return;

    actionBar = document.createElement('div');
    actionBar.id = 'phishtackle-action-bar';
    actionBar.style.cssText = 'position: fixed !important; bottom: 24px !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 2147483647 !important; background: #1c1f2e !important; border: 1px solid rgba(255, 255, 255, 0.2) !important; border-radius: 10px !important; padding: 10px 18px !important; display: flex !important; align-items: center !important; gap: 12px !important; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6) !important; font-family: system-ui, -apple-system, sans-serif !important; font-size: 13px !important; color: #e8eaf0 !important; visibility: visible !important; opacity: 1 !important;';

    const catOptions = categories
      .map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`)
      .join('');

    actionBar.innerHTML = `
      <span class="phishtackle-bar__title">PhishTackle</span>
      <span class="phishtackle-bar__count">Selected: <span id="phishtackle-bar-count-num">0</span> domains</span>
      <select class="phishtackle-bar__select" id="phishtackle-bar-category">${catOptions}</select>
      <button class="phishtackle-bar__btn" id="phishtackle-bar-add">Add to list</button>
      <button class="phishtackle-bar__dismiss" id="phishtackle-bar-dismiss">✕ Deselect</button>
    `;

    document.body.appendChild(actionBar);

    document.getElementById('phishtackle-bar-add').addEventListener('click', handleAddToList);
    document.getElementById('phishtackle-bar-dismiss').addEventListener('click', () => {
      document.querySelectorAll('.phishtackle-cb').forEach(cb => { cb.checked = false; });
      updateActionBar();
    });
  }

  /** Hides bottom action bar. */
  function hideActionBar() {
    if (!actionBar) return;
    actionBar.classList.add('phishtackle-bar--hiding');
    setTimeout(() => {
      const checkedCbs = Array.from(document.querySelectorAll('.phishtackle-cb:checked'));
      if (actionBar && checkedCbs.length === 0) {
        actionBar.remove();
        actionBar = null;
      }
    }, 200);
  }

  /** Updates or hides bottom action bar based on current selections. Guaranteed execution based on checked checkbox count. */
  function updateActionBar() {
    const checkedCbs = Array.from(document.querySelectorAll('.phishtackle-cb:checked'));

    if (checkedCbs.length === 0) {
      hideActionBar();
      return;
    }

    if (!actionBar) {
      showActionBar();
    }

    if (actionBar) {
      actionBar.style.display = 'flex';
      actionBar.style.visibility = 'visible';
      actionBar.style.opacity = '1';
      actionBar.classList.remove('phishtackle-bar--hiding');
      const countEl = document.getElementById('phishtackle-bar-count-num');
      if (countEl) countEl.textContent = checkedCbs.length;
    }
  }

  /** Handles adding selected domains to local report list. */
  async function handleAddToList() {
    const checked = getCheckedDomains();
    if (checked.length === 0) return;

    const selectEl = document.getElementById('phishtackle-bar-category');
    const category = selectEl ? selectEl.value : (categories[0] || 'other');
    const addBtn = document.getElementById('phishtackle-bar-add');
    if (addBtn) addBtn.disabled = true;

    let addedCount = 0;
    let skippedCount = 0;

    for (const item of checked) {
      try {
        const result = await sendMessage({
          action: 'addReport',
          url: item.url || `https://${item.domain}`,
          category
        });
        if (result?.added > 0) addedCount++;
        else skippedCount++;
      } catch (e) {
        console.warn(`[PhishTackle] Error adding ${item.domain}:`, e.message);
      }
    }

    try {
      const storage = await chrome.storage.local.get('reported_urls');
      reportedUrls = storage.reported_urls || {};
    } catch { }

    checked.forEach(item => {
      const cleanDom = extractCleanDomain(item.domain) || item.domain;
      domainStatusCache.set(item.domain, { onCertList: false, onLocalList: true });
      domainStatusCache.set(cleanDom, { onCertList: false, onLocalList: true });
    });

    refreshAllCheckboxStatuses();

    let msg = '';
    if (addedCount > 0 && skippedCount > 0) {
      msg = `Added ${addedCount}, skipped ${skippedCount} duplicate(s)`;
    } else if (addedCount > 0) {
      msg = `Added ${addedCount} domain(s)!`;
    } else {
      msg = `All ${skippedCount} domain(s) already in list`;
    }
    showBarFeedback(msg, addedCount > 0 ? 'success' : 'error');

    setTimeout(() => {
      document.querySelectorAll('.phishtackle-cb').forEach(cb => { cb.checked = false; });
      updateActionBar();
    }, 1500);
  }

  // ==========================================
  // Domain Helpers & Initialization
  // ==========================================

  /** Extracts hostname cleanly from URL, stripping breadcrumbs and invalid characters. */
  function extractCleanDomain(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
      let str = rawUrl.trim();
      str = str.replace(/[›>]/g, ' ').trim();
      if (str.includes(' ')) {
        str = str.split(/\s+/)[0];
      }

      const urlToParse = /^https?:\/\//i.test(str) ? str : 'https://' + str;
      let host = new URL(urlToParse).hostname.toLowerCase();
      host = host.replace(/[^a-z0-9.-]/g, '');
      if (!host || !host.includes('.')) return null;
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

  /** Resolves Google search redirect URL (/url?q=...). Scans query parameters for embedded target URLs. */
  function resolveGoogleUrl(href) {
    if (!href) return href;
    try {
      const base = window.location.origin;
      const u = new URL(href, base);
      if (u.hostname.includes('google.')) {
        for (const [key, val] of u.searchParams.entries()) {
          if (!val) continue;
          let decoded = val;
          try { decoded = decodeURIComponent(val); } catch { }
          if (/^https?:\/\//i.test(decoded)) {
            const dom = extractCleanDomain(decoded);
            if (dom && !isGoogleDomain(dom)) {
              return decoded;
            }
          }
        }
      }
      return u.href;
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

  function showBarFeedback(text, type) {
    if (!actionBar) return;
    actionBar.querySelectorAll('.phishtackle-bar__feedback').forEach(f => f.remove());
    clearTimeout(feedbackTimeout);

    const fb = document.createElement('span');
    fb.className = `phishtackle-bar__feedback phishtackle-bar__feedback--${type}`;
    fb.textContent = text;
    actionBar.appendChild(fb);

    feedbackTimeout = setTimeout(() => fb.remove(), 4000);
  }

  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(async () => {
      processPage();
      await fetchAndApplyStatuses();
    }, 250);
  });

  async function init() {
    processPage();

    try {
      const settingsResp = await sendMessage({ action: 'getSettings' }).catch(() => null);
      if (settingsResp && settingsResp.googleSearchCheckboxes === false) {
        isEnabled = false;
        document.querySelectorAll('.phishtackle-wrap').forEach(w => w.remove());
        return;
      }
      if (settingsResp?.categories?.length > 0) {
        categories = settingsResp.categories;
      }
      const storage = await chrome.storage.local.get('reported_urls').catch(() => ({}));
      reportedUrls = storage.reported_urls || {};

      await fetchAndApplyStatuses();
    } catch (e) {
      console.warn('[PhishTackle] Non-critical init settings warning:', e);
    }

    const target = document.getElementById('rso') || document.getElementById('search') || document.documentElement;
    observer.observe(target, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
