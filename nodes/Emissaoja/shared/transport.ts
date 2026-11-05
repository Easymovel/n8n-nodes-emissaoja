import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const BASE_URL = 'https://emissaoja.com.br';
/** Keep in sync with "version" in package.json (sent in the User-Agent header). */
export const VERSION = '0.1.0';
export const USER_AGENT = `emissaoja-n8n/${VERSION}`;
export const CREDENTIAL_NAME = 'emissaojaApi';
export const PLANS_URL = 'https://emissaoja.com.br/#precos';

const TIMEOUT_MS = 30000;
const MAX_TEXT_ERROR = 200;

// ---------------------------------------------------------------- error details

/**
 * Structured data of the errors thrown by this node (API `code`, `message`, `bloqueios`, `request_id`...).
 * With "On Error > Continue", the failed item is output with these fields, so the workflow can branch on `code`.
 */
const errorDetails = new WeakMap<object, IDataObject>();

export function withDetails<T extends object>(error: T, details: IDataObject): T {
	errorDetails.set(error, details);
	return error;
}

export function getErrorDetails(error: unknown): IDataObject {
	if (error !== null && typeof error === 'object') return errorDetails.get(error) ?? {};
	return {};
}

/** What to do for the most common API codes (shown in the error description). */
const HINTS: Record<string, string> = {
	chave_invalida:
		"Check the API key in the 'emissaoja API' credential and its environment: ej_live_ keys only work in Production and ej_test_ keys only in Sandbox.",
	sem_empresa:
		'Connect the company (CNPJ and Emissor Nacional password) in the emissaoja app before using the API.',
	aceite_pendente:
		'Accept the terms in the emissaoja app (https://emissaoja.com.br/app) and try again.',
	acesso_restrito: 'This account does not have API access yet. Contact suporte@emissaoja.com.br.',
	limite_notas: `The monthly invoice limit of your plan was reached (refused invoices do not count). See the plans at ${PLANS_URL}.`,
	nota_bloqueada:
		'Resolve the items above (most are fixed in the emissaoja app) and run the node again with the same reference.',
	possivel_duplicada:
		'An identical invoice (same customer, amount and service date) was already issued today. If this is really a new invoice, set Options > Allow Repeat Of to the order ID in nota_igual_recente.pedido_id.',
	emissao_repetida_recente:
		'The same invoice was requested less than 2 minutes ago. If this is really a new invoice, turn on Options > Confirm Repeat.',
	incerta_pendente:
		'An invoice for this customer and amount is still being checked with the Emissor Nacional. Do not issue it again: follow it in the emissaoja app.',
	chave_idempotencia_invalida:
		'The reference must have 8 to 64 characters: letters, numbers, _ and -.',
	chave_idempotencia_conflito:
		'This reference was already used with different invoice data. Use a new reference for a different invoice.',
	fila_indisponivel:
		'Run the node again with the same reference: the API never issues twice for the same reference.',
	motor_indisponivel:
		'Temporary instability. Try again in a few minutes (for Issue, keep the same reference).',
	receita_indisponivel: 'Receita Federal did not respond. Try again in a few minutes.',
	cnpj_consulta_indisponivel:
		'The CNPJ lookup is unavailable right now. Try again in a few minutes.',
	rate_limited:
		'Too many calls: 60 per minute per key, 10 invoices per minute. Slow down, for example with Loop Over Items and a Wait node.',
	documento_invalido:
		'Check the digits of the CPF or CNPJ. If it comes from a spreadsheet, format the column as text so leading zeros are kept.',
	nome_obrigatorio: "For a CPF, fill 'Name' with the person's full name.",
	nome_incompleto: "For a CPF, fill 'Name' with first and last name.",
	cnpj_nao_encontrado:
		'Receita Federal does not know this CNPJ. Check the digits: very new companies can take a few days to show up.',
	cnpj_invalido: 'Check the 14 digits of the CNPJ.',
	cnpj_alfanumerico_nao_suportado: 'CNPJs with letters are not accepted yet.',
	tomador_nao_encontrado:
		"Check 'Customer Type' and 'Customer ID': use tomador.tipo and tomador.id from Customer > Create or Search.",
	servico_nao_encontrado:
		"Check 'Service ID' (Service > Get Many) or leave it empty to use the main service.",
	pedido_nao_encontrado: "Check 'Issuance ID': use pedido.id from Invoice > Issue.",
	nota_nao_encontrada:
		"Check 'Origin' and 'Invoice ID': use pedido.nota.origem and pedido.nota.id from Wait for Authorization.",
	valor_invalido: 'The amount must be greater than zero, with up to 2 decimal places.',
	competencia_invalida: 'The service date must be a valid date (YYYY-MM-DD).',
	ibge_invalido: 'The service city must be a 7-digit IBGE city code.',
	motivo_invalido: "Choose the cancellation 'Reason'.",
	justificativa_invalida: 'The justification must have 15 to 255 characters.',
	cancelamento_em_andamento: 'This invoice is already being cancelled.',
	cancelamento_fora_do_prazo:
		'The deadline to cancel directly has passed: the cancellation now depends on a tax review in the Emissor Nacional.',
	credencial_congelada:
		'The Emissor Nacional rejected the company password. Update it in the emissaoja app to keep issuing.',
	pdf_indisponivel: 'The PDF could not be generated now. Try again in a few minutes.',
	sem_xml: 'This invoice has no XML yet. Try again later.',
	validation_error: 'Check the fields listed in details.',
};

function isObject(value: unknown): value is IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatBloqueios(value: unknown): string {
	if (!Array.isArray(value) || value.length === 0) return '';
	return value
		.map((item, index) => {
			const b = isObject(item) ? item : {};
			const text =
				typeof b.mensagem === 'string' && b.mensagem ? b.mensagem : String(b.code ?? 'bloqueio');
			const tags = [b.code, b.acao ? `action: ${String(b.acao)}` : '']
				.filter((t) => typeof t === 'string' && t !== '')
				.join(', ');
			return `(${index + 1}) ${text}${tags ? ` [${tags}]` : ''}`;
		})
		.join('; ');
}

function formatValidationDetails(value: unknown): string {
	if (!Array.isArray(value) || value.length === 0) return '';
	return value
		.map((item) => {
			const d = isObject(item) ? item : {};
			return `${String(d.campo ?? '?')}: ${String(d.erro ?? 'invalid')}`;
		})
		.join('; ');
}

function describe(details: IDataObject): string {
	const code = String(details.code);
	const parts: string[] = [];
	if (typeof details.message === 'string' && details.message) parts.push(details.message);
	const bloqueios = formatBloqueios(details.bloqueios);
	if (bloqueios) parts.push(bloqueios);
	const fields = formatValidationDetails(details.details);
	if (fields) parts.push(`Details: ${fields}.`);
	if (HINTS[code]) parts.push(HINTS[code]);
	const repeated = isObject(details.nota_igual_recente) ? details.nota_igual_recente : undefined;
	if (repeated && typeof repeated.pedido_id === 'string') {
		parts.push(`Identical invoice: order ${repeated.pedido_id}.`);
	}
	if (details.retry_after !== undefined)
		parts.push(`Retry after ${String(details.retry_after)} s.`);
	if (typeof details.request_id === 'string') parts.push(`Request ID: ${details.request_id}.`);
	return parts.join(' ');
}

/** Builds the error for a non-2xx answer: `code` in the message, `message`/`bloqueios` in the description. */
export function apiError(
	ctx: IExecuteFunctions,
	statusCode: number,
	body: IDataObject,
	requestId: string | undefined,
	retryAfter: string | undefined,
	itemIndex: number,
): NodeApiError {
	const code = typeof body.code === 'string' && body.code ? body.code : 'erro_desconhecido';
	const message =
		typeof body.message === 'string' && body.message ? body.message : `HTTP ${statusCode}`;
	const details: IDataObject = { code, message, http_status: statusCode };
	for (const [key, value] of Object.entries(body)) {
		if (key !== 'status' && key !== 'code' && key !== 'message') details[key] = value;
	}
	if (retryAfter !== undefined && details.retry_after === undefined)
		details.retry_after = retryAfter;
	if (requestId) details.request_id = requestId;

	const error = new NodeApiError(ctx.getNode(), details as JsonObject, {
		itemIndex,
		httpCode: String(statusCode),
		message: `The emissaoja API returned ${code} (HTTP ${statusCode})`,
		description: describe(details),
	});
	return withDetails(error, details);
}

// ---------------------------------------------------------------- HTTP

function header(res: IN8nHttpFullResponse, name: string): string | undefined {
	const headers = isObject(res.headers) ? res.headers : {};
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
	if (key === undefined) return undefined;
	const value = headers[key];
	const first = Array.isArray(value) ? value[0] : value;
	return first === undefined || first === null || first === '' ? undefined : String(first);
}

function toBuffer(body: unknown): Buffer {
	if (Buffer.isBuffer(body)) return body;
	if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
	if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
	if (typeof body === 'string') return Buffer.from(body, 'utf8');
	if (body === undefined || body === null) return Buffer.alloc(0);
	return Buffer.from(JSON.stringify(body), 'utf8');
}

/** Parses an error body: JSON object, or the first 200 characters of the text. */
function errorBody(body: unknown, statusCode: number): IDataObject {
	if (isObject(body) && !Buffer.isBuffer(body)) return body;
	const text = toBuffer(body).toString('utf8').trim();
	if (text) {
		try {
			const parsed = JSON.parse(text) as unknown;
			if (isObject(parsed)) return parsed;
		} catch {
			// not JSON (e.g. an HTML page from a proxy): the text goes in the message
		}
		return { message: text.slice(0, MAX_TEXT_ERROR) };
	}
	return { message: `HTTP ${statusCode}` };
}

function successBody(body: unknown): IDataObject {
	if (isObject(body) && !Buffer.isBuffer(body)) return body;
	if (typeof body === 'string' && body.trim()) {
		try {
			const parsed = JSON.parse(body) as unknown;
			if (isObject(parsed)) return parsed;
		} catch {
			// a 2xx answer that is not JSON: returned as text
		}
		return { data: body };
	}
	return {};
}

function networkErrorCode(error: unknown): string {
	const e = isObject(error) ? error : {};
	const cause = isObject(e.cause) ? e.cause : {};
	const text = [e.code, cause.code, e.message, e.description]
		.filter((v) => typeof v === 'string')
		.join(' ');
	return /ECONNABORTED|ETIMEDOUT|timeout/i.test(text) ? 'tempo_esgotado' : 'rede';
}

export interface RequestOptions {
	qs?: IDataObject;
	body?: IDataObject;
	headers?: IDataObject;
}

/** Path segment, always URL-encoded. */
export const enc = (value: unknown): string => encodeURIComponent(String(value));

/** Query string without null, undefined or empty values. */
export function compactQuery(qs: IDataObject | undefined): IDataObject | undefined {
	if (!qs) return undefined;
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(qs)) {
		if (value !== undefined && value !== null && value !== '') out[key] = value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * HTTP client for the emissaoja API, on top of n8n's `httpRequestWithAuthentication` (the credential adds
 * `Authorization: Bearer <key>`). It never retries on its own: issuing has fiscal effect, and the reference
 * (Idempotency-Key) is what makes a repeated call safe.
 */
export class EmissaojaClient {
	constructor(
		private readonly ctx: IExecuteFunctions,
		readonly baseUrl: string,
	) {}

	private abortSignal(): AbortSignal | undefined {
		return typeof this.ctx.getExecutionCancelSignal === 'function'
			? this.ctx.getExecutionCancelSignal()
			: undefined;
	}

	private async send(
		options: IHttpRequestOptions,
		itemIndex: number,
	): Promise<IN8nHttpFullResponse> {
		const signal = this.abortSignal();
		if (signal) options.abortSignal = signal;
		try {
			return (await this.ctx.helpers.httpRequestWithAuthentication.call(
				this.ctx,
				CREDENTIAL_NAME,
				options,
			)) as IN8nHttpFullResponse;
		} catch (error) {
			const code = networkErrorCode(error);
			const original = isObject(error) && typeof error.message === 'string' ? error.message : '';
			const details: IDataObject = {
				code,
				message: original || (code === 'tempo_esgotado' ? 'Timeout' : 'Network failure'),
			};
			throw withDetails(
				new NodeApiError(this.ctx.getNode(), details as JsonObject, {
					itemIndex,
					message: `The emissaoja API did not respond (${code})`,
					description: `Could not reach ${this.baseUrl}${original ? ` (${original})` : ''}. Check that n8n can make outbound HTTPS requests and see https://emissaoja.com.br/v1/status. Nothing is retried automatically: for Issue, run again with the same reference, so the API returns the same order if the first request got through.`,
				}),
				details,
			);
		}
	}

	/** JSON request. Returns the body of a 2xx answer; any other status becomes a NodeApiError. */
	async json(
		method: IHttpRequestMethods,
		path: string,
		{ qs, body, headers }: RequestOptions,
		itemIndex: number,
	): Promise<IDataObject> {
		// n8n drops an empty object body, so only a non-empty one counts as a body.
		const hasBody = body !== undefined && Object.keys(body).length > 0;
		// The API rejects a Content-Type without a body: application/json gives 400 and axios's default for a
		// body-less POST/PUT/PATCH (application/x-www-form-urlencoded) gives 415. So application/json goes only
		// with a body, and `false` keeps axios from adding its default on a body-less call other than GET.
		let contentType: IDataObject = {};
		if (hasBody) contentType = { 'Content-Type': 'application/json' };
		else if (method !== 'GET' && method !== 'HEAD') contentType = { 'Content-Type': false };
		const options: IHttpRequestOptions = {
			method,
			url: `${this.baseUrl}${path}`,
			qs: compactQuery(qs),
			headers: {
				Accept: 'application/json',
				'User-Agent': USER_AGENT,
				...contentType,
				...headers,
			},
			// In n8n's httpRequest this flag only adds `Accept: application/json` (already set above).
			json: hasBody,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			timeout: TIMEOUT_MS,
		};
		if (hasBody) options.body = body;

		const res = await this.send(options, itemIndex);
		if (res.statusCode >= 200 && res.statusCode < 300) return successBody(res.body);
		throw apiError(
			this.ctx,
			res.statusCode,
			errorBody(res.body, res.statusCode),
			header(res, 'x-request-id'),
			header(res, 'retry-after'),
			itemIndex,
		);
	}

	/** File download (PDF or XML). Returns the raw bytes of a 2xx answer. */
	async bytes(path: string, itemIndex: number): Promise<{ data: Buffer; contentType?: string }> {
		const res = await this.send(
			{
				method: 'GET',
				url: `${this.baseUrl}${path}`,
				headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
				encoding: 'arraybuffer',
				json: false,
				returnFullResponse: true,
				ignoreHttpStatusErrors: true,
				timeout: TIMEOUT_MS,
			},
			itemIndex,
		);
		if (res.statusCode >= 200 && res.statusCode < 300) {
			return { data: toBuffer(res.body), contentType: header(res, 'content-type') };
		}
		throw apiError(
			this.ctx,
			res.statusCode,
			errorBody(res.body, res.statusCode),
			header(res, 'x-request-id'),
			header(res, 'retry-after'),
			itemIndex,
		);
	}
}

/** Base URL of the environment chosen in the credential (Production or Sandbox). */
export async function getBaseUrl(ctx: IExecuteFunctions): Promise<string> {
	const credentials = await ctx.getCredentials(CREDENTIAL_NAME);
	const ambiente = typeof credentials.ambiente === 'string' ? credentials.ambiente.trim() : '';
	return (ambiente || BASE_URL).replace(/\/+$/, '');
}
