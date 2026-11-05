import type { INodeProperties } from 'n8n-workflow';

const showOn = (...operation: string[]) => ({
	show: {
		resource: ['invoice'],
		operation,
	},
});

export const invoiceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['invoice'],
			},
		},
		options: [
			{
				name: 'Cancel',
				value: 'cancel',
				description: 'Cancel an issued invoice, within the Emissor Nacional deadline',
				action: 'Cancel an invoice',
			},
			{
				name: 'Download PDF',
				value: 'downloadPdf',
				description: 'Download the invoice PDF (DANFSe) as binary data',
				action: 'Download the PDF of an invoice',
			},
			{
				name: 'Download XML',
				value: 'downloadXml',
				description: 'Download the invoice XML as binary data',
				action: 'Download the XML of an invoice',
			},
			{
				name: 'Get Issuance Status',
				value: 'getIssuance',
				description: 'Get the current state of an issuance request',
				action: 'Get the status of an issuance',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many invoices',
				action: 'Get many invoices',
			},
			{
				name: 'Issue',
				value: 'issue',
				description: 'Issue an NFS-e: preview and issuance in one step',
				action: 'Issue an invoice',
			},
			{
				name: 'Wait for Authorization',
				value: 'waitForAuthorization',
				description:
					'Check an issuance request until it is authorized, refused or uncertain (autorizada, recusada or incerta)',
				action: 'Wait for the authorization of an invoice',
			},
		],
		default: 'issue',
	},
];

const customerTypeOptions = [
	{
		name: 'Company (CNPJ)',
		value: 'pj',
	},
	{
		name: 'Person (CPF)',
		value: 'pf',
	},
];

export const invoiceFields: INodeProperties[] = [
	// ---------------------------------------------------------------- issue
	{
		displayName: 'Reference',
		name: 'reference',
		type: 'string',
		required: true,
		default: '',
		hint: 'Suggested expression: nfse-{{ $execution.id }}-{{ $itemIndex }} (or an ID from your data, such as the order number)',
		description:
			'Your unique ID for this invoice, sent as the Idempotency-Key header: running again with the same reference returns the same order instead of issuing a second invoice. 8 to 64 characters: letters, numbers, _ and -.',
		displayOptions: showOn('issue'),
	},
	{
		displayName: 'Customer Type',
		name: 'customerType',
		type: 'options',
		options: customerTypeOptions,
		default: 'pj',
		description:
			'Type of the customer that receives the invoice, as returned by Customer > Create or Search',
		displayOptions: showOn('issue'),
	},
	{
		displayName: 'Customer ID',
		name: 'customerId',
		type: 'string',
		required: true,
		default: '',
		description:
			'ID of the customer that receives the invoice, as returned by Customer > Create or Search',
		displayOptions: showOn('issue'),
	},
	{
		displayName: 'Amount',
		name: 'amount',
		type: 'number',
		required: true,
		typeOptions: {
			numberPrecision: 2,
		},
		default: 0,
		description: 'Invoice amount in reais (BRL), with up to 2 decimal places',
		displayOptions: showOn('issue'),
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		typeOptions: {
			rows: 3,
		},
		default: '',
		description:
			'Text of the invoice, up to 2000 characters. Leave empty to use the description of the service.',
		displayOptions: showOn('issue'),
	},
	{
		displayName: 'Service Date',
		name: 'serviceDate',
		type: 'dateTime',
		default: '',
		description:
			'Date the service was provided (competência), sent as YYYY-MM-DD. Leave empty to use today.',
		displayOptions: showOn('issue'),
	},
	{
		displayName: 'Service ID',
		name: 'serviceId',
		type: 'string',
		default: '',
		description:
			'ID of the service, as returned by Service > Get Many. Leave empty to use the main service of the company.',
		displayOptions: showOn('issue'),
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showOn('issue'),
		options: [
			{
				displayName: 'Allow Repeat Of',
				name: 'allowRepeatOf',
				type: 'string',
				default: '',
				description:
					'After a possivel_duplicada error: the order of the identical invoice issued today (nota_igual_recente), sent as permitir_repetida_de to confirm that this is a new invoice',
			},
			{
				displayName: 'Confirm Repeat',
				name: 'confirmRepeat',
				type: 'boolean',
				default: false,
				description:
					'Whether to confirm an identical invoice requested less than 2 minutes ago, after an emissao_repetida_recente error (sent as confirmo_repeticao)',
			},
			{
				displayName: 'ISS Rate (%)',
				name: 'issRate',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 100,
					numberPrecision: 2,
				},
				default: 0,
				description:
					'ISS rate in percent, sent as aliquota_iss. Only when a bloqueio of the API asks for it.',
			},
			{
				displayName: 'Retain ISS',
				name: 'retainIss',
				type: 'boolean',
				default: false,
				description:
					'Whether the customer withholds the ISS, sent as retem_iss. Only when a bloqueio of the API asks for it.',
			},
			{
				displayName: 'Service City Code',
				name: 'serviceCityCode',
				type: 'string',
				default: '',
				placeholder: 'e.g. 3106200',
				description:
					'IBGE code (7 digits) of the city where the service was provided, sent as municipio_prestacao. Only when a bloqueio of the API asks for it.',
			},
		],
	},

	// ---------------------------------------------------------------- getIssuance, waitForAuthorization
	{
		displayName: 'Issuance ID',
		name: 'issuanceId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the issuance request (pedido), as returned by Issue',
		displayOptions: showOn('getIssuance', 'waitForAuthorization'),
	},
	{
		displayName: 'Max Wait (Seconds)',
		name: 'maxWait',
		type: 'number',
		typeOptions: {
			minValue: 1,
			maxValue: 120,
		},
		default: 60,
		description:
			'How long to keep checking before failing with tempo_esgotado, up to 120 seconds. Between checks the node waits as long as the API asks (proxima_consulta_ms).',
		displayOptions: showOn('waitForAuthorization'),
	},

	// ---------------------------------------------------------------- getAll
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: showOn('getAll'),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: {
			minValue: 1,
		},
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: {
				resource: ['invoice'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showOn('getAll'),
		options: [
			{
				displayName: 'From Date',
				name: 'fromDate',
				type: 'dateTime',
				default: '',
				description: 'Start of a custom period. With From Date and To Date, the period is Custom.',
			},
			{
				displayName: 'Period',
				name: 'period',
				type: 'options',
				options: [
					{
						name: 'Current Month',
						value: 'mes_atual',
					},
					{
						name: 'Current Year',
						value: 'ano_atual',
					},
					{
						name: 'Custom',
						value: 'personalizado',
					},
					{
						name: 'Last 12 Months',
						value: '12_meses',
					},
					{
						name: 'Previous Month',
						value: 'mes_anterior',
					},
				],
				default: '12_meses',
				description: 'Issue date range. Custom uses From Date and To Date.',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Invoice number, or name or document of the customer',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{
						name: 'All',
						value: 'todas',
					},
					{
						name: 'Cancelled',
						value: 'canceladas',
					},
					{
						name: 'Issued',
						value: 'emitidas',
					},
				],
				default: 'todas',
				description: 'Whether to return issued invoices, cancelled invoices or both',
			},
			{
				displayName: 'To Date',
				name: 'toDate',
				type: 'dateTime',
				default: '',
				description: 'End of a custom period',
			},
		],
	},

	// ---------------------------------------------------------------- downloadPdf, downloadXml, cancel
	{
		displayName: 'Origin',
		name: 'origin',
		type: 'options',
		options: [
			{
				name: 'Imported',
				value: 'importada',
				description: 'Imported from the Emissor Nacional',
			},
			{
				name: 'Local',
				value: 'local',
				description: 'Issued through emissaoja',
			},
		],
		default: 'local',
		description:
			'Where the invoice comes from, as returned by Wait for Authorization (nota origem) or Get Many (origem)',
		displayOptions: showOn('downloadPdf', 'downloadXml', 'cancel'),
	},
	{
		displayName: 'Invoice ID',
		name: 'invoiceId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the invoice (nota), as returned by Wait for Authorization or Get Many',
		displayOptions: showOn('downloadPdf', 'downloadXml', 'cancel'),
	},
	{
		displayName: 'Invoice Number',
		name: 'invoiceNumber',
		type: 'string',
		default: '',
		description:
			'Used only in the file name (nfse-NUMBER.pdf). Leave empty to name the file after the invoice ID.',
		displayOptions: showOn('downloadPdf', 'downloadXml'),
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		description: 'Name of the output binary field to put the file in',
		displayOptions: showOn('downloadPdf', 'downloadXml'),
	},
	{
		displayName: 'Reason',
		name: 'reason',
		type: 'options',
		options: [
			{
				name: 'Error in Issuance',
				value: '1',
			},
			{
				name: 'Service Not Provided',
				value: '2',
			},
		],
		default: '1',
		description: 'Why the invoice is being cancelled',
		displayOptions: showOn('cancel'),
	},
	{
		displayName: 'Justification',
		name: 'justification',
		type: 'string',
		typeOptions: {
			rows: 2,
		},
		default: '',
		description: 'Optional explanation, 15 to 255 characters',
		displayOptions: showOn('cancel'),
	},
	{
		displayName: 'Wait for Result',
		name: 'waitForResult',
		type: 'boolean',
		default: false,
		description:
			'Whether to wait up to 120 seconds for the cancellation to finish and return its final state. Otherwise the node returns right away, with the operation still processing.',
		displayOptions: showOn('cancel'),
	},
];
