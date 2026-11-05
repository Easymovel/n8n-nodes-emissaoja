# n8n-nodes-emissaoja: API de NFS-e nacional para n8n

[![npm](https://img.shields.io/npm/v/n8n-nodes-emissaoja.svg)](https://www.npmjs.com/package/n8n-nodes-emissaoja)
[![licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE.md)

[English summary below](#in-english)

Community node oficial do [emissaoja](https://emissaoja.com.br) para o [n8n](https://n8n.io): **emita NFS-e (nota
fiscal de serviço eletrônica) no Emissor Nacional sem certificado digital**, só com o CNPJ e a senha do portal, para
**MEI e empresas do Simples Nacional**. Cadastre tomadores, emita a nota, acompanhe até a autorização e baixe o
**PDF (DANFSe)** e o **XML** dentro dos seus workflows, ou deixe um **AI Agent** consultar notas e clientes.

- Sem certificado digital: o emissaoja entra no Emissor Nacional com o CNPJ e a senha do portal.
- Sem nota em dobro: a referência de cada nota vai no cabeçalho `Idempotency-Key`; repetir a mesma referência
  devolve o mesmo pedido.
- PDF e XML como dados binários, prontos para um node de e-mail, Google Drive ou S3.
- Espera a autorização no ritmo que a API pede (`proxima_consulta_ms`).
- Erros com o `code` da API e os bloqueios explicados; com **On Error > Continue**, o item sai com `code`,
  `bloqueios` e `request_id`.
- Ambiente de testes (sandbox) gratuito: nada vai ao fisco.
- Sem dependências em tempo de execução. Pode ser usado como ferramenta do AI Agent.

> A interface do node está em inglês, o padrão do n8n para nodes verificados. Neste README os nomes aparecem como no
> n8n: **Customer** é o tomador, **Invoice** é a nota, **Issue** é emitir.

## Instalação

### n8n self-hosted (pela interface)

1. Abra **Settings > Community Nodes**.
2. Clique em **Install**.
3. Digite `n8n-nodes-emissaoja`, marque a confirmação de risco e clique em **Install**.

O node aparece no painel como **emissaoja** (busque por "NFS-e", "nota fiscal" ou "emissaoja"). Veja também a
[documentação do n8n sobre community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

### Instalação manual (Docker, modo fila ou sem acesso à interface)

```bash
# dentro do container ou servidor do n8n
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install n8n-nodes-emissaoja
# reinicie o n8n
```

> No n8n Cloud só aparecem community nodes verificados pelo n8n.

## Credencial

1. Entre no app com a sua conta Google em <https://emissaoja.com.br/app> e aceite os termos. Ainda não tem conta?
   [Cadastre-se](https://emissaoja.com.br/?origem=lib-n8n).
2. Conecte a empresa no app com o CNPJ e a senha do Emissor Nacional.
3. Em **Conta → API**, crie uma chave. Ela aparece uma vez (prefixo `ej_live_`): guarde como senha.
4. No n8n, crie uma credencial **Emissaoja API**: cole a chave em **API Key** e escolha o **Environment**:
   **Production** (`https://emissaoja.com.br`) ou **Sandbox** (`https://sandbox.emissaoja.com.br`).
5. Clique em **Save**: o n8n testa a chave com `GET /v1/empresa`.

Chaves `ej_test_` só valem no Sandbox e chaves `ej_live_` só em Production. A chave é secreta e dá acesso à emissão em
nome da empresa: deixe-a só na credencial (o n8n guarda criptografado), nunca em expressões, nodes Code, planilhas
ou páginas no navegador.

## Teste no sandbox em 2 minutos

1. Em <https://sandbox.emissaoja.com.br>, entre com a conta Google, aceite os termos e conecte a empresa de exemplo
   `11111111000191` (qualquer senha, exceto `errada`). Crie uma chave em **Conta → API** (começa com `ej_test_`).
2. No n8n, crie a credencial **Emissaoja API** com essa chave e **Environment = Sandbox**.
3. Monte o fluxo abaixo (ou importe o [exemplo](#exemplo-de-workflow)), um node **emissaoja** por passo:

| Passo | Resource > Operation | Campos |
| --- | --- | --- |
| 1 | **Customer > Create** | Document: `12345678000195` |
| 2 | **Invoice > Issue** | Reference: `nfse-{{ $execution.id }}-{{ $itemIndex }}` · Customer Type: `{{ $json.tomador.tipo }}` · Customer ID: `{{ $json.tomador.id }}` · Amount: `150` · Description: `Consultoria de novembro` |
| 3 | **Invoice > Wait for Authorization** | Issuance ID: `{{ $json.pedido.id }}` |
| 4 | **Invoice > Download PDF** | Origin: `{{ $json.pedido.nota.origem }}` · Invoice ID: `{{ $json.pedido.nota.id }}` · Invoice Number: `{{ $json.pedido.numero }}` |

4. Clique em **Execute workflow**. O último node devolve o PDF no campo binário `data`, com o nome
   `nfse-<número>.pdf`.

No sandbox alguns valores têm significado: `13.13` termina `incerta` (ao conferir, vira autorizada), `77.77` termina
`incerta` que não saiu, `66.66` termina `recusada` e `99.99` para num bloqueio já na prévia (`nota_bloqueada`).
Tomadores de exemplo: CNPJ `12345678000195` e CPF `52998224725`. A empresa conectada e as notas do sandbox continuam lá
quando o emissaoja publica uma versão nova.

## Em produção

Troque a credencial para **Environment = Production** e uma chave `ej_live_`, com a empresa real conectada no app.
O workflow não muda. Lembre que **Issue** e **Cancel** têm efeito fiscal real e que a chave é secreta.

## Operações

| Resource | Operation | O que faz | Endpoint |
| --- | --- | --- | --- |
| **Company** | Get | Empresa, estado da credencial do Emissor Nacional, onboarding e avisos | `GET /v1/empresa` |
| **Customer** (tomador) | Create | Cria pelo CNPJ (nome e endereço vêm da Receita) ou CPF + nome; se já existe, devolve com `ja_existia: true` | `POST /v1/tomadores` |
| | Get | Ficha do tomador (tipo `pj` ou `pf` + id) | `GET /v1/tomadores/{tipo}/{id}` |
| | Get Many | Lista paginada (Return All, Limit, Page, Search Term) | `GET /v1/tomadores` |
| | Search | Busca rápida por nome ou documento (2 caracteres ou mais) | `GET /v1/tomadores/busca` |
| **Service** | Get Many | Serviços ativos, inativos ou todos | `GET /v1/servicos` |
| **Invoice** (nota) | Issue | Emite: prévia + emissão num passo | `POST /v1/notas` |
| | Get Issuance Status | Estado atual do pedido de emissão | `GET /v1/emissoes/{id}` |
| | Wait for Authorization | Consulta o pedido até `autorizada`, `recusada` ou `incerta` | `GET /v1/emissoes/{id}` |
| | Get Many | Notas emitidas pelo emissaoja e importadas do portal | `GET /v1/notas` |
| | Download PDF | DANFSe em PDF, como binário | `GET /v1/notas/{origem}/{id}/pdf` |
| | Download XML | XML da nota, como binário | `GET /v1/notas/{origem}/{id}/xml` |
| | Cancel | Cancela a nota (motivo 1 ou 2) | `POST /v1/notas/{origem}/{id}/cancelar` |
| **CNPJ** | Look Up | Dados cadastrais da Receita Federal (não cria tomador) | `GET /v1/cnpj/{cnpj}` |

A saída é o JSON da API, com os campos em português (`tomador`, `pedido`, `nota`...). **Get Many** e **Search** saem
um item por registro.

### Customer (tomador)

**Create** recebe o CNPJ ou CPF com ou sem pontuação. Para CNPJ, nome e endereço vêm da Receita Federal; para CPF,
preencha **Name** com nome e sobrenome. Se o tomador já existe, a API devolve o cadastro com `ja_existia: true`, então
o node pode ficar na frente de toda emissão.

```text
{{ $json.tomador.tipo }}      // pj ou pf: vai em Customer Type do Issue
{{ $json.tomador.id }}        // vai em Customer ID do Issue
{{ $json.ja_existia }}        // true se o tomador já estava cadastrado
```

Se o documento vem de uma planilha, formate a coluna como texto para manter os zeros à esquerda.

### Invoice > Issue

| Campo | Envia | Observação |
| --- | --- | --- |
| **Reference** | cabeçalho `Idempotency-Key` | Obrigatório. 8 a 64 caracteres: letras, números, `_` e `-`. Veja [Idempotência](#idempotência-e-nota-em-dobro) |
| **Customer Type** / **Customer ID** | `tomador_tipo` / `tomador_id` | Saída de Customer > Create ou Search |
| **Amount** | `valor` | Reais, até 2 casas. Aceita `1500.50`, `1500,50`, `1.500,50` e `R$ 1.500,50`; valores ambíguos como `1.500` são recusados antes de chamar a API |
| **Description** | `descricao` | Até 2000 caracteres. Vazio: a descrição do serviço |
| **Service Date** | `competencia` | Data do serviço (`AAAA-MM-DD`). Vazio: hoje |
| **Service ID** | `servico_id` | Vazio: o serviço principal da empresa |
| Options > **Allow Repeat Of** | `permitir_repetida_de` | Depois de `possivel_duplicada`: o pedido da nota igual |
| Options > **Confirm Repeat** | `confirmo_repeticao` | Depois de `emissao_repetida_recente` |
| Options > **ISS Rate (%)**, **Retain ISS**, **Service City Code** | `aliquota_iss`, `retem_iss`, `municipio_prestacao` | Só quando um bloqueio da API pedir |

Para uma coluna de data no formato `DD/MM/AAAA`, use em **Service Date**:
`{{ DateTime.fromFormat($json.data, 'dd/MM/yyyy').toISODate() }}`.

Saída (resumida):

```json
{
  "pedido": { "id": "0d6f2c1e-5b1a-4c55-9a51-2f3c0e9b7a10", "estado": "na_fila", "numero": null, "nota": null, "proxima_consulta_ms": 2000 },
  "previa": { "resumo": {}, "avisos": [] }
}
```

### Invoice > Wait for Authorization

Consulta `GET /v1/emissoes/{id}` até o pedido terminar, esperando entre as consultas o tempo que a API pede
(`proxima_consulta_ms`, no mínimo 1 s). **Max Wait (Seconds)**: 60 por padrão, até 120.

- `autorizada`: traz `numero`, `chave_acesso` e `nota: { origem, id }`, o par que baixa o PDF e o XML.
- `recusada`: traz `motivo_code` e `motivo`. Nota recusada não conta no plano.
- `incerta`: o portal não confirmou a tempo. Confira no app antes de emitir de novo.
- Tempo esgotado: o item falha com `tempo_esgotado`, mas o pedido continua do lado do emissaoja. Consulte depois com
  **Get Issuance Status** (com a mesma referência, um novo Issue devolve o mesmo pedido).

Para tratar cada caso, ligue um node **If** em `{{ $json.pedido.estado }}`.

```json
{
  "pedido": {
    "id": "0d6f2c1e-5b1a-4c55-9a51-2f3c0e9b7a10",
    "estado": "autorizada",
    "numero": "123",
    "chave_acesso": "…",
    "nota": { "origem": "local", "id": "7c1d0e5a-0b8e-4f0a-8d6e-1a2b3c4d5e6f" },
    "proxima_consulta_ms": null
  }
}
```

### Invoice > Download PDF e Download XML

Informe **Origin** (`local` para notas emitidas pelo emissaoja, `importada` para notas trazidas do portal),
**Invoice ID** e, se quiser, **Invoice Number** (só para o nome do arquivo). O arquivo sai como binário no campo
**Put Output File in Field** (`data` por padrão), com o nome `nfse-<número ou id>.pdf` ou `.xml`. O JSON e os outros
binários do item de entrada são mantidos: para mandar PDF e XML no mesmo e-mail, baixe o XML no campo `xml`.

### Invoice > Cancel

**Reason**: `1` (erro na emissão) ou `2` (serviço não prestado). **Justification** é opcional, de 15 a 255
caracteres. A resposta é uma `operacao` em `processando`; ligue **Wait for Result** para esperar até 120 s pelo
resultado (`concluida` ou `falhou`). Nota autorizada e depois cancelada conta no plano.

### Invoice > Get Many

Filtros: **Period** (mês atual, mês anterior, ano atual, últimos 12 meses ou personalizado com **From Date** e
**To Date**), **Status** (todas, emitidas, canceladas) e **Search** (número da nota, nome ou documento do tomador).
Com **Return All**, o node segue o cursor da API até o fim.

### Outras rotas

Para rotas que este node não cobre, como `POST /v1/emissoes/{id}/conferir` ou `GET /v1/catalogo/servicos`, use o node
**HTTP Request** com a credencial **Emissaoja API** (Authentication > Predefined Credential Type) ou com uma credencial
**Header Auth** (`Authorization: Bearer ej_live_...`), que também fica criptografada. Veja a
[referência completa](https://emissaoja.com.br/docs/).

## Exemplo de workflow

O arquivo [`examples/emitir-nfse-planilha.json`](examples/emitir-nfse-planilha.json) emite uma NFS-e por linha de uma
planilha do Google: **Executar > Planilha > Criar tomador > Emitir NFS-e > Aguardar autorização > Baixar PDF**, com
notas explicando cada passo.

1. Copie o conteúdo do arquivo e cole no editor do n8n (Ctrl+V).
2. No node **Planilha**, escolha a credencial do Google e a planilha com as colunas `documento`, `valor` e
   `descricao` (para CPF, inclua `nome`).
3. Nos quatro nodes do emissaoja, escolha a sua credencial **Emissaoja API** (comece pelo Sandbox).

## Erros

Quando a API recusa, o node falha com a mensagem `The emissaoja API returned <code> (HTTP <status>)` e, na descrição,
a `message` da API, os `bloqueios` e o que fazer. Erros detectados antes da chamada (referência, valor, data) trazem
o código entre parênteses e nada é enviado. Com **On Error > Continue** (Settings do node), o item sai assim, para
você desviar com um **If** em `{{ $json.code }}`:

```json
{
  "error": "The emissaoja API returned nota_bloqueada (HTTP 422)",
  "code": "nota_bloqueada",
  "message": "Antes de emitir, resolva:",
  "http_status": 422,
  "bloqueios": [{ "code": "tomador_incompleto", "mensagem": "…", "acao": "completar_tomador" }],
  "request_id": "r_…"
}
```

| code | O que fazer |
| --- | --- |
| `chave_invalida` (401) | Confira a chave e o Environment da credencial: `ej_live_` só em Production, `ej_test_` só no Sandbox |
| `sem_empresa`, `aceite_pendente` (409) | Conecte a empresa e aceite os termos no app |
| `nota_bloqueada` (422) | Resolva os itens de `bloqueios` (a maioria no app) e emita de novo com a mesma referência |
| `limite_notas` (402) | Limite do plano no mês. Veja os [planos](https://emissaoja.com.br/#precos) |
| `possivel_duplicada` (409) | Nota igual hoje. Se for mesmo outra, use Options > Allow Repeat Of com `nota_igual_recente.pedido_id` |
| `emissao_repetida_recente` (409) | Mesma nota há menos de 2 minutos. Se for mesmo outra, ligue Options > Confirm Repeat |
| `incerta_pendente` (409) | Há uma nota igual em conferência. Não emita de novo; acompanhe no app |
| `rate_limited` (429) | Limite por minuto. Reduza o ritmo (Loop Over Items + Wait) |
| `fila_indisponivel`, `motor_indisponivel` (503) | Instabilidade. Repita com a **mesma referência** |
| `receita_indisponivel`, `cnpj_consulta_indisponivel` (503) | A Receita não respondeu. Tente de novo em instantes |
| `tomador_nao_encontrado`, `servico_nao_encontrado`, `nota_nao_encontrada`, `pedido_nao_encontrado` (404) | Confira o id usado no campo indicado na descrição |
| `documento_invalido`, `nome_obrigatorio`, `nome_incompleto`, `cnpj_nao_encontrado` (400) | Confira o CPF/CNPJ e, para CPF, o nome completo |
| `chave_idempotencia_invalida`, `valor_invalido`, `competencia_invalida` | Erro local: confira o campo; nada foi enviado |
| `tempo_esgotado` | A espera acabou antes do fim do pedido ou a API não respondeu a tempo. Consulte depois; não emita com outra referência |
| `rede` | O n8n não alcançou a API. Veja <https://emissaoja.com.br/v1/status> e repita com a mesma referência |

A lista completa de códigos está no [OpenAPI](https://emissaoja.com.br/v1/openapi.json).

## Idempotência e nota em dobro

- **Referência**: cada nota leva um id seu, de 8 a 64 caracteres (letras, números, `_` e `-`), enviado no cabeçalho
  `Idempotency-Key`. Repetir a mesma referência devolve `200` com o mesmo pedido e `repetido: true`; a API nunca emite
  duas vezes. Use um id dos seus dados (número do pedido de venda, id da linha + mês) ou
  `nfse-{{ $execution.id }}-{{ $itemIndex }}`, único por execução e por item. O prefixo `nfse-` importa:
  `{{ $execution.id }}-{{ $itemIndex }}` sozinho fica com menos de 8 caracteres nas primeiras execuções de uma
  instância (por exemplo `57-0`). Nunca use `$now` ou valores aleatórios: cada tentativa viraria uma nota nova.
- **O node não repete chamadas sozinho**: emitir tem efeito fiscal. Para repetir automaticamente, ligue
  **Retry On Fail** nas Settings do node. Na mesma execução a referência não muda, então a API devolve o mesmo pedido.
- **`possivel_duplicada`** (409): já saiu hoje uma nota igual (mesmo tomador, valor e competência). Se for mesmo outra
  nota, emita de novo com **Allow Repeat Of** = `nota_igual_recente.pedido_id`.
- **`emissao_repetida_recente`** (409): a mesma nota foi pedida há menos de 2 minutos. Se for mesmo outra, ligue
  **Confirm Repeat**.
- **`fila_indisponivel`** (503) ou falha de rede durante o Issue: repita com a **mesma referência**. Se o primeiro
  pedido chegou, a API devolve o mesmo.

## Uso como ferramenta do AI Agent

O node tem `usableAsTool`: ligue-o em **Tools** de um **AI Agent** e deixe o modelo preencher os campos com
`$fromAI`:

```text
Customer > Search, Search Term:   {{ $fromAI('busca', 'Nome, CNPJ ou CPF do cliente') }}
CNPJ > Look Up, CNPJ:             {{ $fromAI('cnpj', 'CNPJ da empresa, com ou sem pontuação') }}
Invoice > Get Many, Search:       {{ $fromAI('busca', 'Número da nota ou nome do cliente') }}
```

**Issue** e **Cancel** têm efeito fiscal real. Prefira dar ao agente as operações de consulta; se expuser a emissão,
exija aprovação humana antes da chamada e use uma referência estável (um id do pedido, não um valor gerado a cada
tentativa). Em versões antigas do n8n self-hosted, pode ser preciso definir
`N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` para usar community nodes como ferramenta.

Para assistentes fora do n8n, o emissaoja também é um servidor MCP: <https://emissaoja.com.br/mcp>.

## Limites e planos

- 60 chamadas por minuto por chave; 10 emissões por minuto; buscas 120 por minuto; consulta de CNPJ 30 por minuto.
  Acima disso a API responde `429 rate_limited` com `Retry-After`. Para planilhas grandes, use **Loop Over Items**
  em lotes de 10 com um **Wait** de 60 segundos.
- Plano Grátis: 1 nota por mês. A nota conta quando o Emissor Nacional aceita o pedido; recusada não conta. Veja os
  [planos](https://emissaoja.com.br/#precos).
- Webhooks ainda não existem: acompanhe com **Wait for Authorization** ou **Get Issuance Status**.

## Perguntas frequentes

**Precisa de certificado digital?** Não. O emissaoja entra no Emissor Nacional com o CNPJ e a senha do próprio portal.

**Funciona para MEI?** Sim, para MEI, ME e EPP optantes pelo Simples Nacional. A tributação do ISS aceita tributável e
não incidência; isenção, imunidade e exportação ficam fora.

**Tem ambiente de testes?** Sim: o sandbox (<https://sandbox.emissaoja.com.br>) tem um Emissor Nacional simulado,
grátis, e nada vai ao fisco. Use uma chave `ej_test_` e o Environment **Sandbox**.

**Quanto custa?** O node é gratuito (MIT). O emissaoja tem plano Grátis com 1 nota por mês e
[planos pagos](https://emissaoja.com.br/#precos).

**Tem webhook?** Ainda não. Use **Wait for Authorization**, que respeita `proxima_consulta_ms`.

**Funciona no n8n Cloud?** Só depois que o n8n verificar o node. Até lá, use o n8n self-hosted.

## Compatibilidade

n8n self-hosted 1.85 ou mais novo (o node usa a API de community nodes v1 e `NodeConnectionTypes`). Construído com
`@n8n/node-cli` 0.55 e checado com o lint do n8n para nodes verificados.

## Desenvolvimento

```bash
npm install
npm run lint
npm run build
npm test                                  # testes com respostas simuladas (sem rede)
EMISSAOJA_TEST_KEY=ej_test_... npm test   # inclui um fluxo real no sandbox
npm run dev                               # sobe um n8n local com o node
```

A publicação no npm é feita pelo GitHub Actions ([`publish.yml`](.github/workflows/publish.yml)) ao enviar uma tag
`v*`, com provenance. Mudanças: [CHANGELOG.md](CHANGELOG.md).

## Links

- Site: <https://emissaoja.com.br> · Cadastro: <https://emissaoja.com.br/?origem=lib-n8n>
- Documentação: <https://emissaoja.com.br/docs/> · Markdown: <https://emissaoja.com.br/docs.md>
- OpenAPI 3.1: <https://emissaoja.com.br/v1/openapi.json> · Para IAs: <https://emissaoja.com.br/llms.txt>
- MCP: <https://emissaoja.com.br/mcp> · Status: <https://emissaoja.com.br/v1/status>
- Outras bibliotecas oficiais: npm [`emissaoja`](https://www.npmjs.com/package/emissaoja) ·
  PyPI [`emissaoja`](https://pypi.org/project/emissaoja/) ·
  Packagist [`emissaoja/emissaoja`](https://packagist.org/packages/emissaoja/emissaoja) ·
  NuGet [`Emissaoja`](https://www.nuget.org/packages/Emissaoja) ·
  Go [`emissaoja.com.br/go`](https://pkg.go.dev/emissaoja.com.br/go) ·
  RubyGems [`emissaoja`](https://rubygems.org/gems/emissaoja) ·
  n8n [`n8n-nodes-emissaoja`](https://www.npmjs.com/package/n8n-nodes-emissaoja)
- Problemas e sugestões: [issues](https://github.com/Easymovel/n8n-nodes-emissaoja/issues) · Suporte:
  [suporte@emissaoja.com.br](mailto:suporte@emissaoja.com.br)

## Licença

[MIT](LICENSE.md). Copyright (c) 2026 BINOBO LTDA.

---

## In English

**n8n-nodes-emissaoja** is the official [n8n](https://n8n.io) community node for [emissaoja](https://emissaoja.com.br),
an API that issues **NFS-e** (Brazilian electronic service invoices) in the national Emissor Nacional **without a
digital certificate**, using the company's CNPJ and portal password, for **MEI and Simples Nacional** companies.

- Install: **Settings > Community Nodes > Install** > `n8n-nodes-emissaoja` (self-hosted n8n 1.85 or newer).
- Credentials: an **Emissaoja API** credential with your API key (`ej_live_` for Production, `ej_test_` for the free
  Sandbox, where nothing reaches the tax authority) and the matching **Environment**.
- Operations: Company (Get), Customer (Create, Get, Get Many, Search), Service (Get Many), Invoice (Issue, Get
  Issuance Status, Wait for Authorization, Get Many, Download PDF, Download XML, Cancel) and CNPJ (Look Up).
- **Issue** sends your **Reference** as the `Idempotency-Key` header, so repeating it never issues twice; the node
  never retries on its own. API errors keep the API `code` in the message and the `bloqueios` in the description.
- Usable as an **AI Agent** tool. Example workflow: [`examples/emitir-nfse-planilha.json`](examples/emitir-nfse-planilha.json).
  Docs: <https://emissaoja.com.br/docs/> · Sign up: <https://emissaoja.com.br/?origem=lib-n8n>

emissaoja is a private service, not affiliated with Receita Federal or the Emissor Nacional.

---

O emissaoja é um serviço privado e não tem vínculo com a Receita Federal nem com o Emissor Nacional.
