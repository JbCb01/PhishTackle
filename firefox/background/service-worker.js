import {
  extractDomain,
  normalizeDomain,
  matchesExclusion,
  findDomainInList,
  cleanUrl,
  preserveFullUrl,
  parseYamlConfig
} from '../utils/domain-utils.js';

// ==========================================
// Constants & Configuration
// ==========================================

const DOMAINS_URL = 'https://hole.cert.pl/domains/v2/domains.json';
const ALARM_NAME = 'refresh-domain-list';
const STORAGE_KEY_DOMAINS = 'phishtackle_domains';
const STORAGE_KEY_META = 'phishtackle_meta';
const STORAGE_KEY_SETTINGS = 'phishtackle_settings';

// ==========================================
// Global State
// ==========================================

/** @type {Map<string, {insertDate: string, deleteDate: string|null, id: number}>} */
let domainMap = new Map();
let isListLoaded = false;
let totalDomains = 0;
let configCache = null;
let currentRefreshPromise = null;
const fallbackSessionMap = new Map();
const domainSslMemoryMap = new Map();

// ==========================================
// Event Listeners & Lifecycle
// ==========================================

/** Handles extension installation and updates non-blockingly. */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[PhishTackle] Installed/updated:', details.reason);
  clearSslCache().catch(() => {});
  restoreFromCache().then((restored) => {
    if (!restored) {
      loadDomainList().catch((e) => console.warn('[PhishTackle] Background load error:', e.message));
    }
  });
  setupAlarm().catch(() => {});
});

/** Handles periodic alarms for domain list refresh. */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[PhishTackle] Alarm triggered — refreshing domain list');
    await loadDomainList();
  }
});

/** Intercepts network responses to capture server IP and native Firefox SSL security info. */
const webRequestApi = (typeof browser !== 'undefined' && browser.webRequest) ? browser.webRequest : chrome.webRequest;

if (webRequestApi?.onResponseStarted) {
  webRequestApi.onResponseStarted.addListener(
    (details) => {
      if (details.tabId && details.tabId !== -1 && details.ip && details.type === 'main_frame') {
        const domain = extractDomain(details.url);
        if (domain) {
          saveSessionData(`tab_ip_${details.tabId}`, {
            ip: details.ip,
            domain,
            url: details.url,
            timestamp: Date.now()
          });
        }
      }
    },
    { urls: ['<all_urls>'] }
  );
}

if (webRequestApi?.onHeadersReceived) {
  webRequestApi.onHeadersReceived.addListener(
    async (details) => {
      const domain = extractDomain(details.url);
      if (!domain) return;

      try {
        if (typeof webRequestApi.getSecurityInfo === 'function') {
          const securityInfo = await webRequestApi.getSecurityInfo(details.requestId, {
            certificateChain: true,
            rawDER: false
          });

          if (securityInfo && securityInfo.state === 'secure') {
            const sslData = processSecurityInfo(domain, securityInfo);
            await saveSslData(domain, sslData, details.tabId);
          }
        }
      } catch { }
    },
    { urls: ['https://*/*'] },
    ['blocking']
  );
}

/** Cleans up tab session data on tab closure. */
if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    removeSessionData(`tab_ip_${tabId}`);
    removeSessionData(`tab_ssl_${tabId}`);
  });
}

// ==========================================
// Extension Message Router
// ==========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[PhishTackle] Message error:', err);
      sendResponse({ error: err.message });
    });
  return true;
});

async function getActiveTab() {
  try {
    let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs && tabs.length > 0 && tabs[0]?.url) return tabs[0];

    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0 && tabs[0]?.url) return tabs[0];

    tabs = await chrome.tabs.query({ active: true });
    if (tabs && tabs.length > 0) {
      const active = tabs.find(t => t.active && t.url && !t.url.startsWith('about:') && !t.url.startsWith('moz-extension:'));
      if (active) return active;
    }
  } catch { }
  return null;
}

async function handleMessage(message) {
  switch (message.action) {
    case 'checkDomain': {
      return await checkDomain(message.domain, -1, true);
    }

    case 'checkDomainForTab': {
      const domain = message.domain;
      const tabId = message.tabId || -1;
      const tabUrl = message.url || `https://${domain}`;
      const isHttps = tabUrl.toLowerCase().startsWith('https:');
      const result = await checkDomain(domain, tabId, isHttps);
      return { ...result, currentDomain: domain, tabUrl };
    }

    case 'checkCurrentTab': {
      const tab = await getActiveTab();
      if (tab?.url) {
        let urlToCheck = tab.url;
        if (tab.url.startsWith('about:neterror') || tab.url.startsWith('about:blocked')) {
          try {
            const urlObj = new URL(tab.url);
            const uParam = urlObj.searchParams.get('u');
            if (uParam) urlToCheck = uParam;
          } catch { }
        }
        const domain = extractDomain(urlToCheck);
        if (domain) {
          const isHttps = urlToCheck.toLowerCase().startsWith('https:');
          const result = await checkDomain(domain, tab.id, isHttps);
          return { ...result, currentDomain: domain, tabUrl: urlToCheck };
        }
      }
      return { found: false, error: 'No active webpage tab found' };
    }

    case 'getListStatus': {
      const meta = await getMeta();
      return {
        lastUpdated: meta?.lastUpdated || null,
        totalDomains: totalDomains || meta?.totalDomains || 0,
        isOnline: meta?.isOnline ?? true,
        isLoaded: isListLoaded
      };
    }

    case 'forceRefresh': {
      await loadDomainList();
      const meta = await getMeta();
      return {
        success: domainMap.size > 0,
        lastUpdated: meta?.lastUpdated || new Date().toISOString(),
        totalDomains: domainMap.size || totalDomains || meta?.totalDomains || 0
      };
    }

    case 'getSettings': {
      return await getSettings();
    }

    case 'saveSettings': {
      await saveSettings(message.settings);
      await refreshAllTabs();
      await setupAlarm();
      return { success: true };
    }

    case 'checkMultipleDomains': {
      await ensureListLoaded();
      const storage = await chrome.storage.local.get(['reported_urls', 'reported_sessions']);
      const reportedUrls = storage.reported_urls || {};
      const reportedSessions = storage.reported_sessions || {};
      const domains = Array.isArray(message.domains) ? message.domains : [];

      const results = domains.map(rawDomain => {
        const cleanDomain = normalizeDomain(extractDomain(rawDomain) || cleanUrl(rawDomain) || rawDomain);
        const onCertList = !!findDomainInList(cleanDomain, domainMap);
        const dupDate = findUrlDuplicateDate(cleanDomain, reportedUrls, reportedSessions);
        return {
          domain: rawDomain,
          cleanDomain,
          onCertList,
          onLocalList: !!dupDate,
          reportedDate: dupDate
        };
      });
      return { results };
    }

    case 'addReport': {
      const { url: reportUrl, category: reportCat, date: targetDate, force = false } = message;
      if (!reportUrl || !reportCat) return { added: 0, skipped: 0, existingDate: null };

      await maybeRolloverDay();
      const today = getTodayDate();
      const storage = await chrome.storage.local.get(['reported_urls', 'reported_sessions']);
      const reportedUrls = storage.reported_urls || {};
      const reportedSessions = storage.reported_sessions || {};
      const cleanDom = normalizeDomain(extractDomain(reportUrl) || cleanUrl(reportUrl));

      const existingDate = findUrlDuplicateDate(cleanDom, reportedUrls, reportedSessions);
      if (existingDate && !force) {
        return { added: 0, skipped: 1, existingDate: existingDate === 'today' ? today : existingDate };
      }

      const rawUrlToStore = preserveFullUrl(reportUrl);

      if (targetDate && targetDate !== today) {
        if (!reportedSessions[targetDate]) reportedSessions[targetDate] = {};
        if (!reportedSessions[targetDate][reportCat]) reportedSessions[targetDate][reportCat] = [];
        reportedSessions[targetDate][reportCat].push(rawUrlToStore);
        await chrome.storage.local.set({ reported_sessions: reportedSessions });
      } else {
        if (!reportedUrls[reportCat]) reportedUrls[reportCat] = [];
        reportedUrls[reportCat].push(rawUrlToStore);
        await chrome.storage.local.set({ reported_urls: reportedUrls });
      }

      chrome.runtime.sendMessage({ action: 'reportsUpdated' }).catch(() => {});
      return { added: 1, skipped: 0, existingDate: null };
    }

    case 'addMultipleToReport': {
      const { urls = [], category = 'other' } = message;
      if (!urls.length || !category) return { added: 0, skipped: 0, duplicates: [] };

      await maybeRolloverDay();
      const today = getTodayDate();
      const storage = await chrome.storage.local.get(['reported_urls', 'reported_sessions']);
      const reportedUrls = storage.reported_urls || {};
      const reportedSessions = storage.reported_sessions || {};
      if (!reportedUrls[category]) reportedUrls[category] = [];

      let added = 0, skipped = 0;
      const duplicates = [];

      for (const url of urls) {
        const cleanDom = normalizeDomain(extractDomain(url) || cleanUrl(url));
        const dupDate = findUrlDuplicateDate(cleanDom, reportedUrls, reportedSessions);
        if (dupDate) {
          skipped++;
          duplicates.push({ url, date: dupDate === 'today' ? today : dupDate });
        } else {
          const rawUrlToStore = preserveFullUrl(url);
          if (!reportedUrls[category].includes(rawUrlToStore)) {
            reportedUrls[category].push(rawUrlToStore);
            added++;
          } else {
            skipped++;
          }
        }
      }

      if (added > 0) {
        await chrome.storage.local.set({ reported_urls: reportedUrls });
        chrome.runtime.sendMessage({ action: 'reportsUpdated' }).catch(() => {});
      }
      return { added, skipped, duplicates };
    }

    case 'getReportedSessions': {
      const data = await chrome.storage.local.get(['reported_urls', 'reported_sessions', 'reported_date']);
      return {
        currentDate: data.reported_date || getTodayDate(),
        currentUrls: data.reported_urls || {},
        sessions: data.reported_sessions || {}
      };
    }

    case 'deleteSessionEntry': {
      const { date: delDate, category: delCat, url: delUrl } = message;
      if (!delDate || !delCat || !delUrl) return { success: false };

      const data = await chrome.storage.local.get(['reported_urls', 'reported_sessions', 'reported_date']);
      const currentDate = data.reported_date || getTodayDate();

      if (delDate === currentDate) {
        const reportedUrls = data.reported_urls || {};
        if (reportedUrls[delCat]) {
          reportedUrls[delCat] = reportedUrls[delCat].filter(u => u !== delUrl && cleanUrl(u) !== cleanUrl(delUrl));
          if (reportedUrls[delCat].length === 0) delete reportedUrls[delCat];
        }
        await chrome.storage.local.set({ reported_urls: reportedUrls });
      } else {
        const sessions = data.reported_sessions || {};
        if (sessions[delDate]?.[delCat]) {
          sessions[delDate][delCat] = sessions[delDate][delCat].filter(u => u !== delUrl && cleanUrl(u) !== cleanUrl(delUrl));
          if (sessions[delDate][delCat].length === 0) delete sessions[delDate][delCat];
          if (Object.keys(sessions[delDate]).length === 0) delete sessions[delDate];
        }
        await chrome.storage.local.set({ reported_sessions: sessions });
      }

      chrome.runtime.sendMessage({ action: 'reportsUpdated' }).catch(() => {});
      return { success: true };
    }

    case 'deleteSession': {
      const { date: ds } = message;
      if (!ds) return { success: false };
      const data = await chrome.storage.local.get(['reported_urls', 'reported_sessions', 'reported_date']);
      const currentDate = data.reported_date || getTodayDate();

      if (ds === currentDate) {
        await chrome.storage.local.set({ reported_urls: {} });
      } else {
        const sessions = data.reported_sessions || {};
        delete sessions[ds];
        await chrome.storage.local.set({ reported_sessions: sessions });
      }

      chrome.runtime.sendMessage({ action: 'reportsUpdated' }).catch(() => {});
      return { success: true };
    }

    case 'addToSession': {
      const { date: addDate, category: addCat, url: addUrl, force = false } = message;
      if (!addDate || !addCat || !addUrl) return { added: 0, skipped: 0, existingDate: null };

      const data = await chrome.storage.local.get(['reported_urls', 'reported_sessions', 'reported_date']);
      const currentDate = data.reported_date || getTodayDate();
      const reportedUrls = data.reported_urls || {};
      const reportedSessions = data.reported_sessions || {};

      const cleanDom = normalizeDomain(extractDomain(addUrl) || cleanUrl(addUrl));
      const existingDate = findUrlDuplicateDate(cleanDom, reportedUrls, reportedSessions);
      if (existingDate && !force) {
        return { added: 0, skipped: 1, existingDate: existingDate === 'today' ? currentDate : existingDate };
      }

      const rawUrlToStore = preserveFullUrl(addUrl);

      if (addDate === currentDate) {
        if (!reportedUrls[addCat]) reportedUrls[addCat] = [];
        reportedUrls[addCat].push(rawUrlToStore);
        await chrome.storage.local.set({ reported_urls: reportedUrls });
      } else {
        if (!reportedSessions[addDate]) reportedSessions[addDate] = {};
        if (!reportedSessions[addDate][addCat]) reportedSessions[addDate][addCat] = [];
        reportedSessions[addDate][addCat].push(rawUrlToStore);
        await chrome.storage.local.set({ reported_sessions: reportedSessions });
      }

      chrome.runtime.sendMessage({ action: 'reportsUpdated' }).catch(() => {});
      return { added: 1, skipped: 0, existingDate: null };
    }

    case 'resolveDownloadPrompt': {
      const { downloadId, isSimulation, choice } = message;
      if (isSimulation) {
        console.log(`[PhishTackle Debug] Download simulation choice: ${choice}`);
      } else if (downloadId) {
        try {
          const numId = Number(downloadId);

          for (const [winId, id] of pendingDownloads.entries()) {
            if (String(id) === String(downloadId)) {
              pendingDownloads.delete(winId);
            }
          }

          if (choice === 'allow') {
            await chrome.downloads.resume(numId);
          } else if (choice === 'safe') {
            const [item] = await chrome.downloads.search({ id: numId });
            if (item) {
              await chrome.downloads.cancel(numId);
              const originalFilename = item.filename ? item.filename.split(/[\\/]/).pop() : 'payload';
              const safeFilename = originalFilename.endsWith('.sample') ? originalFilename : `${originalFilename}.sample`;

              selfInitiatedDownloads.add(safeFilename);
              if (item.url) selfInitiatedDownloads.add(item.url);

              await chrome.downloads.download({
                url: item.url,
                filename: safeFilename,
                saveAs: false
              });
            } else {
              await chrome.downloads.resume(numId);
            }
          } else {
            await chrome.downloads.cancel(numId);
          }
        } catch (e) {
          console.warn('[PhishTackle] Error resolving download action:', e);
        }
      }
      return { success: true };
    }

    case 'clipboardAttempt': {
      const settings = await getSettings();
      if (settings.clipboardProtection !== false && message.detail) {
        await showClipboardPrompt(message.detail);
      }
      return { success: true };
    }

    case 'resolveClipboardPrompt': {
      const { choice, domain } = message;
      if (domain && activeClipboardWindows.has(domain)) {
        activeClipboardWindows.delete(domain);
      }
      if (choice === 'clear') {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText('');
          }
        } catch { }
      }
      return { success: true };
    }

    default:
      return { error: `Unknown action: ${message.action}` };
  }
}

// ==========================================
// Core Domain & Security Inspection
// ==========================================

/** Checks if a domain is present on the blocklist and retrieves IP/SSL details. */
async function checkDomain(domain, tabId = -1, isHttps = true) {
  await ensureListLoaded();

  const rawExtracted = extractDomain(domain) || normalizeDomain(domain);
  if (!rawExtracted) {
    return { found: false, error: 'Failed to extract domain' };
  }
  const extracted = normalizeDomain(rawExtracted);

  let httpsCheck = isHttps;
  if (typeof domain === 'string' && domain.toLowerCase().startsWith('http:')) {
    httpsCheck = false;
  }

  const settings = await getSettings();
  const excluded = matchesExclusion(extracted, settings.exclusions || []);
  const certEntry = findDomainInList(extracted, domainMap);
  const found = !!certEntry;

  const storage = await chrome.storage.local.get(['reported_urls', 'reported_sessions']);
  const reportedUrls = storage.reported_urls || {};
  const reportedSessions = storage.reported_sessions || {};
  const localReportDate = findUrlDuplicateDate(extracted, reportedUrls, reportedSessions);
  const onLocalReportList = !!localReportDate;

  let ip = null;
  if (tabId !== -1) {
    try {
      const sessionData = await getSessionData(`tab_ip_${tabId}`);
      if (sessionData?.domain === extracted) {
        ip = sessionData.ip;
      }
    } catch { }
  }
  if (!ip) {
    ip = await resolveIpAddress(extracted);
  }

  let isIpExcluded = false;
  if (ip) {
    const excludedIps = settings.excludedIps || [];
    isIpExcluded = excludedIps.some(rule => ipMatchesRule(ip, rule));
  }

  const [ipDetails, sslDetails] = await Promise.all([
    getIpInfo(ip),
    getSslInfo(extracted, tabId, httpsCheck)
  ]);

  if (ipDetails) {
    ipDetails.isWaf = isIpExcluded;
  }

  const baseResult = {
    found,
    domain: extracted,
    cleanDomain: extracted,
    isHttps: httpsCheck,
    sslIssuer: sslDetails?.issuer || null,
    excluded,
    isExcluded: excluded,
    onLocalReportList,
    localReportDate,
    ip,
    isIpExcluded,
    ipDetails,
    sslDetails
  };

  if (found) {
    return {
      ...baseResult,
      matchedDomain: certEntry.matchedDomain,
      originalDomain: certEntry.originalDomain,
      insertDate: certEntry.insertDate,
      deleteDate: certEntry.deleteDate,
      registerId: certEntry.id
    };
  }

  return baseResult;
}

/** Resolves A records for a domain via Google DNS-over-HTTPS with 1.5s timeout. */
async function resolveIpAddress(domain) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 800);
    const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const json = await res.json();
    if (json.Answer?.length > 0) {
      const aRecord = json.Answer.find(ans => ans.type === 1);
      return aRecord ? aRecord.data : null;
    }
  } catch { }
  return null;
}

const ipInfoMemoryMap = new Map();

/** Fetches IP details (ISP, Organization, RDNS) from ipwho.is with 800ms timeout. */
async function getIpInfo(ip) {
  if (!ip) return null;
  const memData = ipInfoMemoryMap.get(ip);
  if (memData && memData.asn !== undefined && (Date.now() - memData.timestamp < 86400000)) {
    return memData;
  }

  const storageKey = `ipinfo_${ip}`;
  try {
    const cached = await chrome.storage.local.get(storageKey);
    if (cached[storageKey] && cached[storageKey].asn !== undefined && (Date.now() - cached[storageKey].timestamp < 86400000)) {
      ipInfoMemoryMap.set(ip, cached[storageKey]);
      return cached[storageKey];
    }
  } catch { }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`https://ipwho.is/${ip}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      if (json.success) {
        const connection = json.connection || {};
        const asnNum = connection.asn ? String(connection.asn).replace(/^AS/i, '') : '';
        const asnFormatted = asnNum ? `AS${asnNum}` : '';
        const data = {
          ip,
          org: connection.org || '',
          isp: connection.isp || '',
          asn: asnFormatted,
          rdns: connection.domain || '',
          isWaf: false,
          timestamp: Date.now()
        };
        ipInfoMemoryMap.set(ip, data);
        try {
          await chrome.storage.local.set({ [storageKey]: data });
        } catch { }
        return data;
      }
    }
  } catch { }
  return null;
}

function parseDistinguishedName(dnString) {
  if (!dnString || typeof dnString !== 'string') return {};
  const result = {};
  const parts = dnString.split(/,\s*(?=[A-Za-z]+=)/);
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      const key = part.substring(0, eqIdx).trim().toUpperCase();
      const val = part.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!result[key]) {
        result[key] = val;
      }
    }
  }
  return result;
}

function extractCleanIssuer(certIssuer) {
  if (!certIssuer) return 'Unknown Issuer';
  const dn = parseDistinguishedName(certIssuer);
  if (dn.O) {
    if (dn.CN && !dn.O.toLowerCase().includes(dn.CN.toLowerCase())) {
      return `${dn.O} (${dn.CN})`;
    }
    return dn.O;
  }
  if (dn.CN) return dn.CN;
  return certIssuer;
}

function extractCleanSubject(certSubject) {
  if (!certSubject) return null;
  const dn = parseDistinguishedName(certSubject);
  if (dn.O) return dn.O;
  if (dn.CN) return dn.CN;
  return null;
}

function processSecurityInfo(domain, securityInfo) {
  if (!securityInfo || securityInfo.state !== 'secure') {
    return {
      domain,
      secure: false,
      state: securityInfo?.state || 'insecure',
      source: 'firefox_security_info',
      timestamp: Date.now()
    };
  }

  const cert = securityInfo.certificates?.[0];
  const rawIssuer = cert?.issuer || '';
  const rawSubject = cert?.subject || '';

  const issuer = extractCleanIssuer(rawIssuer);
  const subject = extractCleanSubject(rawSubject);

  const startMs = cert?.validity?.start || null;
  const endMs = cert?.validity?.end || null;
  let daysRemaining = null;
  if (endMs) {
    daysRemaining = Math.ceil((endMs - Date.now()) / (1000 * 60 * 60 * 24));
  }

  return {
    domain,
    secure: true,
    state: securityInfo.state,
    issuer,
    rawIssuer,
    subject,
    rawSubject,
    validFrom: startMs,
    validTo: endMs,
    daysRemaining,
    protocolVersion: securityInfo.protocolVersion || null,
    cipherSuite: securityInfo.cipherSuite || null,
    hsts: securityInfo.hsts || false,
    source: 'firefox_security_info',
    timestamp: Date.now()
  };
}

const pendingSslFetches = new Set();

async function saveSslData(domain, sslData, tabId) {
  if (!domain || !sslData) return;
  domainSslMemoryMap.set(domain, sslData);

  if (tabId && tabId !== -1) {
    await saveSessionData(`tab_ssl_${tabId}`, sslData);
  }
  try {
    await chrome.storage.local.set({ [`domain_ssl_${domain}`]: sslData });
  } catch { }
}

async function getDomainSslFromStorage(domain) {
  const memData = domainSslMemoryMap.get(domain);
  if (memData && (Date.now() - memData.timestamp < 86400000)) {
    return memData;
  }

  try {
    const key = `domain_ssl_${domain}`;
    const stored = await chrome.storage.local.get([key]);
    const sslData = stored[key];
    if (sslData && (Date.now() - sslData.timestamp < 86400000)) {
      domainSslMemoryMap.set(domain, sslData);
      return sslData;
    }
  } catch { }
  return null;
}

async function fetchSslForDomain(domain, tabId) {
  if (!domain || pendingSslFetches.has(domain)) return null;
  pendingSslFetches.add(domain);
  console.log(`[PhishTackle SSL] 🌐 Initiating background SSL fetch for domain: ${domain}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      await fetch(`https://${domain}`, {
        method: 'GET',
        cache: 'no-store',
        mode: 'no-cors',
        signal: controller.signal
      });
    } catch { }

    clearTimeout(timeoutId);

    const result = await getDomainSslFromStorage(domain);

    if (result && result.secure) {
      console.log(`[PhishTackle SSL] Background SSL fetch succeeded for ${domain}:`, result.issuer);
      if (tabId && tabId !== -1) {
        await saveSessionData(`tab_ssl_${tabId}`, result);
      }
      chrome.runtime.sendMessage({
        action: 'sslDetailsUpdated',
        domain,
        tabId,
        sslDetails: result
      }).catch(() => { });
    } else {
      console.warn(`[PhishTackle SSL] Background SSL fetch completed for ${domain} but no cert info was stored.`);
    }

    return result;
  } catch (err) {
    console.error(`[PhishTackle SSL Error] Exception during fetchSslForDomain for ${domain}:`, err);
  } finally {
    pendingSslFetches.delete(domain);
  }

  return await getDomainSslFromStorage(domain);
}

/** Retrieves stored native Firefox SSL security information for a tab or domain. */
async function getSslInfo(domain, tabId, isHttps) {
  if (!isHttps) {
    return { secure: false };
  }

  // 1. Try Tab Session Data first
  if (tabId && tabId !== -1) {
    const sessionData = await getSessionData(`tab_ssl_${tabId}`);
    if (sessionData?.domain === domain && sessionData?.secure) {
      console.log(`[PhishTackle SSL] 🎯 Tab session cache hit for ${domain} (issuer: ${sessionData.issuer})`);
      return sessionData;
    }
  }

  // 2. Try Domain Persistent Cache
  const domainSsl = await getDomainSslFromStorage(domain);
  if (domainSsl && domainSsl.secure) {
    console.log(`[PhishTackle SSL] 🎯 Domain memory/storage cache hit for ${domain} (issuer: ${domainSsl.issuer})`);
    if (tabId && tabId !== -1) {
      saveSessionData(`tab_ssl_${tabId}`, domainSsl);
    }
    return domainSsl;
  }

  // 3. Fallback: Trigger background fetch asynchronously and return loading status immediately
  console.log(`[PhishTackle SSL] ⌛ No SSL info cached for ${domain}. Triggering background fetch...`);
  fetchSslForDomain(domain, tabId).catch(() => { });

  return {
    secure: true,
    issuer: null,
    validFrom: null,
    source: 'loading'
  };
}

// ==========================================
// Data Fetching & Cache Management
// ==========================================

/** Ensures domain list is loaded in memory asynchronously without blocking request handlers. */
async function ensureListLoaded() {
  if (!isListLoaded || domainMap.size === 0) {
    const restored = await restoreFromCache();
    if (!restored || domainMap.size === 0) {
      if (!currentRefreshPromise) {
        console.log('[PhishTackle] Domain map is empty — fetching domain list in background...');
        loadDomainList().catch(e => console.warn('[PhishTackle] Background load error:', e.message));
      }
      return;
    }
  }

  try {
    const meta = await getMeta();
    const settings = await getSettings();
    const refreshHours = settings.refreshHours || 1;
    const maxAgeMs = refreshHours * 60 * 60 * 1000;

    const isStale = !meta?.lastUpdated || (Date.now() - new Date(meta.lastUpdated).getTime() >= maxAgeMs);

    if (isStale) {
      console.log(`[PhishTackle] Domain list cache is stale (>= ${refreshHours}h) — refreshing in background...`);
      loadDomainList().catch(e => console.warn('[PhishTackle] Background refresh error:', e.message));
    }
  } catch (e) {
    console.warn('[PhishTackle] Cache freshness check error:', e.message);
  }
}

/** Configures alarm interval for periodic list updates. */
async function setupAlarm() {
  const settings = await getSettings();
  const refreshHours = settings.refreshHours || 1;
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: refreshHours * 60 });
}

/** Fetches and builds domain map from CERT.pl network feed. */
async function loadDomainList() {
  if (currentRefreshPromise) return currentRefreshPromise;

  currentRefreshPromise = (async () => {
    try {
      console.log('[PhishTackle] Fetching CERT.pl domain feed from hole.cert.pl...');
      const res = await fetch(DOMAINS_URL);
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

      const data = await res.json();
      buildDomainMap(data);

      const meta = {
        lastUpdated: new Date().toISOString(),
        totalDomains: domainMap.size,
        isOnline: true
      };

      await chrome.storage.local.set({
        [STORAGE_KEY_DOMAINS]: Array.from(domainMap.entries()),
        [STORAGE_KEY_META]: meta
      });

      isListLoaded = true;
      totalDomains = domainMap.size;
      console.log(`[PhishTackle] Successfully loaded ${domainMap.size} domains from hole.cert.pl.`);
      return true;
    } catch (e) {
      console.warn('[PhishTackle] Network error during CERT.pl list fetch — retaining cached list:', e.message);
      const restored = await restoreFromCache();
      const meta = (await getMeta()) || {};
      meta.isOnline = false;
      meta.totalDomains = domainMap.size;
      await chrome.storage.local.set({ [STORAGE_KEY_META]: meta });
      isListLoaded = true;
      totalDomains = domainMap.size;
      return restored;
    } finally {
      currentRefreshPromise = null;
    }
  })();

  return currentRefreshPromise;
}

/** Parses raw CERT.pl domain list array into memory Map. */
function buildDomainMap(data) {
  domainMap.clear();
  let list = data;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    list = data.domains || data.items || data.data || data.results || [];
  }

  if (Array.isArray(list)) {
    list.forEach((entry, idx) => {
      if (typeof entry === 'string') {
        const norm = normalizeDomain(entry);
        if (norm) {
          domainMap.set(norm, {
            matchedDomain: norm,
            originalDomain: entry,
            insertDate: new Date().toISOString(),
            deleteDate: null,
            id: idx + 1
          });
        }
      } else if (entry && typeof entry === 'object') {
        const dom = entry.DomainAddress || entry.domain_name || entry.domain || entry.name || entry.url || entry.Domain;
        if (dom) {
          const norm = normalizeDomain(dom);
          if (norm) {
            domainMap.set(norm, {
              matchedDomain: norm,
              originalDomain: dom,
              insertDate: entry.InsertDate || entry.insert_date || entry.insertDate || new Date().toISOString(),
              deleteDate: entry.DeleteDate || entry.delete_date || entry.deleteDate || null,
              id: entry.RegisterPositionId || entry.id || entry.RegisterId || idx + 1
            });
          }
        }
      }
    });
  }
}

/** Restores domain Map from IndexedDB/local storage cache. */
async function restoreFromCache() {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEY_DOMAINS, STORAGE_KEY_META]);
    if (data[STORAGE_KEY_DOMAINS] && Array.isArray(data[STORAGE_KEY_DOMAINS]) && data[STORAGE_KEY_DOMAINS].length > 0) {
      domainMap = new Map(data[STORAGE_KEY_DOMAINS]);
      const meta = data[STORAGE_KEY_META];
      totalDomains = domainMap.size;
      isListLoaded = true;
      console.log(`[PhishTackle] Restored ${domainMap.size} domains from local storage cache (Updated: ${meta?.lastUpdated || 'Unknown'}).`);
      return true;
    }
  } catch (e) {
    console.error('[PhishTackle] Cache restoration failed:', e);
  }
  return false;
}

// ==========================================
// Settings & Config Helpers
// ==========================================

async function getSettings() {
  const res = await chrome.storage.local.get([STORAGE_KEY_SETTINGS, 'reported_categories']);
  const storedSettings = res[STORAGE_KEY_SETTINGS] || {};

  let defaultConfig = { exclusions: [], excludedIps: [], categories: ['other'] };
  try {
    const response = await fetch(chrome.runtime.getURL('config.yaml'));
    const text = await response.text();
    const config = parseYamlConfig(text);
    if (config.exclusions) defaultConfig.exclusions = config.exclusions;
    if (config.excludedIps) defaultConfig.excludedIps = config.excludedIps;
    if (config.categories) defaultConfig.categories = config.categories;
  } catch (e) {
    console.warn('[PhishTackle] Error loading config.yaml:', e);
  }

  const exclusions = (Array.isArray(storedSettings.exclusions) && storedSettings.exclusions.length > 0)
    ? storedSettings.exclusions
    : defaultConfig.exclusions;

  const excludedIps = (Array.isArray(storedSettings.excludedIps) && storedSettings.excludedIps.length > 0)
    ? storedSettings.excludedIps
    : defaultConfig.excludedIps;

  const categories = (Array.isArray(res.reported_categories) && res.reported_categories.length > 0)
    ? res.reported_categories
    : defaultConfig.categories;

  return {
    exclusions,
    excludedIps,
    categories,
    refreshHours: storedSettings.refreshHours || 1,
    googleSearchCheckboxes: storedSettings.googleSearchCheckboxes !== false,
    urlscanAssistant: storedSettings.urlscanAssistant !== false,
    facebookPreventRefresh: storedSettings.facebookPreventRefresh !== false,
    downloadProtection: storedSettings.downloadProtection !== false,
    clipboardProtection: storedSettings.clipboardProtection !== false
  };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });
}

async function getMeta() {
  const res = await chrome.storage.local.get(STORAGE_KEY_META);
  return res[STORAGE_KEY_META] || null;
}

async function refreshAllTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.google.com/search*', '*://google.com/search*'] });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'refreshCheckboxes' }).catch(() => { });
    }
  } catch { }
}

// ==========================================
// Session Data & SSL Cache Helpers
// ==========================================

async function saveSessionData(key, value) {
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.set({ [key]: value });
    } else {
      fallbackSessionMap.set(key, value);
    }
  } catch {
    fallbackSessionMap.set(key, value);
  }
}

async function getSessionData(key) {
  try {
    if (chrome.storage?.session) {
      const res = await chrome.storage.session.get(key);
      return res[key] || fallbackSessionMap.get(key) || null;
    }
  } catch { }
  return fallbackSessionMap.get(key) || null;
}

async function removeSessionData(key) {
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.remove(key);
    }
  } catch { }
  fallbackSessionMap.delete(key);
}

async function clearSslCache() {
  try {
    if (chrome.storage?.session) {
      const allSession = await chrome.storage.session.get(null);
      const sessionKeys = Object.keys(allSession).filter(k => k.startsWith('tab_ssl_') || k.startsWith('tab_ip_'));
      if (sessionKeys.length > 0) {
        await chrome.storage.session.remove(sessionKeys);
      }
    }
    const allLocal = await chrome.storage.local.get(null);
    const localKeys = Object.keys(allLocal).filter(k => k.startsWith('domain_ssl_'));
    if (localKeys.length > 0) {
      await chrome.storage.local.remove(localKeys);
    }
  } catch { }
  fallbackSessionMap.clear();
}

// ==========================================
// Helper Utilities & IP / Exclusion Matching
// ==========================================

function ipToLong(ip) {
  if (!ip) return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const part = parseInt(parts[i], 10);
    if (isNaN(part) || part < 0 || part > 255) return null;
    num = (num << 8) + part;
  }
  return num >>> 0;
}

function ipMatchesRule(ip, rule) {
  const cleanRule = rule.trim();
  if (!cleanRule) return false;

  if (cleanRule.includes('/')) {
    try {
      const parts = cleanRule.split('/');
      const mask = parseInt(parts[1], 10);
      const ipNum = ipToLong(ip);
      const ruleIpNum = ipToLong(parts[0]);
      if (ipNum === null || ruleIpNum === null) return false;
      const maskBits = -1 << (32 - mask);
      return (ipNum & maskBits) === (ruleIpNum & maskBits);
    } catch {
      return false;
    }
  }

  if (cleanRule.includes('*')) {
    const regexStr = '^' + cleanRule.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
    return new RegExp(regexStr).test(ip);
  }

  return ip === cleanRule;
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

async function maybeRolloverDay() {
  const today = getTodayDate();
  const storage = await chrome.storage.local.get(['reported_date', 'reported_urls', 'reported_sessions']);
  const storedDate = storage.reported_date;
  const currentUrls = storage.reported_urls || {};
  const reportedSessions = storage.reported_sessions || {};

  if (storedDate && storedDate !== today) {
    const hasEntries = Object.values(currentUrls).some(list => Array.isArray(list) && list.length > 0);
    if (hasEntries) {
      reportedSessions[storedDate] = currentUrls;
    }
    await chrome.storage.local.set({
      reported_date: today,
      reported_urls: {},
      reported_sessions: reportedSessions
    });
  } else if (!storedDate) {
    await chrome.storage.local.set({ reported_date: today });
  }
}

function findUrlDuplicateDate(targetCleanUrl, reportedUrls, reportedSessions) {
  if (!targetCleanUrl) return null;
  const rawTarget = extractDomain(targetCleanUrl) || cleanUrl(targetCleanUrl);
  const targetDomain = normalizeDomain(rawTarget);
  if (!targetDomain) return null;

  for (const list of Object.values(reportedUrls || {})) {
    if (Array.isArray(list)) {
      for (const entry of list) {
        const rawEntry = extractDomain(entry) || cleanUrl(entry);
        const entryDomain = normalizeDomain(rawEntry);
        if (entryDomain && entryDomain === targetDomain) {
          return 'today';
        }
      }
    }
  }

  for (const [date, session] of Object.entries(reportedSessions || {})) {
    for (const list of Object.values(session || {})) {
      if (Array.isArray(list)) {
        for (const entry of list) {
          const rawEntry = extractDomain(entry) || cleanUrl(entry);
          const entryDomain = normalizeDomain(rawEntry);
          if (entryDomain && entryDomain === targetDomain) {
            return date;
          }
        }
      }
    }
  }

  return null;
}

// ==========================================
// Download Protection & Interception
// ==========================================

const pendingDownloads = new Map();
const selfInitiatedDownloads = new Set();

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function showDownloadPrompt({ downloadId, domain, filename, extension, sizeStr, mimeType, isSimulation = false }) {
  const query = new URLSearchParams({
    downloadId: downloadId ? String(downloadId) : '',
    domain: domain || 'Unknown domain',
    filename: filename || 'file',
    extension: extension || 'unknown',
    sizeStr: sizeStr || 'Unknown size',
    mimeType: mimeType || 'application/octet-stream',
    isSimulation: isSimulation ? 'true' : 'false'
  });

  const url = chrome.runtime.getURL(`features/download-protection/alert-dialog.html?${query.toString()}`);

  try {
    const win = await chrome.windows.create({
      url,
      type: 'popup',
      width: 460,
      height: 270,
      focused: true
    });

    if (win?.id && downloadId && !isSimulation) {
      pendingDownloads.set(String(win.id), String(downloadId));
    }
  } catch (e) {
    console.error('[PhishTackle] Error opening download prompt window:', e);
    if (downloadId && !isSimulation) {
      try { await chrome.downloads.resume(Number(downloadId)); } catch { }
    }
  }

  try {
    const notifId = `download_${Date.now()}`;
    chrome.notifications?.create(notifId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-48.png'),
      title: 'Download Intercepted',
      message: `Domain: ${domain}\nFile: ${filename} (.${extension})\nSize: ${sizeStr}`,
      priority: 2
    });
  } catch { }
}

if (chrome.downloads?.onCreated) {
  chrome.downloads.onCreated.addListener(async (item) => {
    const settings = await getSettings();
    if (settings.downloadProtection === false) return;

    const filename = item.filename ? item.filename.split(/[\\/]/).pop() : (item.finalUrl || item.url || '').split('/').pop().split('?')[0] || 'downloaded_file';

    if (selfInitiatedDownloads.has(filename) || selfInitiatedDownloads.has(item.url) || selfInitiatedDownloads.has(item.finalUrl)) {
      selfInitiatedDownloads.delete(filename);
      selfInitiatedDownloads.delete(item.url);
      selfInitiatedDownloads.delete(item.finalUrl);
      return;
    }

    if (filename.endsWith('.sample')) {
      return;
    }

    try {
      await chrome.downloads.pause(item.id);
    } catch (e) {
      console.warn('[PhishTackle] Could not pause download immediately:', e.message);
    }

    const domain = extractDomain(item.finalUrl || item.url || item.referrer || '');
    const extension = filename.includes('.') ? filename.split('.').pop().toUpperCase() : 'UNKNOWN';
    const sizeStr = formatFileSize(item.fileSize || item.totalBytes);

    await showDownloadPrompt({
      downloadId: item.id,
      domain: domain || 'Direct Download / Local',
      filename,
      extension,
      sizeStr,
      mimeType: item.mime || 'application/octet-stream',
      isSimulation: false
    });
  });
}

const activeClipboardWindows = new Map();

async function showClipboardPrompt({ domain, payload, method, trigger }) {
  const targetDomain = domain || 'Unknown domain';

  if (activeClipboardWindows.has(targetDomain)) {
    const existingWinId = activeClipboardWindows.get(targetDomain);
    if (typeof existingWinId === 'number') {
      try {
        const win = await chrome.windows.get(existingWinId);
        if (win) {
          await chrome.windows.update(existingWinId, { focused: true });
          return;
        }
      } catch {
        activeClipboardWindows.delete(targetDomain);
      }
    } else {
      activeClipboardWindows.delete(targetDomain);
    }
  }

  const query = new URLSearchParams({
    domain: targetDomain,
    payload: (payload || '').slice(0, 500),
    method: method || 'navigator.clipboard.writeText',
    trigger: trigger || 'Automatic / Unprompted'
  });

  const url = chrome.runtime.getURL(`features/clipboard-protection/alert-dialog.html?${query.toString()}`);

  try {
    const win = await chrome.windows.create({
      url,
      type: 'popup',
      width: 460,
      height: 270,
      focused: true
    });
    if (win?.id) {
      activeClipboardWindows.set(targetDomain, win.id);
    }
  } catch (e) {
    activeClipboardWindows.delete(targetDomain);
    console.error('[PhishTackle] Error opening clipboard prompt window:', e);
  }
}

if (chrome.windows?.onRemoved) {
  chrome.windows.onRemoved.addListener(async (winId) => {
    const downloadId = pendingDownloads.get(String(winId));
    if (downloadId) {
      pendingDownloads.delete(String(winId));
      try {
        await chrome.downloads.cancel(Number(downloadId));
      } catch { }
    }

    for (const [dom, id] of activeClipboardWindows.entries()) {
      if (id === winId || String(id) === String(winId)) {
        activeClipboardWindows.delete(dom);
      }
    }
  });
}
