/**
 * app.js
 * Application entry point and state orchestrator for ClearLedger.
 * Coordinates navigation, shared state, CSV export, notifications,
 * and synchronization across Dashboard, Transactions, Analytics, and Budget views.
 */

import { initAnalytics, renderAnalytics } from './analytics.js';
import { initBudget, renderBudget } from './budget.js';
import { initDashboard, renderDashboard } from './dashboard.js';
import {
  getBudgetForMonth,
  getTransactions,
  resetDemoData,
  seedDemoDataIfFirstVisit,
} from './storage.js';
import {
  initTransactions,
  openAddTransactionModal,
  renderTransactions,
} from './transactions.js';

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  analytics: 'Analytics',
  budget: 'Budget Management',
};

function getCurrentMonthKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

const state = {
  activeView: 'dashboard',
  activeMonth: getCurrentMonthKey(),
  transactions: [],
  budgetLimit: 2500,
};

const dom = {};

function cacheDom() {
  dom.sidebar = document.getElementById('sidebar');
  dom.sidebarBackdrop = document.getElementById('sidebar-backdrop');
  dom.sidebarOpenBtn = document.getElementById('sidebar-open-btn');
  dom.sidebarCloseBtn = document.getElementById('sidebar-close-btn');

  dom.navItems = document.querySelectorAll('[data-nav]');
  dom.views = {
    dashboard: document.getElementById('view-dashboard'),
    transactions: document.getElementById('view-transactions'),
    analytics: document.getElementById('view-analytics'),
    budget: document.getElementById('view-budget'),
  };

  dom.topbarTitle = document.getElementById('topbar-title');
  dom.monthInput = document.getElementById('active-month-input');
  dom.addTxBtn = document.getElementById('open-add-tx-btn');

  dom.exportCsvBtn = document.getElementById('export-csv-btn');
  dom.resetDemoBtn = document.getElementById('reset-demo-btn');
  dom.toastContainer = document.getElementById('toast-container');
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' is-error' : ''}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3000);
}

function openMobileSidebar() {
  dom.sidebar.classList.add('open');
  dom.sidebarBackdrop.classList.add('open');
}

function closeMobileSidebar() {
  dom.sidebar.classList.remove('open');
  dom.sidebarBackdrop.classList.remove('open');
}

function navigateTo(viewName) {
  const target = VIEW_TITLES[viewName] ? viewName : 'dashboard';
  state.activeView = target;

  // Update active nav link
  dom.navItems.forEach((item) => {
    const isMatch = item.dataset.nav === target;
    if (item.classList.contains('nav-item')) {
      item.classList.toggle('active', isMatch);
      if (isMatch) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
    }
  });

  // Update visible view section
  Object.entries(dom.views).forEach(([key, section]) => {
    section.classList.toggle('active', key === target);
  });

  dom.topbarTitle.textContent = VIEW_TITLES[target];
  closeMobileSidebar();

  // Render active view so Chart.js measures visible canvas dimensions accurately
  renderAllViews();
}

function renderAllViews() {
  state.budgetLimit = getBudgetForMonth(state.activeMonth);

  renderDashboard(state.transactions, state.activeMonth, state.budgetLimit);
  renderTransactions(state.transactions);
  renderAnalytics(state.transactions);
  renderBudget(state.transactions, state.activeMonth, state.budgetLimit);
  refreshIcons();
}

function exportTransactionsToCSV() {
  if (state.transactions.length === 0) {
    showToast('No transactions to export.', true);
    return;
  }

  const headers = ['ID', 'Date', 'Title', 'Category', 'Type', 'Amount', 'Description'];
  const escapeCsvCell = (val) => {
    const str = String(val ?? '');
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = state.transactions.map((tx) =>
    [
      tx.id,
      tx.date,
      tx.title,
      tx.category,
      tx.type,
      tx.amount.toFixed(2),
      tx.description,
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `clearledger-transactions-${state.activeMonth}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast('Exported transactions to CSV');
}

function initApp() {
  cacheDom();

  // Seed sample data on first visit only
  seedDemoDataIfFirstVisit(new Date());
  state.transactions = getTransactions();
  state.budgetLimit = getBudgetForMonth(state.activeMonth);

  dom.monthInput.value = state.activeMonth;

  // Initialize feature modules
  initTransactions({
    onTransactionsChanged: (updatedList) => {
      state.transactions = updatedList;
      renderAllViews();
    },
    notify: showToast,
    refreshIcons,
  });

  initDashboard({
    onNavigate: navigateTo,
    refreshIcons,
  });

  initAnalytics();

  initBudget({
    onBudgetChanged: () => {
      renderAllViews();
    },
    notify: showToast,
    refreshIcons,
  });

  // Navigation event listeners
  dom.navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(item.dataset.nav);
    });
  });

  // Delegated inline navigation links inside views (e.g. "View All Transactions", "Manage Budget")
  document.getElementById('main-content').addEventListener('click', (e) => {
    const navLink = e.target.closest('[data-nav-link]');
    if (navLink) {
      navigateTo(navLink.dataset.navLink);
    }
  });

  // Mobile sidebar controls
  dom.sidebarOpenBtn.addEventListener('click', openMobileSidebar);
  dom.sidebarCloseBtn.addEventListener('click', closeMobileSidebar);
  dom.sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  // Active month picker
  dom.monthInput.addEventListener('change', (e) => {
    const val = e.target.value;
    if (/^\d{4}-\d{2}$/.test(val)) {
      state.activeMonth = val;
      renderAllViews();
    }
  });

  // Primary CTA: Add Transaction
  dom.addTxBtn.addEventListener('click', () => openAddTransactionModal('expense'));

  // Sidebar Utilities
  dom.exportCsvBtn.addEventListener('click', exportTransactionsToCSV);
  dom.resetDemoBtn.addEventListener('click', () => {
    state.transactions = resetDemoData(new Date());
    state.activeMonth = getCurrentMonthKey();
    dom.monthInput.value = state.activeMonth;
    renderAllViews();
    showToast('Sample data restored');
  });

  // Initial render
  navigateTo('dashboard');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Re-render once external CDN scripts (Chart.js / Lucide) finish loading if needed
window.addEventListener('load', () => {
  renderAllViews();
});
