import type { INodeProperties } from 'n8n-workflow';

const showOn = (operation: string) => ({
	show: {
		resource: ['customer'],
		operation: [operation],
	},
});

export const customerOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['customer'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description:
					'Create a customer from a CNPJ (filled from Receita Federal) or from a CPF and name. An existing customer is returned as is.',
				action: 'Create a customer',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get the full record of a customer',
				action: 'Get a customer',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many customers',
				action: 'Get many customers',
			},
			{
				name: 'Search',
				value: 'search',
				description: 'Search customers by name or document',
				action: 'Search customers',
			},
		],
		default: 'create',
	},
];

export const customerFields: INodeProperties[] = [
	// ---------------------------------------------------------------- create
	{
		displayName: 'Document',
		name: 'document',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 12.345.678/0001-95',
		description: 'CNPJ or CPF of the customer, with or without punctuation',
		displayOptions: showOn('create'),
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		placeholder: 'e.g. Maria da Silva',
		description:
			'Full name (first and last name), required for a CPF. For a CNPJ, the name comes from Receita Federal.',
		displayOptions: showOn('create'),
	},

	// ---------------------------------------------------------------- get
	{
		displayName: 'Customer Type',
		name: 'customerType',
		type: 'options',
		options: [
			{
				name: 'Company (CNPJ)',
				value: 'pj',
			},
			{
				name: 'Person (CPF)',
				value: 'pf',
			},
		],
		default: 'pj',
		description: 'Type of the customer, as returned by Create or Search',
		displayOptions: showOn('get'),
	},
	{
		displayName: 'Customer ID',
		name: 'customerId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the customer, as returned by Create or Search',
		displayOptions: showOn('get'),
	},

	// ---------------------------------------------------------------- search
	{
		displayName: 'Search Term',
		name: 'query',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Alfa',
		description: 'Name or document of the customer, at least 2 characters',
		displayOptions: showOn('search'),
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
			maxValue: 50,
		},
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: {
				resource: ['customer'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
	},
	{
		displayName: 'Page',
		name: 'page',
		type: 'number',
		typeOptions: {
			minValue: 1,
		},
		default: 1,
		description: 'Page of results to return, with Limit customers per page',
		displayOptions: {
			show: {
				resource: ['customer'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
	},
	{
		displayName: 'Search Term',
		name: 'searchTerm',
		type: 'string',
		default: '',
		description: 'Only customers whose name or document contains this text',
		displayOptions: showOn('getAll'),
	},
];
