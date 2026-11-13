/**
 * budget.js
 * Monthly budget calculation, 80% warning / exceeded alert logic,
 * and Budget Management view controller.
 */

import { saveBudget } from './storage.js';
import { escapeHTML, formatCurrency, formatMonthLabel } from './transactions.js';

/**
 * Pure calculation of budget utilization and category breakdown for a given month.
 */
export function calculateBudgetMetrics(transactions, monthKey, budgetLimit) {
  const limit = Number(budgetLimit) || 0;
  const monthExpenses = transactions.filter(
    (tx) => tx.type === 'expense' && (!monthKey || tx.date.startsWith(monthKey))
  );

  const spent = monthExpenses.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  const remaining = limit - spent;
  const utilizationPct = limit > 0 ? (spent / limit) * 100 : 0;
  const exceededBy = spent > limit ? spent - limit : 0;

  let status = 'none';
  if (limit > 0) {
    if (spent > limit) {
      status = 'exceeded';
    } else if (utilizationPct >= 80) {
      status = 'warning';
    } else {
      status = 'nominal';
    }
  }

  // Category breakdown for the selected month
  const catMap = new Map();
  for (const tx of monthExpenses) {
    const prev = catMap.get(tx.category) || 0;
    catMap.set(tx.category, prev + (Number(tx.amount) || 0));
  }

  const categoryAllocations = Array.from(catMap.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      shareOfBudget: limit > 0 ? (amount / limit) * 100 : 0,
      shareOfSpent: spent > 0 ? (amount / spent) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    monthKey,
    limit,
    spent,
    remaining,
    utilizationPct,
    exceededBy,
    status,
    categoryAllocations,
  };
}

/**
 * Generates accessible HTML for the budget status banner.
 */
export function buildBudgetBannerData(metrics, monthLabel) {
  if (metrics.status === 'exceeded') {
    return {
      variant: 'danger',
      icon: 'alert-octagon',
      title: `Budget Exceeded for ${monthLabel}`,
      description: `Monthly spending (${formatCurrency(metrics.spent)}) has exceeded your ${formatCurrency(metrics.limit)} budget by ${formatCurrency(metrics.exceededBy)} (${metrics.utilizationPct.toFixed(1)}% used).`,
    };
  }
  if (metrics.status === 'warning') {
    return {
      variant: 'warning',
      icon: 'alert-triangle',
      title: `Budget Warning (${metrics.utilizationPct.toFixed(1)}% Used)`,
      description: `You have spent ${formatCurrency(metrics.spent)} of your ${formatCurrency(metrics.limit)} budget for ${monthLabel}. Only ${formatCurrency(metrics.remaining)} remaining.`,
    };
  }
  return {
    variant: 'nominal',
    icon: 'check-circle-2',
    title: `On Track for ${monthLabel}`,
    description: `You have used ${metrics.utilizationPct.toFixed(1)}% of your ${formatCurrency(metrics.limit)} monthly budget with ${formatCurrency(metrics.remaining)} remaining.`,
  };
}

let callbacks = {
  onBudgetChanged: () => {},
  notify: () => {},
  refreshIcons: () => {},
};

let currentMonthKey = '';
let currentTransactions = [];
let currentLimit = 2500;

const dom = {};

function cacheDom() {
  dom.banner = document.getElementById('budget-status-banner');
  dom.form = document.getElementById('budget-form');
  dom.formSubtitle = document.getElementById('budget-form-subtitle');
  dom.limitInput = document.getElementById('budget-limit-input');
  dom.limitError = document.getElementById('budget-limit-error');
  dom.applyDefaultCheckbox = document.getElementById('budget-apply-default');
  dom.presetButtons = document.querySelectorAll('[data-budget-preset]');

  dom.monthLabel = document.getElementById('budget-month-label');
  dom.utilizationText = document.getElementById('budget-utilization-text');
  dom.progressBar = document.getElementById('budget-progress-bar');
  dom.progressFill = document.getElementById('budget-progress-fill');

  dom.metricLimit = document.getElementById('budget-metric-limit');
  dom.metricSpent = document.getElementById('budget-metric-spent');
  dom.metricRemainingLabel = document.getElementById('budget-metric-remaining-label');
  dom.metricRemaining = document.getElementById('budget-metric-remaining');

  dom.categoryList = document.getElementById('budget-category-list');
}

function clearBudgetError() {
  dom.limitInput.removeAttribute('aria-invalid');
  dom.limitError.textContent = '';
  dom.limitError.classList.add('hidden');
}

function handleBudgetSubmit(event) {
  event.preventDefault();
  clearBudgetError();

  const val = Number(dom.limitInput.value);
  if (!Number.isFinite(val) || val <= 0) {
    dom.limitInput.setAttribute('aria-invalid', 'true');
    dom.limitError.textContent = 'Please enter a valid monthly budget greater than $0.';
    dom.limitError.classList.remove('hidden');
    return;
  }

  const rounded = Math.round(val * 100) / 100;
  const setAsDefault = dom.applyDefaultCheckbox.checked;
  saveBudget(currentMonthKey, rounded, setAsDefault);

  callbacks.onBudgetChanged(rounded);
  callbacks.notify(`Monthly budget updated to ${formatCurrency(rounded)}`);
}

export function renderBudget(transactions, monthKey, budgetLimit) {
  currentTransactions = transactions;
  currentMonthKey = monthKey;
  currentLimit = budgetLimit;

  const monthLabel = formatMonthLabel(monthKey);
  const metrics = calculateBudgetMetrics(transactions, monthKey, budgetLimit);

  dom.formSubtitle.textContent = `Set spending threshold for ${monthLabel}`;
  dom.monthLabel.textContent = `Tracking expenses for ${monthLabel}`;

  if (document.activeElement !== dom.limitInput) {
    dom.limitInput.value = metrics.limit > 0 ? metrics.limit.toFixed(2) : '';
  }

  // Banner (Always shown in Budget view with semantic status)
  if (metrics.status !== 'none') {
    const banner = buildBudgetBannerData(metrics, monthLabel);
    dom.banner.className = `alert-banner ${banner.variant}`;
    dom.banner.innerHTML = `
      <div class="alert-banner-content">
        <i data-lucide="${banner.icon}"></i>
        <div>
          <span class="alert-banner-title">${escapeHTML(banner.title)}</span>
          <p class="alert-banner-desc">${escapeHTML(banner.description)}</p>
        </div>
      </div>
    `;
    dom.banner.classList.remove('hidden');
  } else {
    dom.banner.classList.add('hidden');
  }

  // Progress Bar & Utilization
  const clampedWidth = Math.min(100, Math.max(0, metrics.utilizationPct));
  dom.utilizationText.textContent = `${metrics.utilizationPct.toFixed(1)}%`;
  dom.progressFill.style.width = `${clampedWidth.toFixed(1)}%`;
  dom.progressFill.className = 'progress-fill';
  if (metrics.status === 'exceeded') {
    dom.progressFill.classList.add('danger');
  } else if (metrics.status === 'warning') {
    dom.progressFill.classList.add('warning');
  }
  dom.progressBar.setAttribute('aria-valuenow', String(Math.round(metrics.utilizationPct)));

  // Metrics Row
  dom.metricLimit.textContent = formatCurrency(metrics.limit);
  dom.metricSpent.textContent = formatCurrency(metrics.spent);

  if (metrics.remaining < 0) {
    dom.metricRemainingLabel.textContent = 'Over Budget By';
    dom.metricRemaining.textContent = formatCurrency(Math.abs(metrics.remaining));
    dom.metricRemaining.className = 'budget-metric-value tabular-nums is-negative';
  } else {
    dom.metricRemainingLabel.textContent = 'Remaining Budget';
    dom.metricRemaining.textContent = formatCurrency(metrics.remaining);
    dom.metricRemaining.className = 'budget-metric-value tabular-nums is-positive';
  }

  // Category Allocation Breakdown
  if (metrics.categoryAllocations.length === 0) {
    dom.categoryList.innerHTML = `
      <p class="card-subtitle">No expenses recorded in ${escapeHTML(monthLabel)} yet.</p>
    `;
  } else {
    dom.categoryList.innerHTML = metrics.categoryAllocations
      .map((item) => {
        const barPct = Math.min(100, item.shareOfBudget);
        return `
          <div class="budget-cat-row">
            <div class="budget-cat-header">
              <span class="budget-cat-name">${escapeHTML(item.category)}</span>
              <span class="budget-cat-meta tabular-nums">
                ${escapeHTML(formatCurrency(item.amount))} · ${item.shareOfBudget.toFixed(1)}% of budget
              </span>
            </div>
            <div class="budget-cat-bar-track">
              <div class="budget-cat-bar-fill" style="width: ${barPct.toFixed(1)}%"></div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  callbacks.refreshIcons();
}

export function initBudget(appCallbacks) {
  callbacks = { ...callbacks, ...appCallbacks };
  cacheDom();

  dom.form.addEventListener('submit', handleBudgetSubmit);
  dom.limitInput.addEventListener('input', clearBudgetError);

  dom.presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = Number(btn.dataset.budgetPreset);
      if (preset > 0) {
        dom.limitInput.value = preset.toFixed(2);
        clearBudgetError();
      }
    });
  });
}
