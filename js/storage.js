/**
 * storage.js
 * Centralized Data Access Layer (Repository Pattern).
 *
 * All LocalStorage reads and writes live strictly inside this module.
 * UI and calculation modules interact only with these functions, allowing
 * a clean swap to REST API calls (Node.js / Express / SQL) in the future
 * without modifying UI logic.
 */

const STORAGE_KEYS = {
  TRANSACTIONS: 'clearledger_transactions_v1',
  BUDGET: 'clearledger_budget_v1',
  INITIALIZED: 'clearledger_initialized_v1',
};

export const EXPENSE_CATEGORIES = [
  'Food',
  'Housing',
  'Transport',
  'Utilities',
  'Healthcare',
  'Shopping',
  'Entertainment',
  'Education',
  'Other',
];

export const INCOME_CATEGORIES = [
  'Salary',
  'Freelance',
  'Investments',
  'Gifts',
  'Refunds',
  'Other',
];

export const ALL_CATEGORIES = Array.from(
  new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])
);

/**
 * Generates a unique identifier for transactions.
 * Uses crypto.randomUUID when available with a timestamp-random fallback.
 */
export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Normalizes and validates a raw transaction record into the canonical schema.
 */
function normalizeTransaction(record) {
  return {
    id: String(record.id || generateId()),
    title: String(record.title || '').trim(),
    amount: Number(record.amount) || 0,
    category: String(record.category || 'Other').trim(),
    type: record.type === 'income' ? 'income' : 'expense',
    date: String(record.date || ''),
    description: String(record.description || '').trim(),
  };
}

/**
 * Retrieves all transactions from LocalStorage.
 * @returns {Array<Object>}
 */
export function getTransactions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTransaction);
  } catch (err) {
    console.error('Failed to read transactions from LocalStorage:', err);
    return [];
  }
}

/**
 * Persists the complete transactions array to LocalStorage.
 * @param {Array<Object>} transactions
 * @returns {Array<Object>}
 */
export function saveTransactions(transactions) {
  const normalized = Array.isArray(transactions)
    ? transactions.map(normalizeTransaction)
    : [];
  try {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(normalized));
  } catch (err) {
    console.error('Failed to save transactions to LocalStorage:', err);
  }
  return normalized;
}

/**
 * Creates and persists a new transaction.
 * @param {Object} payload
 * @returns {{ transaction: Object, transactions: Array<Object> }}
 */
export function addTransaction(payload) {
  const transactions = getTransactions();
  const newTx = normalizeTransaction({
    ...payload,
    id: generateId(),
  });
  transactions.unshift(newTx);
  const updated = saveTransactions(transactions);
  return { transaction: newTx, transactions: updated };
}

/**
 * Updates an existing transaction by ID.
 * @param {string} id
 * @param {Object} updates
 * @returns {{ transaction: Object|null, transactions: Array<Object> }}
 */
export function updateTransaction(id, updates) {
  const transactions = getTransactions();
  let updatedTx = null;
  const nextList = transactions.map((tx) => {
    if (tx.id === id) {
      updatedTx = normalizeTransaction({ ...tx, ...updates, id });
      return updatedTx;
    }
    return tx;
  });
  const saved = saveTransactions(nextList);
  return { transaction: updatedTx, transactions: saved };
}

/**
 * Deletes a transaction by ID.
 * @param {string} id
 * @returns {Array<Object>}
 */
export function deleteTransaction(id) {
  const transactions = getTransactions();
  const filtered = transactions.filter((tx) => tx.id !== id);
  return saveTransactions(filtered);
}

/**
 * Retrieves budget configuration from LocalStorage.
 * Structure: { defaultLimit: number, monthlyOverrides: { "YYYY-MM": number } }
 */
export function getBudgetConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BUDGET);
    if (!raw) {
      return { defaultLimit: 2500, monthlyOverrides: {} };
    }
    const parsed = JSON.parse(raw);
    return {
      defaultLimit: Number(parsed.defaultLimit) > 0 ? Number(parsed.defaultLimit) : 2500,
      monthlyOverrides:
        parsed.monthlyOverrides && typeof parsed.monthlyOverrides === 'object'
          ? parsed.monthlyOverrides
          : {},
    };
  } catch (err) {
    console.error('Failed to read budget config from LocalStorage:', err);
    return { defaultLimit: 2500, monthlyOverrides: {} };
  }
}

/**
 * Gets the effective monthly budget limit for a given YYYY-MM month key.
 * @param {string} monthKey
 * @returns {number}
 */
export function getBudgetForMonth(monthKey) {
  const config = getBudgetConfig();
  if (monthKey && Object.prototype.hasOwnProperty.call(config.monthlyOverrides, monthKey)) {
    const override = Number(config.monthlyOverrides[monthKey]);
    if (override > 0) return override;
  }
  return config.defaultLimit;
}

/**
 * Saves the monthly budget limit.
 * @param {string} monthKey - e.g. "2026-11"
 * @param {number} limit
 * @param {boolean} setAsDefault
 * @returns {Object}
 */
export function saveBudget(monthKey, limit, setAsDefault = true) {
  const numericLimit = Number(limit);
  if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
    throw new Error('Budget limit must be a positive number.');
  }
  const config = getBudgetConfig();
  if (setAsDefault) {
    config.defaultLimit = numericLimit;
    if (monthKey && config.monthlyOverrides[monthKey]) {
      delete config.monthlyOverrides[monthKey];
    }
  } else if (monthKey) {
    config.monthlyOverrides[monthKey] = numericLimit;
  }

  try {
    localStorage.setItem(STORAGE_KEYS.BUDGET, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to save budget config to LocalStorage:', err);
  }
  return config;
}

/**
 * Builds realistic initial sample transactions relative to the provided reference date
 * so first-time visitors see meaningful charts, analytics, and budget tracking.
 */
function buildSampleTransactions(referenceDate) {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  const year = ref.getFullYear();
  const month = ref.getMonth(); // 0-indexed

  const ym = (offsetMonths) => {
    const d = new Date(year, month + offsetMonths, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  };

  const clampDay = (offsetMonths, day) => {
    const prefix = ym(offsetMonths);
    const [yStr, mStr] = prefix.split('-');
    const maxDay = new Date(Number(yStr), Number(mStr), 0).getDate();
    const safeDay = String(Math.min(day, maxDay)).padStart(2, '0');
    return `${prefix}-${safeDay}`;
  };

  return [
    {
      id: generateId(),
      title: 'Grocery Shopping',
      amount: 185.4,
      category: 'Food',
      type: 'expense',
      date: clampDay(0, 13),
      description: 'Weekly groceries and fresh produce',
    },
    {
      id: generateId(),
      title: 'Monthly Salary',
      amount: 4600,
      category: 'Salary',
      type: 'income',
      date: clampDay(0, 1),
      description: 'Primary payroll direct deposit',
    },
    {
      id: generateId(),
      title: 'Apartment Rent',
      amount: 1150,
      category: 'Housing',
      type: 'expense',
      date: clampDay(0, 2),
      description: 'Monthly apartment lease',
    },
    {
      id: generateId(),
      title: 'Electric & Fiber Internet',
      amount: 142.8,
      category: 'Utilities',
      type: 'expense',
      date: clampDay(0, 5),
      description: 'Monthly power and internet billing',
    },
    {
      id: generateId(),
      title: 'City Metro & Fuel',
      amount: 96.5,
      category: 'Transport',
      type: 'expense',
      date: clampDay(0, 8),
      description: 'Commuter pass and fuel refill',
    },
    {
      id: generateId(),
      title: 'UI Consulting Retainer',
      amount: 650,
      category: 'Freelance',
      type: 'income',
      date: clampDay(0, 9),
      description: 'Design system audit invoice',
    },
    {
      id: generateId(),
      title: 'Dental Checkup',
      amount: 125,
      category: 'Healthcare',
      type: 'expense',
      date: clampDay(0, 10),
      description: 'Routine preventive cleaning',
    },
    {
      id: generateId(),
      title: 'Coffee & Team Lunch',
      amount: 64.25,
      category: 'Food',
      type: 'expense',
      date: clampDay(0, 11),
      description: 'Client lunch and espresso',
    },
    {
      id: generateId(),
      title: 'Monthly Salary',
      amount: 4600,
      category: 'Salary',
      type: 'income',
      date: clampDay(-1, 1),
      description: 'Primary payroll direct deposit',
    },
    {
      id: generateId(),
      title: 'Apartment Rent',
      amount: 1150,
      category: 'Housing',
      type: 'expense',
      date: clampDay(-1, 2),
      description: 'Monthly apartment lease',
    },
    {
      id: generateId(),
      title: 'Whole Foods Market',
      amount: 342.6,
      category: 'Food',
      type: 'expense',
      date: clampDay(-1, 14),
      description: 'Monthly pantry and groceries',
    },
    {
      id: generateId(),
      title: 'Winter Jacket & Footwear',
      amount: 215,
      category: 'Shopping',
      type: 'expense',
      date: clampDay(-1, 19),
      description: 'Seasonal wardrobe essentials',
    },
    {
      id: generateId(),
      title: 'Streaming & Concert Tickets',
      amount: 118,
      category: 'Entertainment',
      type: 'expense',
      date: clampDay(-1, 24),
      description: 'Live acoustic show and subscriptions',
    },
    {
      id: generateId(),
      title: 'Monthly Salary',
      amount: 4500,
      category: 'Salary',
      type: 'income',
      date: clampDay(-2, 1),
      description: 'Primary payroll direct deposit',
    },
    {
      id: generateId(),
      title: 'Apartment Rent',
      amount: 1150,
      category: 'Housing',
      type: 'expense',
      date: clampDay(-2, 2),
      description: 'Monthly apartment lease',
    },
    {
      id: generateId(),
      title: 'Online Course Subscription',
      amount: 199,
      category: 'Education',
      type: 'expense',
      date: clampDay(-2, 12),
      description: 'Annual technical certification prep',
    },
    {
      id: generateId(),
      title: 'Groceries & Dining',
      amount: 390.4,
      category: 'Food',
      type: 'expense',
      date: clampDay(-2, 20),
      description: 'Supermarket and weekend dinner',
    },
    {
      id: generateId(),
      title: 'Index Fund Dividend',
      amount: 280,
      category: 'Investments',
      type: 'income',
      date: clampDay(-2, 27),
      description: 'Quarterly ETF distribution',
    },
    {
      id: generateId(),
      title: 'Monthly Salary',
      amount: 4500,
      category: 'Salary',
      type: 'income',
      date: clampDay(-3, 1),
      description: 'Primary payroll direct deposit',
    },
    {
      id: generateId(),
      title: 'Apartment Rent',
      amount: 1150,
      category: 'Housing',
      type: 'expense',
      date: clampDay(-3, 2),
      description: 'Monthly apartment lease',
    },
    {
      id: generateId(),
      title: 'Utilities & Water',
      amount: 138,
      category: 'Utilities',
      type: 'expense',
      date: clampDay(-3, 7),
      description: 'Monthly utility statement',
    },
    {
      id: generateId(),
      title: 'Grocery & Household',
      amount: 315,
      category: 'Food',
      type: 'expense',
      date: clampDay(-3, 16),
      description: 'Household supplies and food',
    },
    {
      id: generateId(),
      title: 'Monthly Salary',
      amount: 4500,
      category: 'Salary',
      type: 'income',
      date: clampDay(-4, 1),
      description: 'Primary payroll direct deposit',
    },
    {
      id: generateId(),
      title: 'Apartment Rent & Utilities',
      amount: 1295,
      category: 'Housing',
      type: 'expense',
      date: clampDay(-4, 3),
      description: 'Lease and shared utilities',
    },
    {
      id: generateId(),
      title: 'Train Travel',
      amount: 240,
      category: 'Transport',
      type: 'expense',
      date: clampDay(-4, 18),
      description: 'Intercity rail roundtrip',
    },
  ];
}

/**
 * Seeds sample transactions and budget on first visit only.
 */
export function seedDemoDataIfFirstVisit(referenceDate = new Date()) {
  try {
    const initialized = localStorage.getItem(STORAGE_KEYS.INITIALIZED);
    if (initialized === 'true') {
      return;
    }
    const samples = buildSampleTransactions(referenceDate);
    saveTransactions(samples);
    localStorage.setItem(
      STORAGE_KEYS.BUDGET,
      JSON.stringify({ defaultLimit: 2500, monthlyOverrides: {} })
    );
    localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
  } catch (err) {
    console.error('Failed to seed initial sample data:', err);
  }
}

/**
 * Resets LocalStorage back to clean sample data.
 */
export function resetDemoData(referenceDate = new Date()) {
  const samples = buildSampleTransactions(referenceDate);
  saveTransactions(samples);
  try {
    localStorage.setItem(
      STORAGE_KEYS.BUDGET,
      JSON.stringify({ defaultLimit: 2500, monthlyOverrides: {} })
    );
    localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
  } catch (err) {
    console.error('Failed to reset sample data:', err);
  }
  return samples;
}
