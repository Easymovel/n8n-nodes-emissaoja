import type { INodeProperties } from 'n8n-workflow';

export const cnpjOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['cnpj'],
			},
		},
		options: [
			{
				name: 'Look Up',
				value: 'lookUp',
				description:
					'Get the Receita Federal registration data of a CNPJ (it does not create a customer)',
				action: 'Look up a CNPJ',
			},
		],
		default: 'lookUp',
	},
];

export const cnpjFields: INodeProperties[] = [
	{
		displayName: 'CNPJ',
		name: 'cnpj',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 12.345.678/0001-95',
		description: 'CNPJ with or without punctuation',
		displayOptions: {
			show: {
				resource: ['cnpj'],
				operation: ['lookUp'],
			},
		},
	},
];
