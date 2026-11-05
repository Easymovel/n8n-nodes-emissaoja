import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class EmissaojaApi implements ICredentialType {
	name = 'emissaojaApi';

	// The credential linter requires title case here; everywhere else the brand is written "emissaoja".
	displayName = 'Emissaoja API';

	icon: Icon = { light: 'file:../icons/emissaoja.svg', dark: 'file:../icons/emissaoja.dark.svg' };

	documentationUrl = 'https://emissaoja.com.br/docs/';

	properties: INodeProperties[] = [
		{
			displayName:
				'Create the key in the emissaoja app under Conta → API (it is shown only once). Production keys start with ej_live_. Sandbox keys start with ej_test_ and only work in the sandbox. No account yet? Sign up at <a href="https://emissaoja.com.br/?origem=lib-n8n" target="_blank">emissaoja.com.br</a>.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		// "chave" is Portuguese for "key": this field holds the secret API key, so it must stay masked.
		// eslint-disable-next-line @n8n/community-nodes/credential-unnecessary-password
		{
			displayName: 'API Key',
			name: 'chave',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. ej_live_...',
			description:
				'Your emissaoja API key: ej_live_... for production, ej_test_... for the sandbox',
		},
		{
			displayName: 'Environment',
			name: 'ambiente',
			type: 'options',
			options: [
				{
					name: 'Production',
					value: 'https://emissaoja.com.br',
					description: 'Real invoices in the Emissor Nacional (ej_live_ keys)',
				},
				{
					name: 'Sandbox',
					value: 'https://sandbox.emissaoja.com.br',
					description:
						'Simulated Emissor Nacional, nothing reaches the tax authority (ej_test_ keys)',
				},
			],
			default: 'https://emissaoja.com.br',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.chave}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.ambiente}}',
			url: '/v1/empresa',
			method: 'GET',
			headers: {
				Accept: 'application/json',
			},
		},
	};
}
