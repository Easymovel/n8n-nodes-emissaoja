// Tests for the node's execute() with a mocked IExecuteFunctions.
//
//   npm run build && npm test
//
// - Mock tests: simulated HTTP responses (Idempotency-Key, 422 with bloqueios, PDF/XML as binary, waiting for
//   the authorization, cursor pagination, network and non-JSON errors, continueOnFail). No network.
// - Sandbox test: calls https://sandbox.emissaoja.com.br and only runs with EMISSAOJA_TEST_KEY (an ej_test_ key
//   of a sandbox account connected to the example company 11111111000191). Nothing reaches the tax authority.
//   The node itself never reads environment variables; only this test harness does.
//
//   EMISSAOJA_TEST_KEY=ej_test_... npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { Emissaoja } = require('../dist/nodes/Emissaoja/Emissaoja.node.js');
const { EmissaojaApi } = require('../dist/credentials/EmissaojaApi.credentials.js');
const { EmissaojaClient, VERSION } = require('../dist/nodes/Emissaoja/shared/transport.js');
const { parseAmount, parseDate, parseReference } = require('../dist/nodes/Emissaoja/shared/utils.js');
const pkg = require('../package.json');

const NODE = { id: 'x', name: 'emissaoja', type: 'n8n-nodes-emissaoja.emissaoja', typeVersion: 1, position: [0, 0], parameters: {} };
const SANDBOX = 'https://sandbox.emissaoja.com.br';

/** httpRequest de verdade (fetch), com a mesma semântica do helper do n8n usada pelo node. */
async function httpReal(options) {
	const url = new URL(options.url);
	for (const [k, v] of Object.entries(options.qs ?? {})) url.searchParams.set(k, String(v));
	const res = await fetch(url, {
		method: options.method,
		headers: options.headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const bytes = Buffer.from(await res.arrayBuffer());
	let body = bytes;
	if (options.encoding !== 'arraybuffer') {
		const texto = bytes.toString('utf8');
		try {
			body = JSON.parse(texto);
		} catch {
			body = texto;
		}
	}
	return { statusCode: res.status, headers: Object.fromEntries(res.headers), body };
}

function criarContexto({
	itens = [{}],
	params,
	http,
	continueOnFail = false,
	credenciais = { chave: 'ej_test_chave', ambiente: SANDBOX },
}) {
	const chamadas = [];
	const ctx = {
		getInputData: () => itens.map((item) => ('json' in item ? item : { json: item })),
		getNodeParameter: (nome, i, padrao) => {
			const p = typeof params === 'function' ? params(i) : params;
			if (nome in p) return p[nome];
			if (padrao !== undefined) return padrao;
			throw new Error(`Could not get parameter "${nome}"`);
		},
		getNode: () => NODE,
		continueOnFail: () => continueOnFail,
		async getCredentials(nome) {
			assert.equal(nome, 'emissaojaApi');
			return credenciais;
		},
		helpers: {
			async httpRequestWithAuthentication(credencial, options) {
				assert.equal(credencial, 'emissaojaApi');
				// O n8n aplica o `authenticate` da credencial: Authorization: Bearer <chave>.
				const chamada = { ...options, headers: { ...options.headers, Authorization: `Bearer ${credenciais.chave}` } };
				chamadas.push(chamada);
				return http(chamada, chamadas.length);
			},
			async prepareBinaryData(buffer, fileName, mimeType) {
				return {
					data: Buffer.from(buffer).toString('base64'),
					fileName,
					fileExtension: fileName.split('.').pop(),
					mimeType,
					fileSize: `${buffer.length} B`,
				};
			},
		},
	};
	return { ctx, chamadas };
}

const executar = (ctx) => new Emissaoja().execute.call(ctx);
const resp = (statusCode, body, headers = {}) => ({ statusCode, body, headers });
const SANDBOX_KEY = process.env.EMISSAOJA_TEST_KEY;

const EMITIR = {
	resource: 'invoice',
	operation: 'issue',
	reference: 'pedido-2026-11-0001',
	customerType: 'pj',
	customerId: '6f1c3c1e-8a52-4b55-9d7e-2b8f6f0f0a01',
	amount: 1500.5,
};

// ------------------------------------------------------------------ credential and local helpers

test('credential: Bearer header from "chave", environment as base URL, test with GET /v1/empresa', () => {
	const cred = new EmissaojaApi();
	assert.equal(cred.name, 'emissaojaApi');
	assert.equal(cred.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.chave}}');
	assert.equal(cred.test.request.baseURL, '={{$credentials.ambiente}}');
	assert.equal(cred.test.request.url, '/v1/empresa');
	const chave = cred.properties.find((p) => p.name === 'chave');
	assert.equal(chave.typeOptions.password, true);
	const ambiente = cred.properties.find((p) => p.name === 'ambiente');
	assert.deepEqual(
		ambiente.options.map((o) => o.value),
		['https://emissaoja.com.br', 'https://sandbox.emissaoja.com.br'],
	);
	assert.equal(ambiente.default, 'https://emissaoja.com.br');
});

test('VERSION (User-Agent) matches package.json', () => {
	assert.equal(VERSION, pkg.version);
});

test('parseReference, parseAmount and parseDate', () => {
	assert.equal(parseReference('nfse-1-0').value, 'nfse-1-0');
	assert.match(parseReference('12-0').error, /4 characters/);
	assert.match(parseReference('com espaço 123').error, /characters/);
	assert.equal(parseReference('a'.repeat(65)).error !== undefined, true);

	assert.equal(parseAmount(1500.5).value, 1500.5);
	assert.equal(parseAmount(0.1 + 0.2).value, 0.3);
	assert.equal(parseAmount('1500').value, 1500);
	assert.equal(parseAmount('1500,5').value, 1500.5);
	assert.equal(parseAmount('1.500,50').value, 1500.5);
	assert.equal(parseAmount('1,500.50').value, 1500.5);
	assert.equal(parseAmount('R$ 1.500,00').value, 1500);
	assert.equal(parseAmount('R$' + String.fromCharCode(160) + '1.500,00').value, 1500); // non-breaking space, as spreadsheets format money
	assert.equal(parseAmount('1.500.000').value, 1500000);
	assert.match(parseAmount('1.500').error, /unambiguous/);
	assert.match(parseAmount('1,500').error, /unambiguous/);
	assert.match(parseAmount(0).error, /greater than zero/);
	assert.match(parseAmount(10.005).error, /2 decimal places/);
	assert.match(parseAmount('').error, /unambiguous/);

	assert.equal(parseDate('').value, undefined);
	assert.equal(parseDate('2026-11-05').value, '2026-11-05');
	assert.equal(parseDate('2026-11-05T00:00:00').value, '2026-11-05');
	assert.equal(parseDate({ toISODate: () => '2026-10-31' }).value, '2026-10-31');
	assert.match(parseDate('2026-02-30').error, /not a valid date/);
	assert.match(parseDate('05/11/2026').error, /YYYY-MM-DD/);
});

// ------------------------------------------------------------------ mock

test('Issue: Idempotency-Key = reference, snake_case body without empty fields, sandbox URL, User-Agent', async () => {
	const pedido = { id: 'p1', estado: 'na_fila', proxima_consulta_ms: 1500 };
	const { ctx, chamadas } = criarContexto({
		params: {
			...EMITIR,
			amount: '1.500,50',
			description: '  Consultoria de novembro ',
			serviceDate: '2026-11-05T00:00:00',
			serviceId: '',
			options: { allowRepeatOf: '', confirmRepeat: false },
		},
		http: async () => resp(202, { pedido, previa: { resumo: {}, avisos: [] } }),
	});
	const [saida] = await executar(ctx);

	assert.equal(chamadas.length, 1);
	const [c] = chamadas;
	assert.equal(c.method, 'POST');
	assert.equal(c.url, `${SANDBOX}/v1/notas`);
	assert.equal(c.headers['Idempotency-Key'], 'pedido-2026-11-0001');
	assert.equal(c.headers['User-Agent'], `emissaoja-n8n/${pkg.version}`);
	assert.equal(c.headers['Content-Type'], 'application/json');
	assert.equal(c.json, true);
	assert.equal(c.headers.Accept, 'application/json');
	assert.equal(c.headers.Authorization, 'Bearer ej_test_chave');
	assert.deepEqual(c.body, {
		tomador_tipo: 'pj',
		tomador_id: EMITIR.customerId,
		valor: 1500.5,
		descricao: 'Consultoria de novembro',
		competencia: '2026-11-05',
	});
	assert.deepEqual(saida[0].json.pedido, pedido);
	assert.deepEqual(saida[0].pairedItem, { item: 0 });
});

test('Issue: advanced options become permitir_repetida_de, confirmo_repeticao and the ISS fields', async () => {
	const { ctx, chamadas } = criarContexto({
		params: {
			...EMITIR,
			serviceId: 'svc-1',
			options: {
				allowRepeatOf: 'pedido-anterior',
				confirmRepeat: true,
				issRate: 2,
				retainIss: false,
				serviceCityCode: '3106200',
			},
		},
		http: async () => resp(200, { pedido: { id: 'p1', estado: 'autorizada' }, repetido: true }),
	});
	const [saida] = await executar(ctx);
	assert.deepEqual(chamadas[0].body, {
		tomador_tipo: 'pj',
		tomador_id: EMITIR.customerId,
		valor: 1500.5,
		servico_id: 'svc-1',
		retem_iss: false,
		aliquota_iss: 2,
		municipio_prestacao: '3106200',
		confirmo_repeticao: true,
		permitir_repetida_de: 'pedido-anterior',
	});
	assert.equal(saida[0].json.repetido, true);
});

test('Issue: an invalid reference fails before calling the API', async () => {
	// {{ $execution.id }}-{{ $itemIndex }} alone gives "12-0" on young n8n instances: too short.
	const { ctx, chamadas } = criarContexto({ params: { ...EMITIR, reference: '12-0' }, http: async () => assert.fail('no call') });
	await assert.rejects(executar(ctx), (e) => {
		assert.equal(e.constructor.name, 'NodeOperationError');
		assert.match(e.message, /chave_idempotencia_invalida/);
		assert.match(e.description, /8 to 64 characters/);
		assert.match(e.description, /nfse-\{\{ \$execution\.id \}\}-\{\{ \$itemIndex \}\}/);
		return true;
	});
	assert.equal(chamadas.length, 0);

	const b = criarContexto({ params: { ...EMITIR, reference: '' }, http: async () => assert.fail('no call'), continueOnFail: true });
	const [saida] = await executar(b.ctx);
	assert.equal(saida[0].json.code, 'chave_idempotencia_invalida');
	assert.match(saida[0].json.error, /Invalid reference/);
	assert.equal(b.chamadas.length, 0);
});

test('Issue: invalid amounts and dates fail before calling the API', async () => {
	for (const [extra, code] of [
		[{ amount: '1.500' }, 'valor_invalido'],
		[{ amount: 0 }, 'valor_invalido'],
		[{ serviceDate: '05/11/2026' }, 'competencia_invalida'],
		[{ customerId: '  ' }, 'tomador_obrigatorio'],
	]) {
		const { ctx, chamadas } = criarContexto({ params: { ...EMITIR, ...extra }, http: async () => assert.fail('no call'), continueOnFail: true });
		const [saida] = await executar(ctx);
		assert.equal(saida[0].json.code, code, JSON.stringify(extra));
		assert.equal(chamadas.length, 0);
	}
});

test('422 nota_bloqueada: NodeApiError with the code in the message and message + bloqueios in the description', async () => {
	const erro = {
		status: 'ERROR',
		code: 'nota_bloqueada',
		message: 'Antes de emitir, resolva:',
		bloqueios: [{ code: 'tomador_incompleto', mensagem: 'Complete o endereço do cliente.', acao: 'completar_tomador' }],
	};
	const http = async () => resp(422, erro, { 'X-Request-Id': 'r_abc123' });
	const a = criarContexto({ params: EMITIR, http });
	await assert.rejects(executar(a.ctx), (e) => {
		assert.equal(e.constructor.name, 'NodeApiError');
		assert.match(e.message, /nota_bloqueada/);
		assert.match(e.message, /HTTP 422/);
		assert.equal(e.httpCode, '422');
		assert.match(e.description, /Antes de emitir, resolva:/);
		assert.match(e.description, /Complete o endereço do cliente\./);
		assert.match(e.description, /completar_tomador/);
		assert.match(e.description, /r_abc123/);
		assert.equal(e.context.itemIndex, 0);
		return true;
	});

	// continueOnFail: the failed item carries code, bloqueios and request_id; the next item still runs.
	const fila = [resp(422, erro, { 'x-request-id': 'r_abc123' }), resp(202, { pedido: { id: 'p2', estado: 'na_fila' } })];
	const b = criarContexto({
		itens: [{}, {}],
		params: (i) => ({ ...EMITIR, reference: `pedido-2026-11-000${i + 1}` }),
		http: async () => fila.shift(),
		continueOnFail: true,
	});
	const [saida] = await executar(b.ctx);
	assert.equal(saida.length, 2);
	assert.equal(saida[0].json.code, 'nota_bloqueada');
	assert.equal(saida[0].json.http_status, 422);
	assert.equal(saida[0].json.request_id, 'r_abc123');
	assert.equal(saida[0].json.message, 'Antes de emitir, resolva:');
	assert.deepEqual(saida[0].json.bloqueios, erro.bloqueios);
	assert.match(saida[0].json.error, /nota_bloqueada/);
	assert.deepEqual(saida[0].pairedItem, { item: 0 });
	assert.equal(saida[1].json.pedido.id, 'p2');
	assert.deepEqual(saida[1].pairedItem, { item: 1 });
	assert.deepEqual(
		b.chamadas.map((c) => c.headers['Idempotency-Key']),
		['pedido-2026-11-0001', 'pedido-2026-11-0002'],
	);
});

test('409 possivel_duplicada: the description points to Allow Repeat Of with the order of the identical invoice', async () => {
	const { ctx } = criarContexto({
		params: EMITIR,
		http: async () =>
			resp(409, {
				status: 'ERROR',
				code: 'possivel_duplicada',
				message: 'Já foi emitida hoje uma nota igual a esta. Emitir outra?',
				nota_igual_recente: { pedido_id: 'p-anterior', numero_nfse: '41', emitida_em: null, status: 'autorizada' },
			}),
	});
	await assert.rejects(executar(ctx), (e) => {
		assert.match(e.message, /possivel_duplicada/);
		assert.match(e.description, /Allow Repeat Of/);
		assert.match(e.description, /p-anterior/);
		return true;
	});
});

test('error body that is not JSON: message is the first 200 characters; network failure: code rede, no retry', async () => {
	const html = `<html><body>${'Bad gateway '.repeat(40)}</body></html>`;
	const a = criarContexto({ params: { resource: 'company', operation: 'get' }, http: async () => resp(502, html), continueOnFail: true });
	const [saida] = await executar(a.ctx);
	assert.equal(saida[0].json.code, 'erro_desconhecido');
	assert.equal(saida[0].json.http_status, 502);
	assert.equal(saida[0].json.message, html.slice(0, 200));

	const b = criarContexto({
		params: EMITIR,
		http: async () => {
			throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' });
		},
	});
	await assert.rejects(executar(b.ctx), (e) => {
		assert.equal(e.constructor.name, 'NodeApiError');
		assert.match(e.message, /did not respond \(rede\)/);
		assert.match(e.description, /same reference/);
		return true;
	});
	assert.equal(b.chamadas.length, 1, 'never retried automatically');

	const c = criarContexto({
		params: { resource: 'company', operation: 'get' },
		http: async () => {
			throw Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
		},
		continueOnFail: true,
	});
	const [saidaC] = await executar(c.ctx);
	assert.equal(saidaC[0].json.code, 'tempo_esgotado');
});

test('Download PDF: binary in "data" named nfse-<number>.pdf, input kept; XML falls back to the invoice ID', async () => {
	const pdf = Buffer.from('%PDF-1.7\n% emissaoja\n');
	const entrada = { json: { pedido: { numero: '123' } }, binary: { anexo: { data: 'eA==', mimeType: 'text/plain' } } };
	const a = criarContexto({
		itens: [entrada],
		params: { resource: 'invoice', operation: 'downloadPdf', origin: 'local', invoiceId: 'n-1/2', invoiceNumber: '123' },
		http: async () => resp(200, pdf, { 'content-type': 'application/pdf' }),
	});
	const [saida] = await executar(a.ctx);
	const [c] = a.chamadas;
	assert.equal(c.method, 'GET');
	assert.equal(c.url, `${SANDBOX}/v1/notas/local/n-1%2F2/pdf`);
	assert.equal(c.encoding, 'arraybuffer');
	const item = saida[0];
	assert.deepEqual(item.json, entrada.json);
	assert.equal(item.binary.data.fileName, 'nfse-123.pdf');
	assert.equal(item.binary.data.mimeType, 'application/pdf');
	assert.deepEqual(Buffer.from(item.binary.data.data, 'base64'), pdf);
	assert.deepEqual(item.binary.anexo, entrada.binary.anexo);
	assert.deepEqual(item.pairedItem, { item: 0 });

	const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><NFSe/>');
	const b = criarContexto({
		params: { resource: 'invoice', operation: 'downloadXml', origin: 'importada', invoiceId: 'abc-123', binaryPropertyName: 'xml' },
		http: async () => resp(200, xml, { 'content-type': 'application/xml' }),
	});
	const [saidaB] = await executar(b.ctx);
	assert.equal(b.chamadas[0].url, `${SANDBOX}/v1/notas/importada/abc-123/xml`);
	assert.equal(saidaB[0].binary.xml.fileName, 'nfse-abc-123.xml');
	assert.equal(saidaB[0].binary.xml.mimeType, 'application/xml');
	assert.equal(Buffer.from(saidaB[0].binary.xml.data, 'base64').toString('utf8'), xml.toString('utf8'));
});

test('Download PDF: a JSON error body in bytes becomes NodeApiError; an empty invoice ID fails locally', async () => {
	const erro = Buffer.from(JSON.stringify({ status: 'ERROR', code: 'nota_nao_encontrada', message: 'Nota não encontrada.' }));
	const a = criarContexto({
		params: { resource: 'invoice', operation: 'downloadPdf', origin: 'local', invoiceId: 'nao-existe' },
		http: async () => resp(404, erro, { 'content-type': 'application/json' }),
	});
	await assert.rejects(executar(a.ctx), (e) => {
		assert.equal(e.constructor.name, 'NodeApiError');
		assert.match(e.message, /nota_nao_encontrada \(HTTP 404\)/);
		assert.match(e.description, /Nota não encontrada\./);
		return true;
	});

	const b = criarContexto({
		params: { resource: 'invoice', operation: 'downloadPdf', origin: 'local', invoiceId: '' },
		http: async () => assert.fail('no call'),
	});
	await assert.rejects(executar(b.ctx), /Invoice ID/);
});

test('Wait for Authorization: checks again after proxima_consulta_ms until a final state', async () => {
	const fila = [
		resp(200, { pedido: { id: 'p1', estado: 'na_fila', proxima_consulta_ms: 1200 } }),
		resp(200, { pedido: { id: 'p1', estado: 'autorizada', numero: '123', nota: { origem: 'local', id: 'n1' }, proxima_consulta_ms: null } }),
	];
	const { ctx, chamadas } = criarContexto({
		params: { resource: 'invoice', operation: 'waitForAuthorization', issuanceId: 'p1', maxWait: 60 },
		http: async () => fila.shift(),
	});
	const t0 = Date.now();
	const [saida] = await executar(ctx);
	const decorrido = Date.now() - t0;
	assert.ok(decorrido >= 1150, `waited ${decorrido} ms, expected about 1200 ms`);
	assert.ok(decorrido < 5000, `waited ${decorrido} ms`);
	assert.equal(chamadas.length, 2);
	assert.ok(chamadas.every((c) => c.method === 'GET' && c.url === `${SANDBOX}/v1/emissoes/p1`));
	assert.equal(saida[0].json.pedido.estado, 'autorizada');
	assert.deepEqual(saida[0].json.pedido.nota, { origem: 'local', id: 'n1' });
});

test('Wait for Authorization: tempo_esgotado after Max Wait, with the last state for continueOnFail', async () => {
	const http = async () => resp(200, { pedido: { id: 'p9', estado: 'emitindo', proxima_consulta_ms: 5000 } });
	const params = { resource: 'invoice', operation: 'waitForAuthorization', issuanceId: 'p9', maxWait: 1 };
	const a = criarContexto({ params, http });
	const t0 = Date.now();
	await assert.rejects(executar(a.ctx), (e) => {
		assert.equal(e.constructor.name, 'NodeOperationError');
		assert.match(e.message, /tempo_esgotado/);
		assert.match(e.description, /Get Issuance Status/);
		return true;
	});
	const decorrido = Date.now() - t0;
	assert.ok(decorrido >= 900 && decorrido < 3000, `gave up after ${decorrido} ms`);
	assert.ok(a.chamadas.length >= 2);

	const b = criarContexto({ params, http, continueOnFail: true });
	const [saida] = await executar(b.ctx);
	assert.equal(saida[0].json.code, 'tempo_esgotado');
	assert.equal(saida[0].json.pedido_id, 'p9');
	assert.equal(saida[0].json.pedido.estado, 'emitindo');
});

test('Get Issuance Status: GET /v1/emissoes/{id} with the ID encoded', async () => {
	const { ctx, chamadas } = criarContexto({
		params: { resource: 'invoice', operation: 'getIssuance', issuanceId: 'a b/c' },
		http: async () => resp(200, { pedido: { id: 'a b/c', estado: 'confirmando' } }),
	});
	const [saida] = await executar(ctx);
	assert.equal(chamadas[0].url, `${SANDBOX}/v1/emissoes/a%20b%2Fc`);
	assert.equal(saida[0].json.pedido.estado, 'confirmando');
	// GET: no body, so no Content-Type and no json flag (Accept is sent explicitly).
	assert.equal(chamadas[0].method, 'GET');
	assert.equal(chamadas[0].body, undefined);
	assert.equal(chamadas[0].json, false);
	assert.equal('Content-Type' in chamadas[0].headers, false);
	assert.equal(chamadas[0].headers.Accept, 'application/json');
});

test('POST without a body (e.g. /conferir): no JSON Content-Type, and axios is kept from adding form-urlencoded', async () => {
	// The API (Fastify) answers 400 to "Content-Type: application/json" with an empty body and 415 to the
	// application/x-www-form-urlencoded that axios adds by default to a body-less POST.
	const { ctx, chamadas } = criarContexto({ params: {}, http: async () => resp(200, { pedido: { id: 'p1', estado: 'autorizada' } }) });
	const client = new EmissaojaClient(ctx, SANDBOX);
	for (const opcoes of [{}, { body: {} }]) {
		const corpo = await client.json('POST', '/v1/emissoes/p1/conferir', opcoes, 0);
		assert.equal(corpo.pedido.estado, 'autorizada');
	}
	for (const c of chamadas) {
		assert.equal(c.method, 'POST');
		assert.equal(c.url, `${SANDBOX}/v1/emissoes/p1/conferir`);
		assert.equal(c.body, undefined);
		assert.equal(c.json, false);
		assert.equal(c.headers['Content-Type'], false);
	}
});

test('Get Many invoices: one item per invoice, follows the cursor, no empty query values', async () => {
	const fila = [
		resp(200, { notas: [{ id: 'n1' }, { id: 'n2' }], total: 3, janela_cheia: false, proximo_cursor: 'c2' }),
		resp(200, { notas: [{ id: 'n3' }], total: 3, janela_cheia: false, proximo_cursor: null }),
	];
	const { ctx, chamadas } = criarContexto({
		params: { resource: 'invoice', operation: 'getAll', returnAll: true, filters: { period: '', status: 'emitidas', search: '' } },
		http: async () => fila.shift(),
	});
	const [saida] = await executar(ctx);
	assert.deepEqual(saida.map((s) => s.json.id), ['n1', 'n2', 'n3']);
	assert.ok(saida.every((s) => s.pairedItem.item === 0));
	assert.equal(chamadas[0].url, `${SANDBOX}/v1/notas`);
	assert.deepEqual(chamadas[0].qs, { situacao: 'emitidas', limite: 50 });
	assert.deepEqual(chamadas[1].qs, { situacao: 'emitidas', limite: 50, cursor: 'c2' });
});

test('Get Many invoices: From/To dates switch to the custom period; Limit caps the page size', async () => {
	const { ctx, chamadas } = criarContexto({
		params: { resource: 'invoice', operation: 'getAll', returnAll: false, limit: 5, filters: { fromDate: '2026-10-01T00:00:00', toDate: '2026-10-31' } },
		http: async () => resp(200, { notas: [{ id: 'n1' }], proximo_cursor: null }),
	});
	await executar(ctx);
	assert.deepEqual(chamadas[0].qs, { periodo: 'personalizado', de: '2026-10-01', ate: '2026-10-31', limite: 5 });
});

test('Customer: Create sends documento/nome; Get Many with Return All pages through pagina', async () => {
	const a = criarContexto({
		params: { resource: 'customer', operation: 'create', document: '529.982.247-25', name: ' Maria da Silva ' },
		http: async () => resp(201, { tomador: { tipo: 'pf', id: 't1' }, ja_existia: false }),
	});
	const [saidaA] = await executar(a.ctx);
	assert.equal(a.chamadas[0].url, `${SANDBOX}/v1/tomadores`);
	assert.deepEqual(a.chamadas[0].body, { documento: '529.982.247-25', nome: 'Maria da Silva' });
	assert.equal(saidaA[0].json.tomador.id, 't1');

	const pagina1 = Array.from({ length: 50 }, (_, k) => ({ tipo: 'pj', id: `t${k}` }));
	const fila = [resp(200, { tomadores: pagina1, total: 51, pagina: 1, limite: 50 }), resp(200, { tomadores: [{ tipo: 'pf', id: 't50' }], total: 51, pagina: 2, limite: 50 })];
	const b = criarContexto({
		params: { resource: 'customer', operation: 'getAll', returnAll: true, searchTerm: '' },
		http: async () => fila.shift(),
	});
	const [saidaB] = await executar(b.ctx);
	assert.equal(saidaB.length, 51);
	assert.deepEqual(b.chamadas.map((c) => c.qs), [{ pagina: 1, limite: 50 }, { pagina: 2, limite: 50 }]);
});

test('Customer Search and Service Get Many return one item per record', async () => {
	const a = criarContexto({
		params: { resource: 'customer', operation: 'search', query: 'Alfa' },
		http: async () => resp(200, { tomadores: [{ id: 't1' }, { id: 't2' }] }),
	});
	const [saidaA] = await executar(a.ctx);
	assert.deepEqual(a.chamadas[0].qs, { q: 'Alfa' });
	assert.deepEqual(saidaA.map((s) => s.json.id), ['t1', 't2']);

	const b = criarContexto({
		params: { resource: 'service', operation: 'getAll', status: 'todos', returnAll: false, limit: 1 },
		http: async () => resp(200, { servicos: [{ id: 's1' }, { id: 's2' }] }),
	});
	const [saidaB] = await executar(b.ctx);
	assert.deepEqual(b.chamadas[0].qs, { ativos: 'todos' });
	assert.deepEqual(saidaB.map((s) => s.json.id), ['s1']);
});

test('Cancel: motivo and justificativa in the body; Wait for Result follows the operation', async () => {
	const fila = [
		resp(202, { operacao: { id: 'op1', tipo: 'cancelamento', estado: 'processando' } }),
		resp(200, { operacao: { id: 'op1', tipo: 'cancelamento', estado: 'concluida', resultado: { situacao: 'cancelada' } } }),
	];
	const { ctx, chamadas } = criarContexto({
		params: {
			resource: 'invoice',
			operation: 'cancel',
			origin: 'local',
			invoiceId: 'n1',
			reason: '2',
			justification: 'Serviço não foi prestado ao cliente.',
			waitForResult: true,
		},
		http: async () => fila.shift(),
	});
	const [saida] = await executar(ctx);
	assert.equal(chamadas[0].method, 'POST');
	assert.equal(chamadas[0].url, `${SANDBOX}/v1/notas/local/n1/cancelar`);
	assert.deepEqual(chamadas[0].body, { motivo: '2', justificativa: 'Serviço não foi prestado ao cliente.' });
	assert.equal(chamadas[0].headers['Content-Type'], 'application/json');
	assert.equal(chamadas[0].json, true);
	assert.equal(chamadas[1].url, `${SANDBOX}/v1/operacoes/op1`);
	assert.equal(chamadas[1].method, 'GET');
	assert.equal('Content-Type' in chamadas[1].headers, false);
	assert.equal(saida[0].json.operacao.estado, 'concluida');
});

test('CNPJ Look Up: punctuation removed, a number is padded to 14 digits, Production base URL', async () => {
	const { ctx, chamadas } = criarContexto({
		itens: [{}, {}],
		params: (i) => ({ resource: 'cnpj', operation: 'lookUp', cnpj: i === 0 ? '12.345.678/0001-95' : 191 }),
		http: async () => resp(200, { razao_social: 'EMPRESA' }),
		credenciais: { chave: 'ej_live_chave', ambiente: 'https://emissaoja.com.br/' },
	});
	const [saida] = await executar(ctx);
	assert.deepEqual(chamadas.map((c) => c.url), [
		'https://emissaoja.com.br/v1/cnpj/12345678000195',
		'https://emissaoja.com.br/v1/cnpj/00000000000191',
	]);
	assert.equal(saida[1].json.razao_social, 'EMPRESA');
});

test('examples/emitir-nfse-planilha.json only uses operations and parameters the node defines', () => {
	const exemplo = require('../examples/emitir-nfse-planilha.json');
	const { properties } = new Emissaoja().description;
	const visivel = (p, params) =>
		Object.entries(p.displayOptions?.show ?? {}).every(([campo, valores]) => valores.includes(params[campo]));
	const nossos = exemplo.nodes.filter((n) => n.type === 'n8n-nodes-emissaoja.emissaoja');
	assert.equal(nossos.length, 4);
	for (const node of nossos) {
		const params = { resource: 'invoice', operation: 'issue', ...node.parameters };
		const operacoes = properties.find((p) => p.name === 'operation' && visivel(p, params));
		assert.ok(operacoes.options.some((o) => o.value === params.operation), `${node.name}: ${params.operation}`);
		for (const nome of Object.keys(node.parameters)) {
			assert.ok(
				properties.some((p) => p.name === nome && visivel(p, params)),
				`${node.name}: unknown parameter ${nome}`,
			);
		}
		assert.equal(node.credentials, undefined, 'no credential baked into the example');
	}
	const nomes = new Set(exemplo.nodes.map((n) => n.name));
	for (const [origem, saida] of Object.entries(exemplo.connections)) {
		assert.ok(nomes.has(origem));
		for (const destino of saida.main.flat()) assert.ok(nomes.has(destino.node));
	}
});

// ------------------------------------------------------------------ sandbox (optional)

test(
	'sandbox: company, customer, issue, wait and PDF (needs EMISSAOJA_TEST_KEY)',
	{ skip: SANDBOX_KEY ? false : 'set EMISSAOJA_TEST_KEY (ej_test_...) to call the sandbox', timeout: 180000 },
	async (t) => {
		const rodar = async (params, itens = [{}]) => {
			const { ctx } = criarContexto({ itens, params, http: httpReal, credenciais: { chave: SANDBOX_KEY, ambiente: SANDBOX } });
			return (await executar(ctx))[0];
		};

		const [empresa] = await rodar({ resource: 'company', operation: 'get' });
		console.log('empresa ->', JSON.stringify(empresa.json.empresa), JSON.stringify(empresa.json.onboarding));
		if (!empresa.json.empresa) {
			t.skip('connect the example company 11111111000191 in https://sandbox.emissaoja.com.br/app first');
			return;
		}

		const [cliente] = await rodar({ resource: 'customer', operation: 'create', document: '12345678000195' });
		assert.equal(cliente.json.tomador.tipo, 'pj');

		const referencia = `n8n-teste-${Date.now()}`;
		let pedido;
		try {
			[pedido] = await rodar({
				resource: 'invoice',
				operation: 'issue',
				reference: referencia,
				customerType: cliente.json.tomador.tipo,
				customerId: cliente.json.tomador.id,
				amount: 10,
				description: 'Teste do n8n-nodes-emissaoja no sandbox',
			});
		} catch (e) {
			if (/limite_notas/.test(e.message)) {
				t.skip('monthly invoice limit of the sandbox account reached');
				return;
			}
			throw e;
		}
		const [final] = await rodar({ resource: 'invoice', operation: 'waitForAuthorization', issuanceId: pedido.json.pedido.id, maxWait: 120 });
		console.log('pedido ->', JSON.stringify(final.json.pedido));
		assert.ok(['autorizada', 'recusada', 'incerta'].includes(final.json.pedido.estado));
		if (final.json.pedido.estado !== 'autorizada') return;

		const [arquivo] = await rodar(
			{
				resource: 'invoice',
				operation: 'downloadPdf',
				origin: final.json.pedido.nota.origem,
				invoiceId: final.json.pedido.nota.id,
				invoiceNumber: final.json.pedido.numero ?? '',
			},
			[final],
		);
		const bytes = Buffer.from(arquivo.binary.data.data, 'base64');
		assert.equal(bytes.subarray(0, 4).toString('latin1'), '%PDF');
	},
);
