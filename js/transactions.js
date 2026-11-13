/**
 * transactions.js
 * Pure transaction calculations, validation, filtering, and UI management
 * for Transaction History and the Add / Edit / Delete modals.
 *
 * Financial calculations are pure functions independent of storage so they
 * work identically with LocalStorage today or a REST API in the future.
 */

import {
  ALL_CATEGORIES,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  addTransaction as persistNewTransaction,
  updateTransaction as persistUpdatedTransaction,
  deleteTransaction as persistDeletedTransaction,
} from './storage.js';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount, withSign = false) {
  const num = Number(amount) || 0;
  const absFormatted = currencyFormatter.format(Math.abs(num));
  if (num < 0) return `-${absFormatted}`;
  if (withSign && num > 0) return `+${absFormatted}`;
  return absFormatted;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(dateObj.getTime())) return dateStr;
  return dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatMonthLabel(monthKey) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return 'Current Month';
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Pure calculation of overall and selected-month financial totals.
 * Total Balance = Total Income - Total Expenses.
 */
export function calculateSummaryTotals(transactions, activeMonth) {
  let totalIncome = 0;
  let totalExpenses = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  let monthlySpending = 0;
  let monthlyIncome = 0;
  let monthlyExpenseCount = 0;

  for (const tx of transactions) {
    const amt = Number(tx.amount) || 0;
    const isMonthMatch = activeMonth ? tx.date.startsWith(activeMonth) : true;

    if (tx.type === 'income') {
      totalIncome += amt;
      incomeCount += 1;
      if (isMonthMatch) monthlyIncome += amt;
    } else {
      totalExpenses += amt;
      expenseCount += 1;
      if (isMonthMatch) {
        monthlySpending += amt;
        monthlyExpenseCount += 1;
      }
    }
  }

  return {
    totalBalance: totalIncome - totalExpenses,
    totalIncome,
    totalExpenses,
    incomeCount,
    expenseCount,
    monthlySpending,
    monthlyIncome,
    monthlyExpenseCount,
  };
}

/**
 * Pure filter and sort function for transactions.
 */
export function filterAndSortTransactions(transactions, { search = '', type = 'all', category = 'all', sort = 'date-desc' }) {
  const query = search.trim().toLowerCase();

  const filtered = transactions.filter((tx) => {
    if (type !== 'all' && tx.type !== type) return false;
    if (category !== 'all' && tx.category !== category) return false;
    if (query) {
      const hay = `${tx.title} ${tx.description} ${tx.category}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'date-asc') {
      return a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
    }
    if (sort === 'amount-desc') {
      return b.amount - a.amount || b.date.localeCompare(a.date);
    }
    if (sort === 'amount-asc') {
      return a.amount - b.amount || b.date.localeCompare(a.date);
    }
    // Default: date-desc
    return b.date.localeCompare(a.date) || a.title.localeCompare(b.title);
  });

  return filtered;
}

/**
 * Validates transaction form input before saving.
 */
export function validateTransactionInput(input) {
  const errors = {};
  const title = String(input.title || '').trim();
  const amount = Number(input.amount);
  const category = String(input.category || '').trim();
  const type = input.type === 'income' ? 'income' : 'expense';
  const date = String(input.date || '').trim();
  const description = String(input.description || '').trim();

  if (!title) {
    errors.title = 'Please enter a transaction title.';
  } else if (title.length > 80) {
    errors.title = 'Title must be 80 characters or fewer.';
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = 'Enter a valid amount greater than 0.';
  } else if (amount > 100000000) {
    errors.amount = 'Amount is unreasonably large.';
  }

  if (!category) {
    errors.category = 'Please select a category.';
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.date = 'Please select a valid date.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized: {
      title,
      amount: Math.round(amount * 100) / 100,
      category,
      type,
      date,
      description,
    },
  };
}

/**
 * Generates clean HTML for a single transaction table row.
 */
export function renderTransactionRowHTML(tx) {
  const isIncome = tx.type === 'income';
  const amountPrefix = isIncome ? '+' : '-';
  const typeLabel = isIncome ? 'Income' : 'Expense';
  const descHTML = tx.description
    ? `<div class="tx-desc" title="${escapeHTML(tx.description)}">${escapeHTML(tx.description)}</div>`
    : '';

  return `
    <tr data-tx-id="${escapeHTML(tx.id)}">
      <td class="tx-date tabular-nums">${escapeHTML(formatDate(tx.date))}</td>
      <td>
        <div class="tx-title">${escapeHTML(tx.title)}</div>
        ${descHTML}
      </td>
      <td class="tx-category">${escapeHTML(tx.category)}</td>
      <td>
        <span class="tx-type-text ${isIncome ? 'income' : 'expense'}">${typeLabel}</span>
      </td>
      <td class="text-right tx-amount tabular-nums ${isIncome ? 'income' : 'expense'}">
        ${amountPrefix}${escapeHTML(formatCurrency(tx.amount))}
      </td>
      <td class="text-right">
        <div class="row-actions">
          <button
            type="button"
            class="icon-btn"
            data-action="edit-tx"
            data-tx-id="${escapeHTML(tx.id)}"
            aria-label="Edit ${escapeHTML(tx.title)}"
            title="Edit"
          >
            <i data-lucide="pencil"></i>
          </button>
          <button
            type="button"
            class="icon-btn danger"
            data-action="delete-tx"
            data-tx-id="${escapeHTML(tx.id)}"
            aria-label="Delete ${escapeHTML(tx.title)}"
            title="Delete"
          >
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </td>
    </tr>
  `;
}

// ============================================================================
// UI State & Event Controller
// ============================================================================

const filterState = {
  search: '',
  type: 'all',
  category: 'all',
  sort: 'date-desc',
};

let currentTransactions = [];
let pendingDeleteId = null;
let callbacks = {
  onTransactionsChanged: () => {},
  notify: () => {},
  refreshIcons: () => {},
};

const dom = {};

function cacheDom() {
  dom.tbody = document.getElementById('transactions-tbody');
  dom.empty = document.getElementById('transactions-empty');
  dom.emptyTitle = document.getElementById('transactions-empty-title');
  dom.emptyDesc = document.getElementById('transactions-empty-desc');
  dom.emptyResetBtn = document.getElementById('tx-empty-reset-btn');
  dom.resultsSummary = document.getElementById('tx-results-summary');
  dom.clearFiltersBtn = document.getElementById('tx-clear-filters-btn');

  dom.searchInput = document.getElementById('tx-search');
  dom.typeButtons = document.querySelectorAll('[data-tx-type]');
  dom.categorySelect = document.getElementById('tx-filter-category');
  dom.sortSelect = document.getElementById('tx-sort');

  // Add / Edit Modal
  dom.modal = document.getElementById('transaction-modal');
  dom.modalTitle = document.getElementById('tx-modal-title');
  dom.modalClose = document.getElementById('tx-modal-close');
  dom.modalCancel = document.getElementById('tx-modal-cancel');
  dom.modalSubmit = document.getElementById('tx-modal-submit');
  dom.form = document.getElementById('transaction-form');

  dom.inputId = document.getElementById('tx-id');
  dom.inputType = document.getElementById('tx-type');
  dom.typeToggleBtns = document.querySelectorAll('[data-form-type]');
  dom.inputTitle = document.getElementById('tx-title');
  dom.inputAmount = document.getElementById('tx-amount');
  dom.inputCategory = document.getElementById('tx-category');
  dom.inputDate = document.getElementById('tx-date');
  dom.inputDesc = document.getElementById('tx-description');

  dom.errTitle = document.getElementById('tx-title-error');
  dom.errAmount = document.getElementById('tx-amount-error');
  dom.errCategory = document.getElementById('tx-category-error');
  dom.errDate = document.getElementById('tx-date-error');

  // Delete Modal
  dom.deleteModal = document.getElementById('delete-modal');
  dom.deleteMessage = document.getElementById('delete-modal-message');
  dom.deleteClose = document.getElementById('delete-modal-close');
  dom.deleteCancel = document.getElementById('delete-modal-cancel');
  dom.deleteConfirm = document.getElementById('delete-modal-confirm');
}

function populateFilterCategories() {
  const existingValue = dom.categorySelect.value || 'all';
  dom.categorySelect.innerHTML = '<option value="all">All Categories</option>';
  for (const cat of ALL_CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    dom.categorySelect.appendChild(opt);
  }
  dom.categorySelect.value = ALL_CATEGORIES.includes(existingValue) ? existingValue : 'all';
}

function populateFormCategories(type, selectedCategory = '') {
  const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  dom.inputCategory.innerHTML = '';
  for (const cat of categories) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    dom.inputCategory.appendChild(opt);
  }
  if (selectedCategory && categories.includes(selectedCategory)) {
    dom.inputCategory.value = selectedCategory;
  } else {
    dom.inputCategory.value = categories[0];
  }
}

function setFormType(type, preserveCategory = false) {
  const normalized = type === 'income' ? 'income' : 'expense';
  const prevCat = preserveCategory ? dom.inputCategory.value : '';
  dom.inputType.value = normalized;
  dom.typeToggleBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.formType === normalized);
  });
  populateFormCategories(normalized, prevCat);
}

function clearFormErrors() {
  const pairs = [
    [dom.inputTitle, dom.errTitle],
    [dom.inputAmount, dom.errAmount],
    [dom.inputCategory, dom.errCategory],
    [dom.inputDate, dom.errDate],
  ];
  for (const [input, errEl] of pairs) {
    input.removeAttribute('aria-invalid');
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }
}

function showFormErrors(errors) {
  clearFormErrors();
  const map = {
    title: [dom.inputTitle, dom.errTitle],
    amount: [dom.inputAmount, dom.errAmount],
    category: [dom.inputCategory, dom.errCategory],
    date: [dom.inputDate, dom.errDate],
  };
  for (const [key, msg] of Object.entries(errors)) {
    if (map[key]) {
      const [input, errEl] = map[key];
      input.setAttribute('aria-invalid', 'true');
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
  }
}

function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function openAddTransactionModal(defaultType = 'expense') {
  clearFormErrors();
  dom.form.reset();
  dom.inputId.value = '';
  dom.modalTitle.textContent = 'Add Transaction';
  dom.modalSubmit.textContent = 'Save Transaction';
  setFormType(defaultType, false);
  dom.inputDate.value = getTodayDateString();
  dom.modal.classList.remove('hidden');
  callbacks.refreshIcons();
  requestAnimationFrame(() => dom.inputTitle.focus());
}

export function openEditTransactionModal(txId) {
  const tx = currentTransactions.find((item) => item.id === txId);
  if (!tx) return;

  clearFormErrors();
  dom.inputId.value = tx.id;
  dom.modalTitle.textContent = 'Edit Transaction';
  dom.modalSubmit.textContent = 'Update Transaction';
  setFormType(tx.type, false);
  dom.inputTitle.value = tx.title;
  dom.inputAmount.value = tx.amount.toFixed(2);
  dom.inputCategory.value = tx.category;
  dom.inputDate.value = tx.date;
  dom.inputDesc.value = tx.description || '';
  dom.modal.classList.remove('hidden');
  callbacks.refreshIcons();
  requestAnimationFrame(() => dom.inputTitle.focus());
}

function closeTransactionModal() {
  dom.modal.classList.add('hidden');
  clearFormErrors();
}

export function openDeleteTransactionModal(txId) {
  const tx = currentTransactions.find((item) => item.id === txId);
  if (!tx) return;
  pendingDeleteId = tx.id;
  dom.deleteMessage.textContent = `Delete "${tx.title}" (${formatCurrency(tx.amount)}) dated ${formatDate(tx.date)}? This action cannot be undone.`;
  dom.deleteModal.classList.remove('hidden');
  callbacks.refreshIcons();
  requestAnimationFrame(() => dom.deleteConfirm.focus());
}

function closeDeleteModal() {
  pendingDeleteId = null;
  dom.deleteModal.classList.add('hidden');
}

function handleFormSubmit(event) {
  event.preventDefault();

  const payload = {
    type: dom.inputType.value,
    title: dom.inputTitle.value,
    amount: dom.inputAmount.value,
    category: dom.inputCategory.value,
    date: dom.inputDate.value,
    description: dom.inputDesc.value,
  };

  const { isValid, errors, sanitized } = validateTransactionInput(payload);
  if (!isValid) {
    showFormErrors(errors);
    return;
  }

  const editId = dom.inputId.value.trim();
  if (editId) {
    const result = persistUpdatedTransaction(editId, sanitized);
    closeTransactionModal();
    callbacks.onTransactionsChanged(result.transactions);
    callbacks.notify('Transaction updated');
  } else {
    const result = persistNewTransaction(sanitized);
    closeTransactionModal();
    callbacks.onTransactionsChanged(result.transactions);
    callbacks.notify(`${sanitized.type === 'income' ? 'Income' : 'Expense'} added`);
  }
}

function handleDeleteConfirm() {
  if (!pendingDeleteId) return;
  const updatedList = persistDeletedTransaction(pendingDeleteId);
  closeDeleteModal();
  callbacks.onTransactionsChanged(updatedList);
  callbacks.notify('Transaction deleted');
}

function resetFilters() {
  filterState.search = '';
  filterState.type = 'all';
  filterState.category = 'all';
  filterState.sort = 'date-desc';

  dom.searchInput.value = '';
  dom.categorySelect.value = 'all';
  dom.sortSelect.value = 'date-desc';
  dom.typeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.txType === 'all');
  });

  renderTransactions(currentTransactions);
}

export function renderTransactions(transactions) {
  currentTransactions = transactions;
  const filtered = filterAndSortTransactions(transactions, filterState);
  const hasActiveFilters =
    filterState.search.trim() !== '' ||
    filterState.type !== 'all' ||
    filterState.category !== 'all';

  dom.clearFiltersBtn.classList.toggle('hidden', !hasActiveFilters);

  const netFiltered = filtered.reduce(
    (sum, tx) => sum + (tx.type === 'income' ? tx.amount : -tx.amount),
    0
  );
  const countLabel = `${filtered.length} ${filtered.length === 1 ? 'transaction' : 'transactions'}`;
  dom.resultsSummary.textContent = `${countLabel} · Net: ${formatCurrency(netFiltered, true)}`;

  if (filtered.length === 0) {
    dom.tbody.innerHTML = '';
    dom.empty.classList.remove('hidden');

    if (transactions.length === 0) {
      dom.emptyTitle.textContent = 'No transactions recorded yet';
      dom.emptyDesc.textContent = 'Start by adding your first income or expense transaction.';
      dom.emptyResetBtn.classList.add('hidden');
    } else {
      dom.emptyTitle.textContent = 'No matching transactions';
      dom.emptyDesc.textContent = 'Try adjusting your search query or category/type filters.';
      dom.emptyResetBtn.classList.remove('hidden');
    }
  } else {
    dom.empty.classList.add('hidden');
    dom.tbody.innerHTML = filtered.map(renderTransactionRowHTML).join('');
  }

  callbacks.refreshIcons();
}

export function initTransactions(appCallbacks) {
  callbacks = { ...callbacks, ...appCallbacks };
  cacheDom();
  populateFilterCategories();
  populateFormCategories('expense');

  // Filter & Search Listeners
  dom.searchInput.addEventListener('input', (e) => {
    filterState.search = e.target.value;
    renderTransactions(currentTransactions);
  });

  dom.typeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterState.type = btn.dataset.txType || 'all';
      dom.typeButtons.forEach((b) => b.classList.toggle('active', b === btn));
      renderTransactions(currentTransactions);
    });
  });

  dom.categorySelect.addEventListener('change', (e) => {
    filterState.category = e.target.value;
    renderTransactions(currentTransactions);
  });

  dom.sortSelect.addEventListener('change', (e) => {
    filterState.sort = e.target.value;
    renderTransactions(currentTransactions);
  });

  dom.clearFiltersBtn.addEventListener('click', resetFilters);
  dom.emptyResetBtn.addEventListener('click', resetFilters);
  const txEmptyAddBtn = dom.empty.querySelector('[data-action="open-add"]');
  if (txEmptyAddBtn) {
    txEmptyAddBtn.addEventListener('click', () => openAddTransactionModal('expense'));
  }

  // Table Action Delegation (Edit / Delete)
  dom.tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const txId = btn.dataset.txId;
    if (btn.dataset.action === 'edit-tx') openEditTransactionModal(txId);
    if (btn.dataset.action === 'delete-tx') openDeleteTransactionModal(txId);
  });

  // Modal Form Listeners
  dom.typeToggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => setFormType(btn.dataset.formType, false));
  });

  dom.form.addEventListener('submit', handleFormSubmit);
  dom.modalClose.addEventListener('click', closeTransactionModal);
  dom.modalCancel.addEventListener('click', closeTransactionModal);
  dom.modal.addEventListener('click', (e) => {
    if (e.target === dom.modal) closeTransactionModal();
  });

  // Delete Modal Listeners
  dom.deleteClose.addEventListener('click', closeDeleteModal);
  dom.deleteCancel.addEventListener('click', closeDeleteModal);
  dom.deleteConfirm.addEventListener('click', handleDeleteConfirm);
  dom.deleteModal.addEventListener('click', (e) => {
    if (e.target === dom.deleteModal) closeDeleteModal();
  });

  // Escape Key Closes Open Modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!dom.modal.classList.contains('hidden')) closeTransactionModal();
      if (!dom.deleteModal.classList.contains('hidden')) closeDeleteModal();
    }
  });
}
