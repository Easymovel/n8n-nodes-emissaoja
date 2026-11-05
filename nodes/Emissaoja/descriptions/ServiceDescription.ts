import type { INodeProperties } from 'n8n-workflow';

const showOnGetMany = {
	show: {
		resource: ['service'],
		operation: ['getAll'],
	},
};

export const serviceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['service'],
			},
		},
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many services',
				action: 'Get many services',
			},
		],
		default: 'getAll',
	},
];

export const serviceFields: INodeProperties[] = [
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		options: [
			{
				name: 'Active',
				value: '1',
			},
			{
				name: 'All',
				value: 'todos',
			},
			{
				name: 'Inactive',
				value: '0',
			},
		],
		default: '1',
		description: 'Which services to return',
		displayOptions: showOnGetMany,
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: showOnGetMany,
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
				resource: ['service'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
	},
];
