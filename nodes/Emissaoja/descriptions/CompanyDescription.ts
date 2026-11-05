import type { INodeProperties } from 'n8n-workflow';

export const companyOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['company'],
			},
		},
		options: [
			{
				name: 'Get',
				value: 'get',
				description:
					'Get the connected company, the status of its Emissor Nacional credential and pending notices',
				action: 'Get the company',
			},
		],
		default: 'get',
	},
];
