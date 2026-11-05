// Input normalization for the emissaoja node. Every function returns either the normalized value or an
// `{ error }` with an English explanation, so the node can fail the item before calling the API.

export const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Suggested reference expression: always 8+ characters, unique per execution and item. */
export const REFERENCE_EXPRESSION = 'nfse-{{ $execution.id }}-{{ $itemIndex }}';

export type Result<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

/** Reference (Idempotency-Key): 8 to 64 characters, letters, numbers, `_` and `-`. */
export function parseReference(input: unknown): Result<string> {
	const value = input === undefined || input === null ? '' : String(input).trim();
	if (REFERENCE_PATTERN.test(value)) return { value };
	if (value === '') return { error: 'the reference is empty' };
	const shown = value.length > 70 ? `${value.slice(0, 70)}...` : value;
	return { error: `got "${shown}" (${value.length} characters)` };
}

const PLAIN_DECIMAL = /^\d+(?:[.,]\d{1,2})?$/;
// Thousand separators are only accepted when the reading is unambiguous: with decimals (1.500,50) or with
// two or more groups (1.500.000). A lone group such as 1.500 or 1,500 could be 1500 or 1.5.
const BR_THOUSANDS = /^\d{1,3}(?:\.\d{3})+,\d{1,2}$|^\d{1,3}(?:\.\d{3}){2,}$/;
const EN_THOUSANDS = /^\d{1,3}(?:,\d{3})+\.\d{1,2}$|^\d{1,3}(?:,\d{3}){2,}$/;

/**
 * Amount in reais, with up to 2 decimal places. Accepts a number or a string such as `1500`, `1500.5`,
 * `1500,50`, `1.500,50`, `1,500.50` or `R$ 1.500,50`. Ambiguous strings such as `1.500` are rejected
 * instead of guessed: a wrong guess would issue an invoice with the wrong amount.
 */
export function parseAmount(input: unknown): Result<number> {
	let amount: number;
	if (typeof input === 'number') {
		amount = input;
	} else if (typeof input === 'string') {
		// \s also covers the non-breaking space that spreadsheets put in "R$ 1.500,00".
		const text = input.replace(/^\s*R\$/i, '').replace(/\s/g, '');
		if (PLAIN_DECIMAL.test(text)) {
			amount = Number(text.replace(',', '.'));
		} else if (BR_THOUSANDS.test(text)) {
			amount = Number(text.replace(/\./g, '').replace(',', '.'));
		} else if (EN_THOUSANDS.test(text)) {
			amount = Number(text.replace(/,/g, ''));
		} else {
			return {
				error: `"${input}" is not an unambiguous amount in reais (write e.g. 1500, 1500.50 or 1.500,50)`,
			};
		}
	} else {
		return { error: 'the amount is empty' };
	}
	if (!Number.isFinite(amount) || amount <= 0) {
		return { error: `the amount must be greater than zero (got ${String(input)})` };
	}
	const cents = Math.round(amount * 100);
	if (Math.abs(cents - amount * 100) > 1e-6) {
		return { error: `the amount has more than 2 decimal places (got ${String(input)})` };
	}
	return { value: cents / 100 };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

function isRealDate(year: number, month: number, day: number): boolean {
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

/**
 * Date as `YYYY-MM-DD`. Accepts `YYYY-MM-DD`, an ISO date-time (the date part is kept, as picked in n8n's
 * date field), a Luxon DateTime (`$now`, `$today`) or a JavaScript Date. Empty means "not informed".
 * Formats such as `05/11/2026` are rejected: day/month order would have to be guessed.
 */
export function parseDate(input: unknown): Result<string | undefined> {
	if (input === undefined || input === null || input === '') return { value: undefined };
	let text: string | undefined;
	if (typeof input === 'string') {
		text = input.trim();
		if (text === '') return { value: undefined };
	} else if (input instanceof Date) {
		if (Number.isNaN(input.getTime())) return { error: 'invalid date' };
		text = input.toISOString();
	} else if (
		typeof input === 'object' &&
		typeof (input as { toISODate?: unknown }).toISODate === 'function'
	) {
		const iso = (input as { toISODate: () => string | null }).toISODate();
		text = iso ?? '';
	}
	const match = text === undefined ? null : ISO_DATE.exec(text);
	if (!match) {
		return { error: `"${String(text ?? input)}" is not a date in YYYY-MM-DD format` };
	}
	const [, y, m, d] = match;
	if (!isRealDate(Number(y), Number(m), Number(d))) {
		return { error: `"${y}-${m}-${d}" is not a valid date` };
	}
	return { value: `${y}-${m}-${d}` };
}

/**
 * CNPJ for the lookup: removes punctuation (dots, slash, dash, spaces) and uppercases letters. A number (e.g.
 * a spreadsheet column that lost its leading zeros) is left-padded with zeros to 14 digits.
 */
export function normalizeCnpj(input: unknown): string {
	if (input === undefined || input === null) return '';
	if (typeof input === 'number' && Number.isInteger(input) && input >= 0) {
		return String(input).padStart(14, '0');
	}
	return String(input)
		.replace(/[^0-9A-Za-z]/g, '')
		.toUpperCase();
}

/** CPF or CNPJ of a customer as typed (the API accepts punctuation); numbers become text. */
export function normalizeDocument(input: unknown): string {
	if (input === undefined || input === null) return '';
	return String(input).trim();
}

/** Safe file name part: letters, numbers, `_` and `-` only. */
export function fileNamePart(input: unknown): string {
	return String(input ?? '')
		.trim()
		.replace(/[^A-Za-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

/** Text parameter: trimmed string, or `undefined` when empty. */
export function optionalText(input: unknown): string | undefined {
	if (input === undefined || input === null) return undefined;
	const text = String(input).trim();
	return text === '' ? undefined : text;
}
