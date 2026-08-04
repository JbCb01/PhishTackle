/**
 * Domain & Extension utility helper functions.
 */

/** Extracts clean hostname from URL or Firefox about:neterror pages. */
export function extractDomain(url) {
  if (!url || typeof url !== 'string') return null;

  let cleaned = url.trim();

  if (cleaned.startsWith('about:neterror') || cleaned.startsWith('about:blocked')) {
    try {
      const urlObj = new URL(cleaned);
      const uParam = urlObj.searchParams.get('u');
      if (uParam) return extractDomain(uParam);
    } catch { }
    return null;
  }

  if (cleaned.startsWith('data:')) return 'Embedded Data Payload';
  if (cleaned.startsWith('blob:')) return 'In-Memory Blob Payload';
  if (cleaned.startsWith('file:')) return 'Local File System';

  if (!/^https?:\/\//i.test(cleaned)) {
    if (cleaned.startsWith('//')) {
      cleaned = 'https:' + cleaned;
    } else {
      cleaned = 'https://' + cleaned;
    }
  }

  try {
    const urlObj = new URL(cleaned);
    const hostname = urlObj.hostname;
    if (!hostname || hostname === 'localhost') return null;
    return hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Strips leading 'www.' and converts domain string to lowercase. */
export function normalizeDomain(domain) {
  if (!domain) return '';
  let d = domain.toLowerCase().trim();
  if (d.startsWith('www.')) {
    d = d.substring(4);
  }
  return d;
}

/** Generates parent domain candidates for subdomain matching. */
export function getParentDomains(domain) {
  const parts = domain.split('.');
  const results = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (candidate.split('.').length >= 2) {
      results.push(candidate);
    }
  }
  return results;
}

/** Checks domain or wildcard pattern against single exclusion rule. */
export function matchesSingleExclusion(domain, rule) {
  const cleanRule = rule.trim().toLowerCase();
  if (!cleanRule) return false;

  if (cleanRule.startsWith('*.')) {
    const suffix = cleanRule.substring(2);
    return domain === suffix || domain.endsWith('.' + suffix);
  } else {
    const normalizedRule = normalizeDomain(cleanRule);
    return normalizeDomain(domain) === normalizedRule;
  }
}

/** Checks domain against an array of exclusion rules. */
export function matchesExclusion(domain, rules) {
  if (!rules || rules.length === 0) return false;
  const normalized = normalizeDomain(domain);
  return rules.some(rule => matchesSingleExclusion(normalized, rule));
}

/** Searches for domain or its parent candidates in the domain Map. */
export function findDomainInList(domain, domainMap) {
  if (!domain || !domainMap || domainMap.size === 0) return null;

  const normalized = normalizeDomain(domain);
  const candidates = getParentDomains(normalized);
  const withWww = 'www.' + normalized;
  const allCandidates = [normalized, withWww, ...candidates];

  for (const candidate of allCandidates) {
    const entry = domainMap.get(candidate);
    if (entry) {
      return { ...entry, matchedDomain: candidate };
    }
  }

  return null;
}

/** Formats ISO date string to English localized string. */
export function formatDate(isoDate) {
  if (!isoDate) return '—';
  try {
    const date = new Date(isoDate);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoDate;
  }
}

/** Safely normalizes URL to origin + pathname. */
export function cleanUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

/** Escapes HTML special characters for safe string interpolation. */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Promisified chrome.runtime.sendMessage wrapper. */
export function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

/** Parses config.yaml format (blocked_domains and categories). */
export function parseYamlConfig(yamlText) {
  const result = { blockedDomains: [], categories: [] };
  if (!yamlText) return result;

  const lines = yamlText.split('\n');
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('blocked_domains:')) {
      currentSection = 'blockedDomains';
      continue;
    } else if (trimmed.startsWith('categories:')) {
      currentSection = 'categories';
      continue;
    }

    if (trimmed.startsWith('-') && currentSection) {
      const value = trimmed.substring(1).trim().replace(/^['"]|['"]$/g, '');
      if (value) {
        result[currentSection].push(value);
      }
    }
  }

  return result;
}

/** Fetches configured categories from storage or config.yaml fallback. */
export async function getCategories() {
  try {
    const data = await chrome.storage.local.get('reported_categories');
    if (Array.isArray(data.reported_categories) && data.reported_categories.length > 0) {
      return data.reported_categories;
    }
    const res = await fetch(chrome.runtime.getURL('config.yaml'));
    if (res.ok) {
      const text = await res.text();
      const parsed = parseYamlConfig(text);
      if (Array.isArray(parsed.categories) && parsed.categories.length > 0) {
        return parsed.categories;
      }
    }
  } catch (e) {
    console.warn('Error loading categories:', e);
  }
  return ['other'];
}
