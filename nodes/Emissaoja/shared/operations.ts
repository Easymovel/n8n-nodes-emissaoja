import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import type { EmissaojaClient } from './transport';
import { enc, withDetails } from './transport';
import {
	REFERENCE_EXPRESSION,
	fileNamePart,
	normalizeCnpj,
	normalizeDocument,
	optionalText,
	parseAmount,
	parseDate,
	parseReference,
} from './utils';

/** Final states of an issuance request (pedido). */
const TERMINAL_STATES = ['autorizada', 'recusada', 'incerta'];
/** Never check an issuance more often than this, whatever proxima_consulta_ms says. */
const MIN_POLL_MS = 1000;
/** Wait between checks when the API does not send proxima_consulta_ms. */
const DEFAULT_POLL_MS = 3000;
const MAX_WAIT_S = 120;
/** Cancellation: check the operation every 2 s, for up to 120 s. */
const OPERATION_POLL_MS = 2000;
const OPERATION_MAX_WAIT_MS = 120000;
/** Largest page the API returns. */
const PAGE_SIZE = 50;

function isObject(value: unknown): value is IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objects(value: unknown): IDataObject[] {
	return Array.isArray(value) ? value.filter(isObject) : [];
}

/** Error raised before calling the API (invalid parameter, timeout...). `code` follows the API codes. */
function localError(
	ctx: IExecuteFunctions,
	itemIndex: number,
	code: string,
	message: string,
	description: string,
	extra: IDataObject = {},
): NodeOperationError {
	return withDetails(
		new NodeOperationError(ctx.getNode(), `${message} (${code})`, { itemIndex, description }),
		{ code, message, ...extra },
	);
}

function cancelSignal(ctx: IExecuteFunctions): AbortSignal | undefined {
	return typeof ctx.getExecutionCancelSignal === 'function'
		? ctx.getExecutionCancelSignal()
		: undefined;
}

function toNumber(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function customerTypeParam(ctx: IExecuteFunctions, itemIndex: number): string {
	const type = String(ctx.getNodeParameter('customerType', itemIndex, 'pj'))
		.trim()
		.toLowerCase();
	if (type !== 'pj' && type !== 'pf') {
		throw localError(
			ctx,
			itemIndex,
			'tomador_obrigatorio',
			"'Customer Type' must be pj or pf",
			`Got "${type}". Use tomador.tipo from Customer > Create or Search.`,
		);
	}
	return type;
}

function requiredText(
	ctx: IExecuteFunctions,
	itemIndex: number,
	parameter: string,
	label: string,
	code: string,
	description: string,
): string {
	const value = optionalText(ctx.getNodeParameter(parameter, itemIndex, ''));
	if (value === undefined) {
		throw localError(ctx, itemIndex, code, `The '${label}' field is empty`, description);
	}
	return value;
}

function originParam(ctx: IExecuteFunctions, itemIndex: number): string {
	// Empty (e.g. pedido.nota is null because the issuance was refused): the Invoice ID check below explains it.
	const origin = optionalText(ctx.getNodeParameter('origin', itemIndex, 'local')) ?? 'local';
	if (origin !== 'local' && origin !== 'importada') {
		throw localError(
			ctx,
			itemIndex,
			'nota_nao_encontrada',
			"'Origin' must be local or importada",
			`Got "${origin}". Use nota.origem from Wait for Authorization, or origem from Get Many.`,
		);
	}
	return origin;
}

function invoiceIdParam(ctx: IExecuteFunctions, itemIndex: number): string {
	return requiredText(
		ctx,
		itemIndex,
		'invoiceId',
		'Invoice ID',
		'nota_nao_encontrada',
		"Only authorized invoices have an ID: after Wait for Authorization, check that pedido.estado is 'autorizada' and use pedido.nota.id.",
	);
}

// ---------------------------------------------------------------- customer

async function createCustomer(
	this: IExecuteFunctions,
	client: EmissaojaClient,
	i: number,
): Promise<IDataObject> {
	const documento = normalizeDocument(this.getNodeParameter('document', i, ''));
	if (documento === '') {
		throw localError(
			this,
			i,
			'documento_invalido',
			"The 'Document' field is empty",
			'Enter the CNPJ or CPF of the customer, with or without punctuation.',
		);
	}
	const nome = optionalText(this.getNodeParameter('name', i, ''));
	const body: IDataObject = { documento };
	if (nome !== undefined) body.nome = nome;
	return await client.json('POST', '/v1/tomadores', { body }, i);
}

async function getManyCustomers(
	this: IExecuteFunctions,
	client: EmissaojaClient,
	i: number,
): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	const busca = optionalText(this.getNodeParameter('searchTerm', i, ''));
	if (!returnAll) {
		const limite = Math.min(
			PAGE_SIZE,
			Math.max(1, toNumber(this.getNodeParameter('limit', i, 50), 50)),
		);
		const pagina = Math.max(1, Math.floor(toNumber(this.getNodeParameter('page', i, 1), 1)));
		const body = await client.json('GET', '/v1/tomadores', { qs: { busca, pagina, limite } }, i);
		return objects(body.tomadores);
	}
	const all: IDataObject[] = [];
	for (let pagina = 1; pagina <= 10000; pagina++) {
		const body = await client.json(
			'GET',
			'/v1/tomadores',
			{ qs: { busca, pagina, limite: PAGE_SIZE } },
			i,
		);
		const page = objects(body.tomadores);
		all.push(...page);
		const total = Number(body.total);
		if (page.length < PAGE_SIZE || (Number.isFinite(total) && all.length >= total)) break;
	}
	return all;
}

// ---------------------------------------------------------------- invoice

async function issueInvoice(
	this: IExecuteFunctions,
	client: EmissaojaClient,
	i: number,
): Promise<IDataObject> {
	const reference = parseReference(this.getNodeParameter('reference', i, ''));
	if (reference.error !== undefined) {
		throw localError(
			this,
			i,
			'chave_idempotencia_invalida',
			'Invalid reference',
			`The reference must have 8 to 64 characters: letters, numbers, _ and - (${reference.error}). It is sent as the Idempotency-Key header, so running again with the same reference never issues twice. Use an ID from your data, such as the order number, or the expression ${REFERENCE_EXPRESSION}. Nothing was sent to the API.`,
		);
	}
	const tomadorTipo = customerTypeParam(this, i);
	const tomadorId = requiredText(
		this,
		i,
		'customerId',
		'Customer ID',
		'tomador_obrigatorio',
		'Use tomador.id from Customer > Create or Search. Nothing was sent to the API.',
	);
	const amount = parseAmount(this.getNodeParameter('amount', i, 0));
	if (amount.error !== undefined) {
		throw localError(
			this,
			i,
			'valor_invalido',
			'Invalid amount',
			`The amount in reais must be greater than zero, with up to 2 decimal places: ${amount.error}. Nothing was sent to the API.`,
		);
	}
	const descricao = optionalText(this.getNodeParameter('description', i, ''));
	if (descricao !== undefined && descricao.length > 2000) {
		throw localError(
			this,
			i,
			'validation_error',
			'The description is too long',
			`The description has ${descricao.length} characters; the limit is 2000. Nothing was sent to the API.`,
		);
	}
	const competencia = parseDate(this.getNodeParameter('serviceDate', i, ''));
	if (competencia.error !== undefined) {
		throw localError(
			this,
			i,
			'competencia_invalida',
			'Invalid service date',
			`${competencia.error}. Use a date such as 2026-11-05, the date picker or an expression such as {{ $today }}. Nothing was sent to the API.`,
		);
	}
	const servicoId = optionalText(this.getNodeParameter('serviceId', i, ''));
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const body: IDataObject = {
		tomador_tipo: tomadorTipo,
		tomador_id: tomadorId,
		valor: amount.value,
	};
	if (servicoId !== undefined) body.servico_id = servicoId;
	if (descricao !== undefined) body.descricao = descricao;
	if (competencia.value !== undefined) body.competencia = competencia.value;
	if (typeof options.retainIss === 'boolean') body.retem_iss = options.retainIss;
	if (options.issRate !== undefined && options.issRate !== null && options.issRate !== '') {
		const rate = Number(options.issRate);
		if (!Number.isFinite(rate)) {
			throw localError(
				this,
				i,
				'validation_error',
				'Invalid ISS rate',
				`The ISS rate must be a percentage such as 2 or 5 (got "${String(options.issRate)}"). Nothing was sent to the API.`,
			);
		}
		body.aliquota_iss = rate;
	}
	const cityCode = optionalText(options.serviceCityCode);
	if (cityCode !== undefined) body.municipio_prestacao = cityCode;
	if (options.confirmRepeat === true) body.confirmo_repeticao = true;
	const allowRepeatOf = optionalText(options.allowRepeatOf);
	if (allowRepeatOf !== undefined) body.permitir_repetida_de = allowRepeatOf;

	return await client.json(
		'POST',
		'/v1/notas',
		{ body, headers: { 'Idempotency-Key': reference.value } },
		i,
	);
}

async function waitForAuthorization(
	this: IExecuteFunctions,
	client: EmissaojaClient,
	i: number,
): Promise<IDataObject> {
	const id = requiredText(
		this,
		i,
		'issuanceId',
		'Issuance ID',
		'pedido_nao_encontrado',
		'Use pedido.id from Invoice > Issue.',
	);
	const maxWaitS = Math.min(
		MAX_WAIT_S,
		Math.max(1, toNumber(this.getNodeParameter('maxWait', i, 60), 60)),
	);
	const deadline = Date.now() + maxWaitS * 1000;
	const signal = cancelSignal(this);

	for (;;) {
		const body = await client.json('GET', `/v1/emissoes/${enc(id)}`, {}, i);
		const pedido = isObject(body.pedido) ? body.pedido : {};
		const estado = typeof pedido.estado === 'string' ? pedido.estado : '';
		if (TERMINAL_STATES.includes(estado)) return body;

		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw localError(
				this,
				i,
				'tempo_esgotado',
				`The issuance did not finish in ${maxWaitS} s`,
				`The issuance request ${id} is still '${estado || 'unknown'}'. It keeps going on the emissaoja side: check it later with Get Issuance Status (do not issue it again), or raise 'Max Wait (Seconds)' up to 120.`,
				{ pedido_id: id, pedido },
			);
		}
		const suggested = Number(pedido.proxima_consulta_ms);
		const wait = Math.max(MIN_POLL_MS, suggested > 0 ? suggested : DEFAULT_POLL_MS);
		await sleep(Math.min(wait, remaining), signal);
	}
}

async function getManyInvoices(
	this: IExecuteFunctions,
	client: EmissaojaClient,
	i: number,
): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	const limit = returnAll
		? Number.POSITIVE_INFINITY
		: Math.max(1, Math.floor(toNumber(this.getNodeParameter('limit', i, 50), 50)));
	const filters = this.getNodeParameter('filters', i, {}) as IDataObject;

	const de = parseDate(filters.fromDate);
	const ate = parseDate(filters.toDate);
	const dateError = de.error ?? ate.error;
	if (dateError !== undefined) {
		throw localError(this, i, 'validation_error', 'Invalid date filter', `${dateError}.`);
	}
	let periodo = optionalText(filters.period);
	if (periodo === undefined && (de.value !== undefined || ate.value !== undefined)) {
		periodo = 'personalizado';
	}
	if (periodo === 'personalizado' && (de.value === undefined || ate.value === undefined)) {
		throw localError(
			this,
			i,
			'validation_error',
			'A custom period needs From Date and To Date',
			"Set both 'From Date' and 'To Date' in Filters, or choose another period.",
		);
	}
	const qs: IDataObject = {
		periodo,
		situacao: optionalText(filters.status),
		busca: optionalText(filters.search),
	};
	if (periodo === 'personalizado') {
		qs.de = de.value;
		qs.ate = ate.value;
	}

	const all: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const limite = Math.min(PAGE_SIZE, limit - all.length);
		const body = await client.json('GET', '/v1/notas', { qs: { ...qs, limite, cursor } }, i);
		all.push(...objects(body.notas));
		cursor =
			typeof body.proximo_cursor === 'string' && body.proximo_cursor !== ''
				? body.proximo_cursor
				: undefined;
	} while (cursor !== undefined && all.length < limit);
	return returnAll ? all : all.slice(0, limit);
}

async function downloadInvoice(
	this: IExecuteFunctions,
	client: EmissaojaClient,
	i: number,
	kind: 'pdf' | 'xml',
): Promise<INodeExecutionData> {
	const origin = originParam(this, i);
	const invoiceId = invoiceIdParam(this, i);
	const number = optionalText(this.getNodeParameter('invoiceNumber', i, ''));
	const field = optionalText(this.getNodeParameter('binaryPropertyName', i, 'data')) ?? 'data';

	const file = await client.bytes(`/v1/notas/${enc(origin)}/${enc(invoiceId)}/${kind}`, i);
	const fileName = `nfse-${fileNamePart(number) || fileNamePart(invoiceId) || 'nota'}.${kind}`;
	const mimeType = kind === 'pdf' ? 'application/pdf' : 'application/xml';
	const binaryData = await this.helpers.prepareBinaryData(file.data, fileName, mimeType);

	const input = this.getInputData()[i];
	return {
		json: { ...(input?.json ?? {}) },
		binary: { ...(input?.binary ?? {}), [field]: binaryData },
		pairedItem: { item: i },
	};
}

async function cancelInvoice(
	this: IExecuteFunctions,
	client: EmissaojaClient,
	i: number,
): Promise<IDataObject> {
	const origin = originParam(this, i);
	const invoiceId = invoiceIdParam(this, i);
	const motivo = String(this.getNodeParameter('reason', i, '1')).trim();
	if (motivo !== '1' && motivo !== '2') {
		throw localError(
			this,
			i,
			'motivo_invalido',
			"'Reason' must be 1 or 2",
			`Got "${motivo}". Use 1 (error in issuance) or 2 (service not provided).`,
		);
	}
	const justificativa = optionalText(this.getNodeParameter('justification', i, ''));
	const waitForResult = this.getNodeParameter('waitForResult', i, false) as boolean;

	const body: IDataObject = { motivo };
	if (justificativa !== undefined) body.justificativa = justificativa;
	const started = await client.json(
		'POST',
		`/v1/notas/${enc(origin)}/${enc(invoiceId)}/cancelar`,
		{ body },
		i,
	);

	const operacao = isObject(started.operacao) ? started.operacao : {};
	const operacaoId = typeof operacao.id === 'string' ? operacao.id : '';
	if (!waitForResult || operacaoId === '' || operacao.estado !== 'processando') return started;

	const deadline = Date.now() + OPERATION_MAX_WAIT_MS;
	const signal = cancelSignal(this);
	for (;;) {
		await sleep(Math.max(0, Math.min(OPERATION_POLL_MS, deadline - Date.now())), signal);
		const current = await client.json('GET', `/v1/operacoes/${enc(operacaoId)}`, {}, i);
		const estado = isObject(current.operacao) ? current.operacao.estado : undefined;
		if (estado !== 'processando') return current;
		if (Date.now() >= deadline) {
			throw localError(
				this,
				i,
				'tempo_esgotado',
				'The cancellation did not finish in 120 s',
				`The cancellation ${operacaoId} is still running on the emissaoja side. Check the invoice later (Get Many or the emissaoja app) before trying again.`,
				{ operacao_id: operacaoId, operacao: current.operacao as IDataObject },
			);
		}
	}
}

// ---------------------------------------------------------------- router

/** Runs one operation for input item `i` and returns its output items (all paired with item `i`). */
export async function runOperation(
	this: IExecuteFunctions,
	client: EmissaojaClient,
	i: number,
): Promise<INodeExecutionData[]> {
	const resource = this.getNodeParameter('resource', i) as string;
	const operation = this.getNodeParameter('operation', i) as string;
	const one = (json: IDataObject): INodeExecutionData[] => [{ json, pairedItem: { item: i } }];
	const many = (list: IDataObject[]): INodeExecutionData[] =>
		list.map((json) => ({ json, pairedItem: { item: i } }));

	switch (`${resource}:${operation}`) {
		case 'company:get':
			return one(await client.json('GET', '/v1/empresa', {}, i));

		case 'customer:create':
			return one(await createCustomer.call(this, client, i));

		case 'customer:get': {
			const tipo = customerTypeParam(this, i);
			const id = requiredText(
				this,
				i,
				'customerId',
				'Customer ID',
				'tomador_obrigatorio',
				'Use tomador.id from Customer > Create or Search.',
			);
			return one(await client.json('GET', `/v1/tomadores/${enc(tipo)}/${enc(id)}`, {}, i));
		}

		case 'customer:search': {
			const q = optionalText(this.getNodeParameter('query', i, '')) ?? '';
			if (q.length < 2) {
				throw localError(
					this,
					i,
					'validation_error',
					"The 'Search Term' needs at least 2 characters",
					'Search by part of the name or by the document of the customer.',
				);
			}
			const body = await client.json('GET', '/v1/tomadores/busca', { qs: { q } }, i);
			return many(objects(body.tomadores));
		}

		case 'customer:getAll':
			return many(await getManyCustomers.call(this, client, i));

		case 'service:getAll': {
			const ativos = String(this.getNodeParameter('status', i, '1'));
			const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
			const body = await client.json('GET', '/v1/servicos', { qs: { ativos } }, i);
			const list = objects(body.servicos);
			if (returnAll) return many(list);
			const limit = Math.max(1, Math.floor(toNumber(this.getNodeParameter('limit', i, 50), 50)));
			return many(list.slice(0, limit));
		}

		case 'invoice:issue':
			return one(await issueInvoice.call(this, client, i));

		case 'invoice:getIssuance': {
			const id = requiredText(
				this,
				i,
				'issuanceId',
				'Issuance ID',
				'pedido_nao_encontrado',
				'Use pedido.id from Invoice > Issue.',
			);
			return one(await client.json('GET', `/v1/emissoes/${enc(id)}`, {}, i));
		}

		case 'invoice:waitForAuthorization':
			return one(await waitForAuthorization.call(this, client, i));

		case 'invoice:getAll':
			return many(await getManyInvoices.call(this, client, i));

		case 'invoice:downloadPdf':
			return [await downloadInvoice.call(this, client, i, 'pdf')];

		case 'invoice:downloadXml':
			return [await downloadInvoice.call(this, client, i, 'xml')];

		case 'invoice:cancel':
			return one(await cancelInvoice.call(this, client, i));

		case 'cnpj:lookUp': {
			const cnpj = normalizeCnpj(this.getNodeParameter('cnpj', i, ''));
			if (cnpj.length !== 14) {
				throw localError(
					this,
					i,
					'cnpj_invalido',
					cnpj === ''
						? "The 'CNPJ' field is empty"
						: `A CNPJ has 14 characters (got ${cnpj.length})`,
					'Enter the 14 digits of the CNPJ, with or without punctuation. Nothing was sent to the API.',
				);
			}
			return one(await client.json('GET', `/v1/cnpj/${enc(cnpj)}`, {}, i));
		}
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation: ${resource} > ${operation}`, {
		itemIndex: i,
	});
}
