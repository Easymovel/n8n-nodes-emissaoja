import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { cnpjFields, cnpjOperations } from './descriptions/CnpjDescription';
import { companyOperations } from './descriptions/CompanyDescription';
import { customerFields, customerOperations } from './descriptions/CustomerDescription';
import { invoiceFields, invoiceOperations } from './descriptions/InvoiceDescription';
import { serviceFields, serviceOperations } from './descriptions/ServiceDescription';
import { runOperation } from './shared/operations';
import { EmissaojaClient, getBaseUrl, getErrorDetails } from './shared/transport';

export class Emissaoja implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'emissaoja',
		name: 'emissaoja',
		icon: { light: 'file:../../icons/emissaoja.svg', dark: 'file:../../icons/emissaoja.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle:
			'={{ {"cnpj:lookUp": "Look up CNPJ", "company:get": "Get company", "customer:create": "Create customer", "customer:get": "Get customer", "customer:getAll": "Get many customers", "customer:search": "Search customers", "service:getAll": "Get many services", "invoice:cancel": "Cancel invoice", "invoice:downloadPdf": "Download PDF", "invoice:downloadXml": "Download XML", "invoice:getIssuance": "Get issuance status", "invoice:getAll": "Get many invoices", "invoice:issue": "Issue invoice", "invoice:waitForAuthorization": "Wait for authorization"}[$parameter["resource"] + ":" + $parameter["operation"]] }}',
		description:
			'Issue NFS-e (Brazilian service invoices) in the Emissor Nacional, without a digital certificate',
		defaults: {
			name: 'emissaoja',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'emissaojaApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'CNPJ',
						value: 'cnpj',
						description: 'Registration data of a Brazilian company (Receita Federal)',
					},
					{
						name: 'Company',
						value: 'company',
						description: 'The company connected to your emissaoja account',
					},
					{
						name: 'Customer',
						value: 'customer',
						description: 'Who receives the service and the invoice (tomador)',
					},
					{
						name: 'Invoice',
						value: 'invoice',
						description: 'NFS-e issued in the Emissor Nacional',
					},
					{
						name: 'Service',
						value: 'service',
						description: 'Services registered for the company',
					},
				],
				default: 'invoice',
			},
			...cnpjOperations,
			...cnpjFields,
			...companyOperations,
			...customerOperations,
			...customerFields,
			...invoiceOperations,
			...invoiceFields,
			...serviceOperations,
			...serviceFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const client = new EmissaojaClient(this, await getBaseUrl(this));

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				returnData.push(...(await runOperation.call(this, client, itemIndex)));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message, ...getErrorDetails(error) },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				// Errors built by this node already carry message, description and item index: re-wrapping a
				// NodeApiError or NodeOperationError returns the same error object.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
