# Changelog

## 0.1.0 — 2026-11-05

Primeira versão pública (first public release).

- Node **emissaoja** com os recursos Company (Get), Customer (Create, Get, Get Many, Search), Service (Get Many),
  Invoice (Issue, Get Issuance Status, Wait for Authorization, Get Many, Download PDF, Download XML, Cancel) e
  CNPJ (Look Up).
- Credencial **Emissaoja API** com a chave (`ej_live_` ou `ej_test_`), o ambiente (Production ou Sandbox) e teste da
  conexão em `GET /v1/empresa`.
- Issue envia a referência no cabeçalho `Idempotency-Key` e valida o formato antes de chamar a API.
- Wait for Authorization respeita `proxima_consulta_ms`, com tempo máximo configurável (60 s por padrão, até 120 s).
- PDF e XML saem como dados binários (campo `data` por padrão), com o nome `nfse-<número ou id>.pdf|.xml`.
- Erros da API viram `NodeApiError` com o `code` na mensagem e `message`/`bloqueios` na descrição; com
  **On Error > Continue**, o item sai com `code`, `bloqueios` e `request_id`.
- Nenhuma chamada é repetida automaticamente.
- Pode ser usado como ferramenta do AI Agent (`usableAsTool`).
