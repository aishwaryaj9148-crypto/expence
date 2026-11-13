/**
 * dashboard.js
 * Renders the Dashboard view:
 * - Dynamic KPI summary cards (Total Balance, Income, Expenses, Monthly Spending)
 * - Budget alert banner when monthly spending reaches >= 80% or exceeds 100%
 * - Monthly Spending Overview chart (6-Month trajectory or Daily view for selected month)
 * - Expense Category Breakdown doughnut chart + structured legend
 * - Recent Transactions table with quick Edit / Delete actions
 */

import { buildBudgetBannerData, calculateBudgetMetrics } from './budget.js';
import {
  calculateSummaryTotals,
  escapeHTML,
  filterAndSortTransactions,
  formatCurrency,
  formatMonthLabel,
  openAddTransactionModal,
  openDeleteTransactionModal,
  openEditTransactionModal,
  renderTransactionRowHTML,
} from './transactions.js';

export const CHART_PALETTE = [
  '#0F172A', // Deep Slate
  '#0D9488', // Teal
  '#2563EB', // Royal Blue
  '#D97706', // Amber
  '#DC2626', // Crimson
  '#7C3AED', // Violet
  '#059669', // Emerald
  '#64748B', // Cool Gray
  '#EA580C', // Burnt Orange
];

let spendingChartInstance = null;
let categoryChartInstance = null;
let spendingRangeMode = 'monthly'; // 'monthly' | 'daily'

let lastRenderArgs = {
  transactions: [],
  activeMonth: '',
  budgetLimit: 2500,
};

let callbacks = {
  onNavigate: () => {},
  refreshIcons: () => {},
};

const dom = {};

function cacheDom() {
  dom.budgetAlert = document.getElementById('dashboard-budget-alert');

  dom.kpiBalance = document.getElementById('kpi-balance');
  dom.kpiBalanceMeta = document.getElementById('kpi-balance-meta');
  dom.kpiIncome = document.getElementById('kpi-income');
  dom.kpiIncomeMeta = document.getElementById('kpi-income-meta');
  dom.kpiExpenses = document.getElementById('kpi-expenses');
  dom.kpiExpensesMeta = document.getElementById('kpi-expenses-meta');
  dom.kpiMonthlySpending = document.getElementById('kpi-monthly-spending');
  dom.kpiMonthlyMeta = document.getElementById('kpi-monthly-meta');

  dom.spendingSubtitle = document.getElementById('dashboard-spending-subtitle');
  dom.spendingCanvas = document.getElementById('dashboard-spending-chart');
  dom.spendingEmpty = document.getElementById('dashboard-spending-empty');
  dom.rangeButtons = document.querySelectorAll('[data-dashboard-range]');

  dom.categorySubtitle = document.getElementById('dashboard-category-subtitle');
  dom.categoryCanvas = document.getElementById('dashboard-category-chart');
  dom.categoryEmpty = document.getElementById('dashboard-category-empty');
  dom.categoryLegend = document.getElementById('dashboard-category-legend');

  dom.recentTbody = document.getElementById('dashboard-recent-tbody');
  dom.recentEmpty = document.getElementById('dashboard-recent-empty');
}

/**
 * Computes the last 6 YYYY-MM keys ending at activeMonth.
 */
function getLastSixMonths(activeMonth) {
  const [yStr, mStr] = activeMonth.split('-');
  const year = Number(yStr);
  const monthIdx = Number(mStr) - 1;
  const result = [];
  for (let offset = -5; offset <= 0; offset += 1) {
    const d = new Date(year, monthIdx + offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    result.push({ key, label });
  }
  return result;
}

/**
 * Pure computation for Monthly Spending Overview series.
 */
function buildSpendingSeries(transactions, activeMonth, mode) {
  const expenses = transactions.filter((tx) => tx.type === 'expense');

  if (mode === 'daily') {
    const [y, m] = activeMonth.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const dailyTotals = Array(daysInMonth).fill(0);

    for (const tx of expenses) {
      if (tx.date.startsWith(activeMonth)) {
        const day = Number(tx.date.split('-')[2]);
        if (day >= 1 && day <= daysInMonth) {
          dailyTotals[day - 1] += tx.amount;
        }
      }
    }

    return {
      labels: dailyTotals.map((_, idx) => String(idx + 1)),
      values: dailyTotals,
      hasData: dailyTotals.some((v) => v > 0),
    };
  }

  // Default: 6-month trajectory
  const months = getLastSixMonths(activeMonth);
  const totalsByMonth = new Map(months.map((m) => [m.key, 0]));
  for (const tx of expenses) {
    const ym = tx.date.slice(0, 7);
    if (totalsByMonth.has(ym)) {
      totalsByMonth.set(ym, totalsByMonth.get(ym) + tx.amount);
    }
  }

  const values = months.map((m) => totalsByMonth.get(m.key) || 0);
  return {
    labels: months.map((m) => m.label),
    values,
    hasData: values.some((v) => v > 0),
  };
}

function renderSpendingChart(transactions, activeMonth) {
  const series = buildSpendingSeries(transactions, activeMonth, spendingRangeMode);
  const monthLabel = formatMonthLabel(activeMonth);

  dom.spendingSubtitle.textContent =
    spendingRangeMode === 'daily'
      ? `Daily expenses in ${monthLabel}`
      : `Six-month spending trajectory ending ${monthLabel}`;

  if (!series.hasData || typeof window.Chart === 'undefined') {
    if (spendingChartInstance) {
      spendingChartInstance.destroy();
      spendingChartInstance = null;
    }
    dom.spendingEmpty.classList.remove('hidden');
    return;
  }

  dom.spendingEmpty.classList.add('hidden');
  const ctx = dom.spendingCanvas.getContext('2d');

  if (spendingChartInstance) {
    spendingChartInstance.destroy();
  }

  spendingChartInstance = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: series.labels,
      datasets: [
        {
          label: 'Expenses',
          data: series.values,
          backgroundColor: '#0F172A',
          hoverBackgroundColor: '#0D9488',
          borderRadius: 4,
          maxBarThickness: 32,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0F172A',
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            label: (context) => `Spent: ${formatCurrency(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#64748B',
            font: { size: 11, family: 'IBM Plex Mono' },
          },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: '#F1F5F9' },
          ticks: {
            color: '#64748B',
            font: { size: 11, family: 'IBM Plex Mono' },
            callback: (val) => `$${Number(val).toLocaleString()}`,
          },
        },
      },
    },
  });
}

function renderCategoryChart(transactions, activeMonth) {
  const monthLabel = formatMonthLabel(activeMonth);
  dom.categorySubtitle.textContent = `Expense distribution for ${monthLabel}`;

  const monthExpenses = transactions.filter(
    (tx) => tx.type === 'expense' && tx.date.startsWith(activeMonth)
  );

  const catTotals = new Map();
  let totalSpent = 0;
  for (const tx of monthExpenses) {
    catTotals.set(tx.category, (catTotals.get(tx.category) || 0) + tx.amount);
    totalSpent += tx.amount;
  }

  const entries = Array.from(catTotals.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      pct: totalSpent > 0 ? (amount / totalSpent) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  if (entries.length === 0 || typeof window.Chart === 'undefined') {
    if (categoryChartInstance) {
      categoryChartInstance.destroy();
      categoryChartInstance = null;
    }
    dom.categoryEmpty.classList.remove('hidden');
    dom.categoryLegend.innerHTML =
      '<li class="card-subtitle">No expenses recorded for this month.</li>';
    return;
  }

  dom.categoryEmpty.classList.add('hidden');

  const labels = entries.map((e) => e.category);
  const data = entries.map((e) => e.amount);
  const colors = entries.map((_, idx) => CHART_PALETTE[idx % CHART_PALETTE.length]);

  const ctx = dom.categoryCanvas.getContext('2d');
  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  categoryChartInstance = new window.Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderColor: '#FFFFFF',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '66%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0F172A',
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            label: (context) => {
              const val = context.parsed;
              const pct = totalSpent > 0 ? ((val / totalSpent) * 100).toFixed(1) : '0.0';
              return `${context.label}: ${formatCurrency(val)} (${pct}%)`;
            },
          },
        },
      },
    },
  });

  dom.categoryLegend.innerHTML = entries
    .slice(0, 6)
    .map(
      (entry, idx) => `
      <li class="legend-row">
        <div class="legend-left">
          <span class="legend-swatch" style="background-color: ${colors[idx]}"></span>
          <span class="legend-name">${escapeHTML(entry.category)}</span>
        </div>
        <div class="legend-right tabular-nums">
          <span class="legend-amount">${escapeHTML(formatCurrency(entry.amount))}</span>
          <span class="legend-pct">${entry.pct.toFixed(0)}%</span>
        </div>
      </li>
    `
    )
    .join('');
}

function renderRecentTransactions(transactions) {
  const recent = filterAndSortTransactions(transactions, { sort: 'date-desc' }).slice(0, 6);

  if (recent.length === 0) {
    dom.recentTbody.innerHTML = '';
    dom.recentEmpty.classList.remove('hidden');
  } else {
    dom.recentEmpty.classList.add('hidden');
    dom.recentTbody.innerHTML = recent.map(renderTransactionRowHTML).join('');
  }
}

export function renderDashboard(transactions, activeMonth, budgetLimit) {
  lastRenderArgs = { transactions, activeMonth, budgetLimit };

  const totals = calculateSummaryTotals(transactions, activeMonth);
  const budgetMetrics = calculateBudgetMetrics(transactions, activeMonth, budgetLimit);
  const monthLabel = formatMonthLabel(activeMonth);

  // KPI 1: Total Balance (Total Income - Total Expenses)
  dom.kpiBalance.textContent = formatCurrency(totals.totalBalance);
  dom.kpiBalance.className = 'kpi-value tabular-nums';
  if (totals.totalBalance > 0) dom.kpiBalance.classList.add('is-positive');
  if (totals.totalBalance < 0) dom.kpiBalance.classList.add('is-negative');
  dom.kpiBalanceMeta.textContent = `Total Income minus Total Expenses`;

  // KPI 2: Total Income
  dom.kpiIncome.textContent = formatCurrency(totals.totalIncome);
  dom.kpiIncomeMeta.textContent = `${totals.incomeCount} income ${totals.incomeCount === 1 ? 'entry' : 'entries'}`;

  // KPI 3: Total Expenses
  dom.kpiExpenses.textContent = formatCurrency(totals.totalExpenses);
  dom.kpiExpensesMeta.textContent = `${totals.expenseCount} expense ${totals.expenseCount === 1 ? 'entry' : 'entries'}`;

  // KPI 4: Monthly Spending
  dom.kpiMonthlySpending.textContent = formatCurrency(totals.monthlySpending);
  if (budgetMetrics.limit > 0) {
    dom.kpiMonthlyMeta.textContent = `${budgetMetrics.utilizationPct.toFixed(1)}% of ${formatCurrency(budgetMetrics.limit)} (${monthLabel})`;
  } else {
    dom.kpiMonthlyMeta.textContent = `${totals.monthlyExpenseCount} entries in ${monthLabel}`;
  }

  // Budget Warning / Exceeded Alert Banner on Dashboard
  if (budgetMetrics.status === 'warning' || budgetMetrics.status === 'exceeded') {
    const banner = buildBudgetBannerData(budgetMetrics, monthLabel);
    dom.budgetAlert.className = `alert-banner ${banner.variant}`;
    dom.budgetAlert.innerHTML = `
      <div class="alert-banner-content">
        <i data-lucide="${banner.icon}"></i>
        <div>
          <span class="alert-banner-title">${escapeHTML(banner.title)}</span>
          <p class="alert-banner-desc">${escapeHTML(banner.description)}</p>
        </div>
      </div>
      <button type="button" class="text-link-btn" data-nav-link="budget">Manage Budget</button>
    `;
    dom.budgetAlert.classList.remove('hidden');
  } else {
    dom.budgetAlert.classList.add('hidden');
  }

  renderSpendingChart(transactions, activeMonth);
  renderCategoryChart(transactions, activeMonth);
  renderRecentTransactions(transactions);

  callbacks.refreshIcons();
}

export function initDashboard(appCallbacks) {
  callbacks = { ...callbacks, ...appCallbacks };
  cacheDom();

  dom.rangeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      spendingRangeMode = btn.dataset.dashboardRange === 'daily' ? 'daily' : 'monthly';
      dom.rangeButtons.forEach((b) => b.classList.toggle('active', b === btn));
      renderSpendingChart(lastRenderArgs.transactions, lastRenderArgs.activeMonth);
    });
  });

  // Recent Transactions row actions
  dom.recentTbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const txId = btn.dataset.txId;
    if (btn.dataset.action === 'edit-tx') openEditTransactionModal(txId);
    if (btn.dataset.action === 'delete-tx') openDeleteTransactionModal(txId);
  });

  // Empty state add button
  const emptyAddBtn = dom.recentEmpty.querySelector('[data-action="open-add"]');
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener('click', () => openAddTransactionModal('expense'));
  }
}
