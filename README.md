# Painel Regional

Novo painel hierárquico baseado na arquitetura web do **Painel Comercial Equipe Norte**, sem modificar ou apagar o repositório original.

## Hierarquia

- Gerente Regional (RG)
- Gerentes Distritais (GD)
- Consultores

## Fluxo de acesso

1. Seleção da Regional antes do login.
2. Login vinculado à Regional selecionada.
3. O primeiro acesso de uma Regional cria o primeiro Gerente Regional.
4. O Gerente Regional visualiza o consolidado, Distritais, Administração e Automações.
5. O Gerente Distrital visualiza somente sua Distrital e seus Consultores.
6. O Consultor visualiza somente seu próprio escopo.

## Estrutura do projeto

O aplicativo Cloudflare está na pasta `web/`:

- React + TypeScript + Vite
- Cloudflare Pages Functions
- Cloudflare D1
- Migrações em `web/migrations/`
- Deploy automático em `.github/workflows/deploy-cloudflare.yml`

## Executar localmente

```bash
cd web
npm install
npm run dev
```

Para testar as Functions com D1 local:

```bash
npm run build
npx wrangler d1 migrations apply DB --local
npx wrangler pages dev dist
```

## Publicar no Cloudflare

Cadastre no GitHub, em **Settings → Secrets and variables → Actions**, os secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

O workflow cria ou atualiza o projeto `painel-regional`, provisiona o banco `painel-regional-db`, aplica as migrações e publica o site.

Endereço esperado após o primeiro deploy:

```text
https://painel-regional.pages.dev
```

## Origem preservada

Repositório usado como referência:

```text
mauriciobarrosaguiar/painel-comercial-equipe-norte
```

O painel Norte não é alterado por este projeto.
