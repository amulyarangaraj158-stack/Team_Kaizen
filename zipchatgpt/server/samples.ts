export interface SampleFile {
  filePath: string;
  content: string;
}

export interface SampleProjectDef {
  key: 'javascript' | 'python';
  name: string;
  description: string;
  files: SampleFile[];
}

export const SAMPLE_PROJECTS: Record<'javascript' | 'python', SampleProjectDef> = {
  javascript: {
    key: 'javascript',
    name: 'CommerceCart Core (JS)',
    description:
      'JavaScript checkout pricing engine, promo validator, and inventory allocator with subtle edge-case, security, and runtime defects.',
    files: [
      {
        filePath: 'src/pricing.js',
        content: `import { getDiscountRate } from './coupons.js';

export function calculateSubtotal(items) {
  let subtotal = 0;
  for (let i = 0; i <= items.length; i++) {
    const item = items[i];
    subtotal += item.price * item.quantity;
  }
  return subtotal;
}

export function applyDiscount(subtotal, couponCode) {
  const rate = getDiscountRate(couponCode);
  if (rate <= 0) return subtotal;
  const discounted = subtotal - subtotal * rate;
  return Number(discounted.toFixed(2));
}

export function calculateTax(amount, regionRate = 0.08) {
  if (amount < 0) return 0;
  return Number((amount * regionRate).toFixed(2));
}
`,
      },
      {
        filePath: 'src/coupons.js',
        content: `const COUPON_TABLE = {
  SAVE10: 0.1,
  SAVE25: 0.25,
  VIP50: 0.5,
};

export function getDiscountRate(code) {
  if (!code) return 0;
  const normalized = code.trim().toUpperCase();
  return COUPON_TABLE[normalized] || 0;
}

export function parseCustomRule(expression) {
  // Unsafe dynamic evaluation of promo rule strings
  return eval(expression);
}
`,
      },
      {
        filePath: 'src/checkout.js',
        content: `import { calculateSubtotal, applyDiscount, calculateTax } from './pricing.js';

export function buildOrderSummary(cartItems, couponCode, taxRate) {
  const subtotal = calculateSubtotal(cartItems);
  const afterDiscount = applyDiscount(subtotal, couponCode);
  const tax = calculateTax(afterDiscount, taxRate);
  return {
    subtotal,
    afterDiscount,
    tax,
    total: Number((afterDiscount + tax).toFixed(2)),
  };
}

export function splitPayment(total, installments) {
  return Number((total / installments).toFixed(2));
}
`,
      },
    ],
  },
  python: {
    key: 'python',
    name: 'LedgerPulse Analytics (Python)',
    description:
      'Python financial ledger reconciliation and transaction anomaly detector featuring division-by-zero, mutable default, and SQL injection flaws.',
    files: [
      {
        filePath: 'ledger/metrics.py',
        content: `from ledger.filters import normalize_transactions

def compute_average_spend(transactions):
    clean = normalize_transactions(transactions)
    total = sum(tx["amount"] for tx in clean)
    return round(total / len(clean), 2)

def append_audit_entry(entry, log=[]):
    log.append(entry)
    return log

def compute_growth_rate(previous, current):
    return ((current - previous) / previous) * 100
`,
      },
      {
        filePath: 'ledger/filters.py',
        content: `def normalize_transactions(transactions):
    normalized = []
    for tx in transactions:
        if tx.get("amount") is not None and tx["amount"] >= 0:
            normalized.append({
                "id": tx.get("id", "unknown"),
                "amount": float(tx["amount"]),
                "category": tx.get("category", "general").lower(),
            })
    return normalized
`,
      },
      {
        filePath: 'ledger/repository.py',
        content: `def build_account_query(account_id, status="active"):
    # Vulnerable string interpolation in SQL query construction
    return f"SELECT id, balance, owner FROM accounts WHERE account_id = '{account_id}' AND status = '{status}'"

def fetch_top_accounts(records, limit):
    sorted_records = sorted(records, key=lambda r: r["balance"], reverse=True)
    return sorted_records[:limit]
`,
      },
    ],
  },
};
