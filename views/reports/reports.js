import { escapeHtml, sendMessage, cleanUrl } from '../../utils/domain-utils.js';

// ==========================================
// DOM Elements & State
// ==========================================

const sidebarDatesEl = document.getElementById('sidebar-dates');
const categoriesContainer = document.getElementById('categories-container');
const actionFeedback = document.getElementById('action-feedback');
const reportsTitleEl = document.getElementById('reports-title');
const reportsSubtitleEl = document.getElementById('reports-subtitle');
const sessionActionsEl = document.getElementById('session-actions');
const btnCopySession = document.getElementById('btn-copy-session');
const btnDeleteSession = document.getElementById('btn-delete-session');
const addDomainInput = document.getElementById('add-domain-input');
const addDomainSelect = document.getElementById('add-domain-category');
const addDomainBtn = document.getElementById('add-domain-btn');
const addDomainFeedback = document.getElementById('add-domain-feedback');

let allData = { currentDate: '', currentUrls: {}, sessions: {} };
let selectedDate = '';
let categories = [];
let deleteSessionConfirming = false;
let deleteSessionTimer = null;
let feedbackTimeout = null;
let addFeedbackTimeout = null;

// ==========================================
// Initialization & Listeners
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadCategories();
  await loadAndRender();

  addDomainBtn.addEventListener('click', handleAddDomain);
  addDomainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddDomain();
  });

  btnCopySession.addEventListener('click', handleCopySession);
  btnDeleteSession.addEventListener('click', handleDeleteSession);
});

/** Loads configured categories for domain entry select element. */
async function loadCategories() {
  try {
    const resp = await sendMessage({ action: 'getSettings' });
    categories = resp?.categories?.length > 0 ? resp.categories : ['other'];
  } catch {
    categories = ['other'];
  }
  addDomainSelect.innerHTML = categories
    .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    .join('');
}

/** Fetches session report data and renders sidebar and main view. */
async function loadAndRender() {
  try {
    const resp = await sendMessage({ action: 'getReportedSessions' });
    allData = resp;
    selectedDate = selectedDate || allData.currentDate;
    renderSidebar();
    renderSession(selectedDate);
  } catch (e) {
    categoriesContainer.innerHTML = `<div class="empty-state">Error loading data: ${escapeHtml(e.message)}</div>`;
  }
}

// ==========================================
// UI Rendering
// ==========================================

/** Renders sidebar date list buttons. */
function renderSidebar() {
  const { currentDate, currentUrls, sessions } = allData;
  const currentCount = countSessionEntries(currentUrls);
  const historyDates = Object.keys(sessions).sort((a, b) => b.localeCompare(a));

  let html = `
    <button class="sidebar-date-btn ${selectedDate === currentDate ? 'active' : ''}"
            data-date="${escapeHtml(currentDate)}" id="sidebar-btn-today">
      <span class="sidebar-date-btn__label">Today</span>
      <span class="sidebar-date-btn__count">${currentCount} ${pluralEn(currentCount)}</span>
    </button>
  `;

  if (historyDates.length > 0) {
    html += `<div class="sidebar-divider"></div>`;
    historyDates.forEach(date => {
      const count = countSessionEntries(sessions[date]);
      html += `
        <button class="sidebar-date-btn ${selectedDate === date ? 'active' : ''}"
                data-date="${escapeHtml(date)}">
          <span class="sidebar-date-btn__label">${escapeHtml(date)}</span>
          <span class="sidebar-date-btn__count">${count} ${pluralEn(count)}</span>
        </button>
      `;
    });
  }

  sidebarDatesEl.innerHTML = html;

  sidebarDatesEl.querySelectorAll('.sidebar-date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDate = btn.dataset.date;
      document.querySelectorAll('.sidebar-date-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSession(selectedDate);
    });
  });
}

/** Renders domain report list for selected date session. */
function renderSession(date) {
  const { currentDate, currentUrls, sessions } = allData;
  const isToday = (date === currentDate);
  const sessionData = isToday ? currentUrls : (sessions[date] || {});

  if (isToday) {
    reportsTitleEl.textContent = 'Current Queue';
    reportsSubtitleEl.textContent = `Today — ${date}`;
  } else {
    reportsTitleEl.textContent = `Session from ${date}`;
    reportsSubtitleEl.textContent = formatDateLabel(date);
  }

  addDomainInput.dataset.targetDate = date;
  sessionActionsEl.hidden = false;

  const activeCats = Object.keys(sessionData).filter(
    cat => Array.isArray(sessionData[cat]) && sessionData[cat].length > 0
  );

  if (activeCats.length === 0) {
    categoriesContainer.innerHTML = `
      <div class="empty-state">
        No domains in this session.<br>
        <span style="font-size: 12px; color: var(--text-tertiary);">
          You can add a domain manually above.
        </span>
      </div>
    `;
    return;
  }

  categoriesContainer.innerHTML = activeCats.map(cat => {
    const list = sessionData[cat];
    const entriesHtml = list.map(url => `
      <li class="url-entry">
        <span class="url-entry__text">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>
        </span>
        <button
          class="url-entry__delete"
          data-date="${escapeHtml(date)}"
          data-cat="${escapeHtml(cat)}"
          data-url="${escapeHtml(url)}"
          title="Delete this entry"
        >🗑️</button>
      </li>
    `).join('');

    return `
      <section class="reports-section" data-cat="${escapeHtml(cat)}">
        <div class="reports-section__header">
          <h2 class="reports-section__title">${escapeHtml(cat)}</h2>
          <div class="reports-section__header-actions">
            <span class="reports-section__badge">${list.length} URL</span>
            <button class="reports-section__copy-btn" data-cat="${escapeHtml(cat)}" title="Copy URLs in this category">
              <svg viewBox="0 0 24 24" fill="none" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
                <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              Copy
            </button>
          </div>
        </div>
        <ul class="url-list">${entriesHtml}</ul>
      </section>
    `;
  }).join('');

  categoriesContainer.querySelectorAll('.reports-section__copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cat = btn.dataset.cat;
      const list = sessionData[cat] || [];
      if (!list.length) return;
      const text = list.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        showFeedback(`Copied "${cat}" category to clipboard`, 'success');
      } catch {
        showFeedback('Error copying', 'error');
      }
    });
  });

  categoriesContainer.querySelectorAll('.url-entry__delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { date: d, cat, url } = btn.dataset;
      try {
        await sendMessage({ action: 'deleteSessionEntry', date: d, category: cat, url });
        await loadAndRender();
        showFeedback('Entry deleted', 'success');
      } catch {
        showFeedback('Error deleting entry', 'error');
      }
    });
  });
}

// ==========================================
// Handlers & Actions
// ==========================================

/** Handles manual domain entry addition to selected session. */
async function handleAddDomain() {
  const raw = addDomainInput.value.trim();
  if (!raw) return;

  const cat = addDomainSelect.value;
  const targetDate = addDomainInput.dataset.targetDate || allData.currentDate;
  const clean = cleanUrl(raw);

  if (!clean) {
    showAddFeedback('Invalid URL or domain', 'error');
    return;
  }

  try {
    const resp = await sendMessage({
      action: 'addToSession',
      date: targetDate,
      category: cat,
      url: clean
    });

    if (resp.added > 0) {
      addDomainInput.value = '';
      showAddFeedback(`✓ Added to session ${targetDate}`, 'success');
      await loadAndRender();
    } else if (resp.existingDate) {
      showAddFeedback(`⚠ Already added: ${resp.existingDate}`, 'warn');
    } else {
      showAddFeedback('Could not add (duplicate)', 'warn');
    }
  } catch {
    showAddFeedback('Error adding domain', 'error');
  }
}

/** Copies session domain list to clipboard. */
async function handleCopySession() {
  const { currentDate, currentUrls, sessions } = allData;
  const isToday = (selectedDate === currentDate);
  const sessionData = isToday ? currentUrls : (sessions[selectedDate] || {});

  const lines = [];
  for (const [cat, list] of Object.entries(sessionData)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    list.forEach(url => lines.push(url));
  }

  const text = lines.join('\n').trim();
  if (!text) {
    showFeedback('No data to copy', 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showFeedback('Copied list to clipboard', 'success');
  } catch {
    showFeedback('Error copying', 'error');
  }
}

/** Handles session deletion with double-click confirmation. */
async function handleDeleteSession() {
  if (!deleteSessionConfirming) {
    deleteSessionConfirming = true;
    btnDeleteSession.textContent = '⚠ Confirm deletion';
    btnDeleteSession.classList.add('confirming');
    deleteSessionTimer = setTimeout(() => {
      resetDeleteConfirm();
    }, 4000);
    return;
  }

  clearTimeout(deleteSessionTimer);
  resetDeleteConfirm();

  try {
    await sendMessage({ action: 'deleteSession', date: selectedDate });
    if (selectedDate !== allData.currentDate) {
      selectedDate = allData.currentDate;
    }
    await loadAndRender();
    showFeedback(`Deleted session ${selectedDate}`, 'success');
  } catch {
    showFeedback('Error deleting session', 'error');
  }
}

function resetDeleteConfirm() {
  deleteSessionConfirming = false;
  btnDeleteSession.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
      <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Delete session
  `;
  btnDeleteSession.classList.remove('confirming');
}

// ==========================================
// Helpers & Feedback
// ==========================================

function showFeedback(msg, type) {
  actionFeedback.hidden = false;
  actionFeedback.textContent = msg;
  actionFeedback.className = `reports-feedback reports-feedback--${type}`;
  clearTimeout(feedbackTimeout);
  feedbackTimeout = setTimeout(() => { actionFeedback.hidden = true; }, 3500);
}

function showAddFeedback(msg, type) {
  addDomainFeedback.hidden = false;
  addDomainFeedback.textContent = msg;
  addDomainFeedback.className = `add-domain-feedback add-domain-feedback--${type}`;
  clearTimeout(addFeedbackTimeout);
  addFeedbackTimeout = setTimeout(() => { addDomainFeedback.hidden = true; }, 4000);
}

function pluralEn(n) {
  return n === 1 ? 'entry' : 'entries';
}

function formatDateLabel(dateStr) {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function countSessionEntries(sessionObj) {
  return Object.values(sessionObj || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}
