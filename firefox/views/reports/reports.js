import { escapeHtml, setSafeHTML, sendMessage, cleanUrl } from '../../utils/domain-utils.js';

// ==========================================
// State & Elements
// ==========================================

let activeTab = 'queue'; // 'queue' | 'archive'
let reportsData = { activeQueue: {}, archivedReports: [] };
let categories = [];
let feedbackTimeout = null;

const tabBtnQueue = document.getElementById('tab-btn-queue');
const tabBtnArchive = document.getElementById('tab-btn-archive');
const countQueueEl = document.getElementById('count-queue');
const countArchiveEl = document.getElementById('count-archive');

const reportsTitleEl = document.getElementById('reports-title');
const reportsSubtitleEl = document.getElementById('reports-subtitle');
const contentContainer = document.getElementById('reports-content-container');
const addDomainCard = document.getElementById('add-domain-card');

const addDomainInput = document.getElementById('add-domain-input');
const addDomainSelect = document.getElementById('add-domain-category');
const addDomainBtn = document.getElementById('add-domain-btn');
const addDomainFeedback = document.getElementById('add-domain-feedback');
const actionFeedback = document.getElementById('action-feedback');

const btnCopyDomains = document.getElementById('btn-copy-domains');
const btnCopyIps = document.getElementById('btn-copy-ips');
const btnArchiveAll = document.getElementById('btn-archive-all');
const btnClearQueue = document.getElementById('btn-clear-queue');

// ==========================================
// Initialization
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadCategories();
  await loadAndRender();

  tabBtnQueue.addEventListener('click', () => switchTab('queue'));
  tabBtnArchive.addEventListener('click', () => switchTab('archive'));

  addDomainBtn.addEventListener('click', handleAddDomain);
  addDomainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddDomain();
  });

  btnCopyDomains.addEventListener('click', handleCopyDomains);
  btnCopyIps.addEventListener('click', handleCopyIps);
  btnArchiveAll.addEventListener('click', handleArchiveAll);
  btnClearQueue.addEventListener('click', handleClearAction);

  if (chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'reportsUpdated') {
        loadAndRender().catch(() => {});
      }
    });
  }

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.reported_urls || changes.reported_sessions || changes.reported_date)) {
        loadAndRender().catch(() => {});
      }
    });
  }
});

async function loadCategories() {
  try {
    const resp = await sendMessage({ action: 'getSettings' });
    categories = resp?.categories?.length > 0 ? resp.categories : ['other'];
  } catch {
    categories = ['other'];
  }
  const fragment = document.createDocumentFragment();
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    fragment.appendChild(opt);
  });
  addDomainSelect.replaceChildren(fragment);
}

async function loadAndRender() {
  try {
    const data = await sendMessage({ action: 'getReportsData' });
    reportsData = {
      activeQueue: data?.activeQueue || {},
      archivedReports: data?.archivedReports || []
    };
    updateSidebarCounts();
    renderMainView();
  } catch (e) {
    setSafeHTML(contentContainer, `<div class="empty-state">Error loading data: ${escapeHtml(e.message)}</div>`);
  }
}

function updateSidebarCounts() {
  const queueItems = getAllQueueItems();
  const archiveItems = reportsData.archivedReports || [];

  countQueueEl.textContent = queueItems.length;
  countArchiveEl.textContent = archiveItems.length;
}

function switchTab(tab) {
  activeTab = tab;
  tabBtnQueue.classList.toggle('active', tab === 'queue');
  tabBtnArchive.classList.toggle('active', tab === 'archive');

  addDomainCard.hidden = (tab !== 'queue');
  btnArchiveAll.hidden = (tab !== 'queue');
  resetClearButtonState();

  renderMainView();
}

// ==========================================
// Rendering Logic
// ==========================================

function getAllQueueItems() {
  const queue = reportsData.activeQueue || {};
  let items = [];
  for (const cat of Object.keys(queue)) {
    const list = queue[cat] || [];
    list.forEach(item => {
      const normalized = typeof item === 'string'
        ? { id: item, url: item, domain: cleanUrl(item), ip: '-', provider: '-', category: cat }
        : { ...item, category: cat };
      items.push(normalized);
    });
  }
  return items;
}

function renderMainView() {
  if (activeTab === 'queue') {
    renderQueueView();
  } else {
    renderArchiveView();
  }
}

function renderQueueView() {
  reportsTitleEl.textContent = 'Current Queue';
  reportsSubtitleEl.textContent = 'Active domain reports queue';
  btnArchiveAll.hidden = false;
  btnClearQueue.textContent = 'Clear Queue';

  const queue = reportsData.activeQueue || {};
  const activeCats = Object.keys(queue).filter(cat => Array.isArray(queue[cat]) && queue[cat].length > 0);

  if (activeCats.length === 0) {
    setSafeHTML(contentContainer, `
      <div class="empty-state">
        No active domain reports in queue.<br>
        <span style="font-size: 12px; color: var(--text-tertiary);">
          You can add a domain manually above or check boxes on search results.
        </span>
      </div>
    `);
    return;
  }

  const sectionsHtml = activeCats.map(cat => {
    const list = queue[cat] || [];
    const rowsHtml = list.map(item => {
      const normalized = typeof item === 'string'
        ? { id: item, url: item, domain: cleanUrl(item), ip: '-', provider: '-' }
        : item;

      return `
        <tr>
          <td class="col-domain">
            <a href="${escapeHtml(normalized.url || `https://${normalized.domain}`)}" target="_blank" rel="noopener noreferrer" class="domain-link">
              ${escapeHtml(normalized.url || normalized.domain)}
            </a>
          </td>
          <td class="col-ip"><code>${escapeHtml(normalized.ip || '-')}</code></td>
          <td class="col-provider">${escapeHtml(normalized.provider || '-')}</td>
          <td class="col-actions">
            <button class="btn-action btn-action--archive" data-id="${escapeHtml(normalized.id)}" data-cat="${escapeHtml(cat)}" title="Archive this item">
              Archive
            </button>
            <button class="btn-action btn-action--delete" data-id="${escapeHtml(normalized.id)}" data-cat="${escapeHtml(cat)}" data-url="${escapeHtml(normalized.url)}" title="Delete entry">
              ✕
            </button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <section class="reports-section" data-cat="${escapeHtml(cat)}">
        <div class="reports-section__header">
          <div class="section-title-wrap">
            <h2 class="reports-section__title">${escapeHtml(cat)}</h2>
            <span class="reports-section__badge">${list.length} item(s)</span>
          </div>
          <div class="reports-section__header-actions">
            <button class="reports-section__btn cat-copy-domains" data-cat="${escapeHtml(cat)}" title="Copy domains in this category">
              Copy Domains
            </button>
            <button class="reports-section__btn cat-copy-ips" data-cat="${escapeHtml(cat)}" title="Copy IPs in this category">
              Copy IPs
            </button>
            <button class="reports-section__btn cat-archive" data-cat="${escapeHtml(cat)}" title="Archive this category">
              Archive Category
            </button>
          </div>
        </div>
        <div class="table-wrapper">
          <table class="reports-table">
            <thead>
              <tr>
                <th class="col-domain">Domain / Link</th>
                <th class="col-ip">IP Address</th>
                <th class="col-provider">Provider / WAF</th>
                <th class="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }).join('');

  setSafeHTML(contentContainer, sectionsHtml);
  attachQueueEventListeners();
}

function renderArchiveView() {
  reportsTitleEl.textContent = 'Archive';
  reportsSubtitleEl.textContent = 'Archived domain records';
  btnArchiveAll.hidden = true;
  btnClearQueue.textContent = 'Clear Archive';

  const archived = reportsData.archivedReports || [];

  if (archived.length === 0) {
    setSafeHTML(contentContainer, `
      <div class="empty-state">
        No archived report records.<br>
        <span style="font-size: 12px; color: var(--text-tertiary);">
          Items moved from Current Queue will appear here.
        </span>
      </div>
    `);
    return;
  }

  const rowsHtml = archived.map(item => {
    const normalized = typeof item === 'string'
      ? { id: item, url: item, domain: cleanUrl(item), ip: '-', provider: '-', category: 'archive', archivedAt: Date.now() }
      : item;

    const dateStr = normalized.archivedAt ? formatDate(normalized.archivedAt) : '-';

    return `
      <tr>
        <td class="col-domain">
          <a href="${escapeHtml(normalized.url || `https://${normalized.domain}`)}" target="_blank" rel="noopener noreferrer" class="domain-link">
            ${escapeHtml(normalized.url || normalized.domain)}
          </a>
        </td>
        <td class="col-ip"><code>${escapeHtml(normalized.ip || '-')}</code></td>
        <td class="col-provider">${escapeHtml(normalized.provider || '-')}</td>
        <td class="col-category"><span class="cat-pill">${escapeHtml(normalized.category || 'other')}</span></td>
        <td class="col-date">${escapeHtml(dateStr)}</td>
        <td class="col-actions">
          <button class="btn-action btn-action--delete archive-delete" data-id="${escapeHtml(normalized.id)}" data-url="${escapeHtml(normalized.url)}" title="Delete from archive">
            ✕
          </button>
        </td>
      </tr>
    `;
  }).join('');

  setSafeHTML(contentContainer, `
    <section class="reports-section">
      <div class="table-wrapper">
        <table class="reports-table">
          <thead>
            <tr>
              <th class="col-domain">Domain / Link</th>
              <th class="col-ip">IP Address</th>
              <th class="col-provider">Provider / WAF</th>
              <th class="col-category">Category</th>
              <th class="col-date">Archived Date</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </section>
  `);

  attachArchiveEventListeners();
}

// ==========================================
// Event Listener Bindings
// ==========================================

function attachQueueEventListeners() {
  contentContainer.querySelectorAll('.cat-copy-domains').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const list = reportsData.activeQueue[cat] || [];
      const domains = list.map(item => typeof item === 'string' ? item : (item.url || item.domain));
      copyToClipboard(domains.join('\n'), `Copied ${domains.length} domain(s) from ${cat}`);
    });
  });

  contentContainer.querySelectorAll('.cat-copy-ips').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const list = reportsData.activeQueue[cat] || [];
      const ips = Array.from(new Set(
        list.map(item => typeof item === 'string' ? null : item.ip).filter(ip => ip && ip !== '-' && ip !== 'Resolving...')
      ));
      copyToClipboard(ips.join('\n'), `Copied ${ips.length} unique IP(s) from ${cat}`);
    });
  });

  contentContainer.querySelectorAll('.cat-archive').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cat = btn.dataset.cat;
      await sendMessage({ action: 'archiveItems', category: cat });
      await loadAndRender();
      showFeedback(`Archived category "${cat}"`, 'success');
    });
  });

  contentContainer.querySelectorAll('.btn-action--archive').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, cat } = btn.dataset;
      await sendMessage({ action: 'archiveItems', ids: [id], category: cat });
      await loadAndRender();
      showFeedback('Item archived', 'success');
    });
  });

  contentContainer.querySelectorAll('.btn-action--delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, cat, url } = btn.dataset;
      await sendMessage({ action: 'deleteReportEntry', id, category: cat, url });
      await loadAndRender();
      showFeedback('Entry deleted', 'success');
    });
  });
}

function attachArchiveEventListeners() {
  contentContainer.querySelectorAll('.archive-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, url } = btn.dataset;
      await sendMessage({ action: 'deleteReportEntry', id, url, isArchive: true });
      await loadAndRender();
      showFeedback('Archived record deleted', 'success');
    });
  });
}

// ==========================================
// Handlers & Copy Functions
// ==========================================

async function handleAddDomain() {
  const raw = addDomainInput.value.trim();
  if (!raw) return;

  const cat = addDomainSelect.value;
  addDomainBtn.disabled = true;

  try {
    const resp = await sendMessage({ action: 'addReport', url: raw, category: cat, force: true });
    if (resp.added > 0) {
      addDomainInput.value = '';
      showAddFeedback('Domain added to queue!', 'success');
      await loadAndRender();
    } else {
      showAddFeedback('Domain already exists in queue', 'error');
    }
  } catch (e) {
    showAddFeedback(`Error: ${e.message}`, 'error');
  } finally {
    addDomainBtn.disabled = false;
  }
}

function handleCopyDomains() {
  let domains = [];
  if (activeTab === 'queue') {
    const items = getAllQueueItems();
    domains = items.map(item => item.url || item.domain);
  } else {
    const archived = reportsData.archivedReports || [];
    domains = archived.map(item => typeof item === 'string' ? item : (item.url || item.domain));
  }

  if (domains.length === 0) {
    showFeedback('No domains to copy', 'error');
    return;
  }

  copyToClipboard(domains.join('\n'), `Copied ${domains.length} domain(s) to clipboard`);
}

function handleCopyIps() {
  let ipsSet = new Set();

  if (activeTab === 'queue') {
    const items = getAllQueueItems();
    items.forEach(item => {
      if (item.ip && item.ip !== '-' && item.ip !== 'Resolving...') ipsSet.add(item.ip);
    });
  } else {
    const archived = reportsData.archivedReports || [];
    archived.forEach(item => {
      if (typeof item !== 'string' && item.ip && item.ip !== '-' && item.ip !== 'Resolving...') {
        ipsSet.add(item.ip);
      }
    });
  }

  const ips = Array.from(ipsSet);
  if (ips.length === 0) {
    showFeedback('No valid IP addresses to copy', 'error');
    return;
  }

  copyToClipboard(ips.join('\n'), `Copied ${ips.length} unique IP address(es) to clipboard`);
}

async function handleArchiveAll() {
  const items = getAllQueueItems();
  if (items.length === 0) {
    showFeedback('Current Queue is empty', 'error');
    return;
  }

  await sendMessage({ action: 'archiveItems', archiveAll: true });
  await loadAndRender();
  showFeedback(`Moved ${items.length} item(s) to Archive`, 'success');
}

let clearConfirming = false;
let clearConfirmTimer = null;

function resetClearButtonState() {
  clearConfirming = false;
  clearTimeout(clearConfirmTimer);
  if (btnClearQueue) {
    btnClearQueue.textContent = (activeTab === 'queue') ? 'Clear Queue' : 'Clear Archive';
    btnClearQueue.classList.remove('reports-btn--confirming');
  }
}

async function handleClearAction() {
  if (!clearConfirming) {
    clearConfirming = true;
    btnClearQueue.textContent = 'Are you sure?';
    btnClearQueue.classList.add('reports-btn--confirming');
    clearTimeout(clearConfirmTimer);
    clearConfirmTimer = setTimeout(() => {
      resetClearButtonState();
    }, 3000);
    return;
  }

  resetClearButtonState();

  if (activeTab === 'queue') {
    await sendMessage({ action: 'clearReportQueue' });
    showFeedback('Queue cleared', 'success');
  } else {
    await sendMessage({ action: 'clearArchive' });
    showFeedback('Archive cleared', 'success');
  }
  await loadAndRender();
}

async function copyToClipboard(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showFeedback(successMsg, 'success');
  } catch {
    showFeedback('Failed to copy to clipboard', 'error');
  }
}

function showFeedback(msg, type) {
  clearTimeout(feedbackTimeout);
  actionFeedback.textContent = msg;
  actionFeedback.className = `reports-feedback reports-feedback--${type}`;
  actionFeedback.hidden = false;
  feedbackTimeout = setTimeout(() => { actionFeedback.hidden = true; }, 3000);
}

function showAddFeedback(msg, type) {
  addDomainFeedback.textContent = msg;
  addDomainFeedback.className = `add-domain-feedback add-domain-feedback--${type}`;
  addDomainFeedback.hidden = false;
  setTimeout(() => { addDomainFeedback.hidden = true; }, 3000);
}

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}
