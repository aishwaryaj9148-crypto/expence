/**
 * analytics.js
 * Pure analytics computation and dynamic Chart.js rendering for:
 * - Total Savings & Savings Rate
 * - Highest Spending Category
 * - Average Monthly Expense & Expense-to-Income Ratio
 * - Monthly Income vs. Expenses (Grouped Bar Chart)
 * - Category-wise Expense Breakdown (Horizontal Bar Chart)
 * - Spending Distribution (Doughnut Chart + Ledger Table)
 */

import { CHART_PALETTE } from './dashboard.js';
import { escapeHTML, formatCurrency } from './transactions.js';

let incomeExpenseChart = null;
let categoryBarChart = null;
let distributionChart = null;

const dom = {};

function cacheDom() {
  dom.totalSavings = document.getElementById('analytics-total-savings');
  dom.savingsRate = document.getElementById('analytics-savings-rate');
  dom.topCategory = document.getElementById('analytics-top-category');
  dom.topCategoryMeta = document.getElementById('analytics-top-category-meta');
  dom.avgMonthly = document.getElementById('analytics-avg-monthly');
  dom.avgMonthlyMeta = document.getElementById('analytics-avg-monthly-meta');
  dom.ratio = document.getElementById('analytics-ratio');
  dom.ratioMeta = document.getElementById('analytics-ratio-meta');

  dom.ieCanvas = document.getElementById('analytics-income-expense-chart');
  dom.ieEmpty = document.getElementById('analytics-ie-empty');

  dom.catBarCanvas = document.getElementById('analytics-category-bar-chart');
  dom.catEmpty = document.getElementById('analytics-cat-empty');

  dom.distCanvas = document.getElementById('analytics-distribution-chart');
  dom.distEmpty = document.getElementById('analytics-dist-empty');

  dom.categoryTbody = document.getElementById('analytics-category-tbody');
}

/**
 * Pure computation of all analytics series and KPI metrics.
 */
export function computeAnalyticsData(transactions) {
  let totalIncome = 0;
  let totalExpenses = 0;
  const monthlyMap = new Map(); // YYYY-MM -> { income, expense }
  const categoryMap = new Map(); // category -> { total, count }

  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0;
    const ym = tx.date ? tx.date.slice(0, 7) : 'Unknown';

    if (!monthlyMap.has(ym)) {
      monthlyMap.set(ym, { income: 0, expense: 0 });
    }
    const monthEntry = monthlyMap.get(ym);

    if (tx.type === 'income') {
      totalIncome += amount;
      monthEntry.income += amount;
    } else {
      totalExpenses += amount;
      monthEntry.expense += amount;

      const catEntry = categoryMap.get(tx.category) || { total: 0, count: 0 };
      catEntry.total += amount;
      catEntry.count += 1;
      categoryMap.set(tx.category, catEntry);
    }
  }

  const totalSavings = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? (totalSavings / totalIncome) * 100 : 0;
  const expenseToIncomeRatio = totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : 0;

  const monthlySeries = Array.from(monthlyMap.entries())
    .filter(([key]) => /^\d{4}-\d{2}$/.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([key, vals]) => {
      const [y, m] = key.split('-').map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
      });
      return { key, label, income: vals.income, expense: vals.expense };
    });

  const activeExpenseMonths = Array.from(monthlyMap.values()).filter(
    (m) => m.expense > 0
  ).length;
  const avgMonthlyExpense =
    activeExpenseMonths > 0 ? totalExpenses / activeExpenseMonths : 0;

  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([category, info]) => ({
      category,
      total: info.total,
      count: info.count,
      share: totalExpenses > 0 ? (info.total / totalExpenses) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const highestCategory = categoryBreakdown.length > 0 ? categoryBreakdown[0] : null;

  return {
    totalIncome,
    totalExpenses,
    totalSavings,
    savingsRate,
    expenseToIncomeRatio,
    avgMonthlyExpense,
    activeExpenseMonths,
    highestCategory,
    categoryBreakdown,
    monthlySeries,
  };
}

function renderIncomeVsExpenseChart(monthlySeries) {
  if (monthlySeries.length === 0 || typeof window.Chart === 'undefined') {
    if (incomeExpenseChart) {
      incomeExpenseChart.destroy();
      incomeExpenseChart = null;
    }
    dom.ieEmpty.classList.remove('hidden');
    return;
  }

  dom.ieEmpty.classList.add('hidden');
  const ctx = dom.ieCanvas.getContext('2d');
  if (incomeExpenseChart) {
    incomeExpenseChart.destroy();
  }

  incomeExpenseChart = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: monthlySeries.map((m) => m.label),
      datasets: [
        {
          label: 'Income',
          data: monthlySeries.map((m) => m.income),
          backgroundColor: '#0D9488',
          borderRadius: 4,
          maxBarThickness: 24,
        },
        {
          label: 'Expenses',
          data: monthlySeries.map((m) => m.expense),
          backgroundColor: '#0F172A',
          borderRadius: 4,
          maxBarThickness: 24,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: false,
            color: '#475569',
            font: { size: 12, family: 'Plus Jakarta Sans' },
          },
        },
        tooltip: {
          backgroundColor: '#0F172A',
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            label: (ctxItem) => `${ctxItem.dataset.label}: ${formatCurrency(ctxItem.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#64748B', font: { size: 11, family: 'IBM Plex Mono' } },
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

function renderCategoryBarChart(categoryBreakdown) {
  if (categoryBreakdown.length === 0 || typeof window.Chart === 'undefined') {
    if (categoryBarChart) {
      categoryBarChart.destroy();
      categoryBarChart = null;
    }
    dom.catEmpty.classList.remove('hidden');
    return;
  }

  dom.catEmpty.classList.add('hidden');
  const ctx = dom.catBarCanvas.getContext('2d');
  if (categoryBarChart) {
    categoryBarChart.destroy();
  }

  categoryBarChart = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: categoryBreakdown.map((c) => c.category),
      datasets: [
        {
          label: 'Total Spent',
          data: categoryBreakdown.map((c) => c.total),
          backgroundColor: categoryBreakdown.map(
            (_, idx) => CHART_PALETTE[idx % CHART_PALETTE.length]
          ),
          borderRadius: 4,
          maxBarThickness: 22,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0F172A',
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            label: (ctxItem) => `Spent: ${formatCurrency(ctxItem.parsed.x)}`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: '#F1F5F9' },
          ticks: {
            color: '#64748B',
            font: { size: 11, family: 'IBM Plex Mono' },
            callback: (val) => `$${Number(val).toLocaleString()}`,
          },
        },
        y: {
          grid: { display: false },
          ticks: {
            color: '#0F172A',
            font: { size: 12, weight: '500', family: 'Plus Jakarta Sans' },
          },
        },
      },
    },
  });
}

function renderDistributionChart(categoryBreakdown) {
  if (categoryBreakdown.length === 0 || typeof window.Chart === 'undefined') {
    if (distributionChart) {
      distributionChart.destroy();
      distributionChart = null;
    }
    dom.distEmpty.classList.remove('hidden');
    return;
  }

  dom.distEmpty.classList.add('hidden');
  const ctx = dom.distCanvas.getContext('2d');
  if (distributionChart) {
    distributionChart.destroy();
  }

  distributionChart = new window.Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: categoryBreakdown.map((c) => c.category),
      datasets: [
        {
          data: categoryBreakdown.map((c) => c.total),
          backgroundColor: categoryBreakdown.map(
            (_, idx) => CHART_PALETTE[idx % CHART_PALETTE.length]
          ),
          borderColor: '#FFFFFF',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            color: '#475569',
            font: { size: 11.5, family: 'Plus Jakarta Sans' },
          },
        },
        tooltip: {
          backgroundColor: '#0F172A',
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            label: (ctxItem) => `${ctxItem.label}: ${formatCurrency(ctxItem.parsed)}`,
          },
        },
      },
    },
  });
}

function renderCategoryLedgerTable(categoryBreakdown) {
  if (categoryBreakdown.length === 0) {
    dom.categoryTbody.innerHTML = `
      <tr>
        <td colspan="4" class="card-subtitle">No expense transactions recorded yet.</td>
      </tr>
    `;
    return;
  }

  dom.categoryTbody.innerHTML = categoryBreakdown
    .map(
      (item) => `
      <tr>
        <td class="tx-title">${escapeHTML(item.category)}</td>
        <td class="text-right tabular-nums">${item.count}</td>
        <td class="text-right tx-amount tabular-nums">${escapeHTML(formatCurrency(item.total))}</td>
        <td class="text-right tabular-nums">${item.share.toFixed(1)}%</td>
      </tr>
    `
    )
    .join('');
}

export function renderAnalytics(transactions) {
  const data = computeAnalyticsData(transactions);

  // KPI 1: Total Savings
  dom.totalSavings.textContent = formatCurrency(data.totalSavings);
  dom.totalSavings.className = 'kpi-value tabular-nums';
  if (data.totalSavings > 0) dom.totalSavings.classList.add('is-positive');
  if (data.totalSavings < 0) dom.totalSavings.classList.add('is-negative');
  dom.savingsRate.textContent =
    data.totalIncome > 0
      ? `${data.savingsRate.toFixed(1)}% of total income saved`
      : 'Add income to compute savings rate';

  // KPI 2: Highest Spending Category
  if (data.highestCategory) {
    dom.topCategory.textContent = data.highestCategory.category;
    dom.topCategoryMeta.textContent = `${formatCurrency(data.highestCategory.total)} · ${data.highestCategory.share.toFixed(1)}% of expenses`;
  } else {
    dom.topCategory.textContent = '—';
    dom.topCategoryMeta.textContent = 'No expenses recorded';
  }

  // KPI 3: Average Monthly Expense
  dom.avgMonthly.textContent = formatCurrency(data.avgMonthlyExpense);
  dom.avgMonthlyMeta.textContent =
    data.activeExpenseMonths > 0
      ? `Across ${data.activeExpenseMonths} active ${data.activeExpenseMonths === 1 ? 'month' : 'months'}`
      : 'No active expense months';

  // KPI 4: Expense-to-Income Ratio
  dom.ratio.textContent = `${data.expenseToIncomeRatio.toFixed(1)}%`;
  dom.ratioMeta.textContent =
    data.totalIncome > 0
      ? `${formatCurrency(data.totalExpenses)} spent of ${formatCurrency(data.totalIncome)}`
      : 'No income recorded yet';

  renderIncomeVsExpenseChart(data.monthlySeries);
  renderCategoryBarChart(data.categoryBreakdown);
  renderDistributionChart(data.categoryBreakdown);
  renderCategoryLedgerTable(data.categoryBreakdown);
}

export function initAnalytics() {
  cacheDom();
}
