/**
 * PhishTackle - URLScan Assistant Content Script (Firefox)
 */

(function () {
  'use strict';

  if (window.__phishtackleUrlscanInit) return;
  window.__phishtackleUrlscanInit = true;

  let isEnabled = true;
  let mutationTimeout = null;
  const domainStatusCache = new Map();

  /** Standard message wrapper for extension API */
  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        const api = typeof browser !== 'undefined' ? browser : chrome;
        api.runtime.sendMessage(message, (response) => {
          if (api.runtime.lastError) {
            resolve(null);
          } else {
            resolve(response);
          }
        });
      } catch {
        resolve(null);
      }
    });
  }

  /** Cleans up domain string */
  function cleanDomainStr(domain) {
    if (!domain) return '';
    let str = domain.trim().toLowerCase();
    str = str.replace(/[›>]/g, ' ').trim();
    if (str.includes(' ')) {
      str = str.split(/\s+/)[0];
    }
    return str.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/[^a-z0-9.-]/g, '');
  }

  /** Finds candidate anchor link or text element in URLScan card */
  function findUrlscanAnchor(cardEl) {
    const candidates = [
      cardEl.querySelector('.card-header a'),
      cardEl.querySelector('.card-title a'),
      cardEl.querySelector('a[href*="/result/"]'),
      cardEl.querySelector('a[href*="/domain/"]'),
      cardEl.querySelector('.card-header'),
      cardEl.querySelector('a[href]')
    ];

    for (const el of candidates) {
      if (!el) continue;
      const text = el.getAttribute('title') || el.getAttribute('href') || el.textContent.trim();
      const domain = cleanDomainStr(text);
      if (domain && domain.includes('.')) {
        return { element: el, domain };
      }
    }
    return null;
  }

  /** Extracts full target URL from container title attribute or domain fallback */
  function extractTargetUrl(cardEl, domainName) {
    const titleContainer = cardEl.closest('[title]') || cardEl.querySelector('[title]') || cardEl;
    if (titleContainer) {
      const titleAttr = titleContainer.getAttribute('title') || '';
      if (titleAttr.startsWith('http://') || titleAttr.startsWith('https://')) {
        const parts = titleAttr.split(' - ');
        if (parts[0]) {
          return parts[0].trim();
        }
      }
    }

    const anchor = cardEl.querySelector('a[href^="http://"], a[href^="https://"]');
    if (anchor) {
      return anchor.href;
    }

    if (domainName) {
      return `https://${domainName}`;
    }
    return null;
  }

  /** Appends status badges at the absolute bottom of the card */
  function appendFooterStatus(cardEl, status) {
    const container = cardEl.querySelector('.card-footer') || cardEl;
    if (!container) return;

    let statusContainer = cardEl.querySelector('.phishtackle-urlscan-footer-status');
    if (!statusContainer) {
      statusContainer = document.createElement('div');
      statusContainer.className = 'phishtackle-urlscan-footer-status';
      container.appendChild(statusContainer);
    } else if (statusContainer.parentElement !== container) {
      container.appendChild(statusContainer);
    }

    statusContainer.innerHTML = '';

    if (status.onCertList) {
      const badge = document.createElement('span');
      badge.className = 'phishtackle-badge phishtackle-badge--cert';
      badge.textContent = 'CERT';
      badge.title = 'Domain is on CERT blocklist';
      statusContainer.appendChild(badge);
    } else if (status.onLocalList) {
      const badge = document.createElement('span');
      badge.className = 'phishtackle-badge phishtackle-badge--local';
      badge.textContent = 'LIST';
      badge.title = 'Domain is in local report list';
      statusContainer.appendChild(badge);
    }
  }

  /** Injects redirect square button into card header */
  function injectSquareButton(cardEl, targetUrl) {
    const header = cardEl.querySelector('.card-header') || cardEl.querySelector('.card-title') || cardEl.firstElementChild;
    if (!header || header.querySelector('.phishtackle-urlscan-open-btn')) return;

    header.classList.add('phishtackle-header-flex');

    const openBtn = document.createElement('a');
    openBtn.className = 'phishtackle-urlscan-open-btn';
    openBtn.title = `Open full URL in new tab:\n${targetUrl}`;
    openBtn.href = targetUrl;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';

    // External link icon SVG
    openBtn.innerHTML = `<svg viewBox="0 0 512 512"><path fill="currentColor" d="M432,320H400a16,16,0,0,0-16,16V432H64V128H176a16,16,0,0,0,16-16V80a16,16,0,0,0-16-16H48A48,48,0,0,0,0,112V448a48,48,0,0,0,48,48H400a48,48,0,0,0,48-48V336A16,16,0,0,0,432,320ZM488,0h-128c-21.37,0-32,25.86-16.97,40.97l41.65,41.66L196.91,270.39a16,16,0,0,0,0,22.63l22.62,22.63a16,16,0,0,0,22.63,0L429.9,127.9,471.56,169.56C486.64,184.62,512,174,512,152.55V24A24,24,0,0,0,488,0Z"/></svg>`;

    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    });

    header.appendChild(openBtn);
  }

  /** Processes all result cards on urlscan page */
  function processCards() {
    if (!isEnabled) return;

    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
      if (card.dataset.phishtackleWrapped) return;

      const match = findUrlscanAnchor(card);
      if (!match) return;

      card.dataset.phishtackleWrapped = '1';
      card.dataset.phishtackleDomain = match.domain;

      const targetUrl = extractTargetUrl(card, match.domain);
      if (targetUrl) {
        injectSquareButton(card, targetUrl);
      }
      appendFooterStatus(card, { onCertList: false, onLocalList: false });
    });

    fetchAndApplyStatuses();
  }

  /** Queries background service worker for status of observed domains */
  async function fetchAndApplyStatuses() {
    const cards = document.querySelectorAll('.card[data-phishtackle-domain]');
    const domainsToCheck = [];
    const seen = new Set();

    cards.forEach(card => {
      const domain = card.dataset.phishtackleDomain;
      if (domain && !seen.has(domain) && !domainStatusCache.has(domain)) {
        seen.add(domain);
        domainsToCheck.push(domain);
      }
    });

    if (domainsToCheck.length > 0) {
      try {
        const response = await sendMessage({ action: 'checkMultipleDomains', domains: domainsToCheck });
        if (Array.isArray(response?.results)) {
          response.results.forEach(item => {
            const dom = cleanDomainStr(item.domain || item.cleanDomain);
            domainStatusCache.set(dom, {
              onCertList: !!item.onCertList,
              onLocalList: !!item.onLocalList
            });
          });
        }
      } catch (e) {
        console.warn('[PhishTackle] Error querying domain statuses:', e);
      }
    }

    cards.forEach(card => {
      const domain = card.dataset.phishtackleDomain;
      if (!domain) return;

      const status = domainStatusCache.get(domain);
      if (status) {
        appendFooterStatus(card, status);
      }
    });
  }

  /** Initializes content script after checking settings */
  async function init() {
    try {
      const settings = await sendMessage({ action: 'getSettings' });
      if (settings && settings.urlscanAssistant === false) {
        isEnabled = false;
        return;
      }
    } catch { }

    processCards();

    const observer = new MutationObserver(() => {
      if (mutationTimeout) clearTimeout(mutationTimeout);
      mutationTimeout = setTimeout(processCards, 250);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
