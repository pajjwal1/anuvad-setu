// Indian-style formatting of translated output: lakh/crore digit grouping, the rupee sign and DD/MM/YYYY dates.
//
// Deliberately conservative. Bare digit strings (phone numbers, Aadhaar, PIN codes, years) are NEVER
// regrouped; only things that are unambiguous are rewritten:
//   - numbers already written with western commas      1,000,000   -> 10,00,000
//   - amounts directly after Rs / Rs. / INR / ₹        Rs. 1500000 -> ₹15,00,000
//   - ISO dates                                        2024-03-25  -> 25/03/2024
//   - numeric dates that can only be month/day/year    03/25/2024  -> 25/03/2024
//   - English month-name dates                         March 25, 2024 / 25 March 2024 -> 25/03/2024

/** Group an integer string the Indian way: last three digits, then pairs. */
export function groupIndian(digits) {
  const d = digits.replace(/^0+(?=\d)/, '');
  if (d.length <= 3) return d;
  const head = d.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${d.slice(-3)}`;
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const pad = (n) => String(n).padStart(2, '0');
const validDay = (d, m) => d >= 1 && d <= 31 && m >= 1 && m <= 12;

export function formatIndian(text, lang) {
  if (!text) return text;
  let out = text;

  // Rupee amounts: normalise the symbol, and group a bare number that directly follows it.
  out = out.replace(/(?:\bRs\.?|\bINR|₹)\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi, (_, num) => {
    const [int, frac] = num.split('.');
    return `₹${groupIndian(int.replace(/,/g, ''))}${frac ? `.${frac}` : ''}`;
  });

  // Western-grouped numbers (1,234,567 / 1,234.50) -> Indian grouping.
  out = out.replace(/(?<![\d,.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])/g, (m) => {
    const [int, frac] = m.split('.');
    return `${groupIndian(int.replace(/,/g, ''))}${frac ? `.${frac}` : ''}`;
  });

  // Dates -> DD/MM/YYYY
  out = out.replace(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (m, y, mo, d) =>
    validDay(+d, +mo) ? `${d}/${mo}/${y}` : m,
  );
  // 03/25/2024 is month/day only when the second part cannot be a month.
  out = out.replace(/(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4})(?![\d/])/g, (m, a, b, y) =>
    +a <= 12 && +b > 12 && validDay(+b, +a) ? `${pad(+b)}/${pad(+a)}/${y}` : m,
  );
  if (lang === 'en') {
    const named = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi');
    out = out.replace(named, (m, mon, d, y) => (validDay(+d, MONTHS[mon.toLowerCase()]) ? `${pad(+d)}/${pad(MONTHS[mon.toLowerCase()])}/${y}` : m));
    const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\.?,?\\s+(\\d{4})\\b`, 'gi');
    out = out.replace(dayFirst, (m, d, mon, y) => (validDay(+d, MONTHS[mon.toLowerCase()]) ? `${pad(+d)}/${pad(MONTHS[mon.toLowerCase()])}/${y}` : m));
  }
  return out;
}

/** "10,00,000" -> "10 lakh", "2,50,00,000" -> "2.5 crore". Only for amounts of one lakh and above. */
export function inLakhCrore(n) {
  if (!Number.isFinite(n) || n < 1e5) return null;
  const trim = (v) => String(Math.round(v * 100) / 100);
  if (n >= 1e7) return `${trim(n / 1e7)} crore`;
  return `${trim(n / 1e5)} lakh`;
}

/** Amounts of a lakh or more found in the text, with their lakh/crore reading. For English output hints. */
export function amountHints(text) {
  const hints = [];
  const seen = new Set();
  for (const m of text.matchAll(/(?<![\d,.])(₹?)(\d{1,3}(?:,\d{2})*,\d{3}|\d{6,})(?![\d,])/g)) {
    const raw = m[2];
    const n = Number(raw.replace(/,/g, ''));
    const words = inLakhCrore(n);
    // A bare 6+ digit string without a rupee sign could be a PIN code or phone number; skip those.
    if (!words || seen.has(raw) || (!m[1] && !raw.includes(','))) continue;
    seen.add(raw);
    hints.push({ raw: `${m[1]}${raw}`, words });
  }
  return hints;
}
