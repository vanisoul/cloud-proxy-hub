# PROJECT KNOWLEDGE BASE

## OVERVIEW

`terraform-platform` is an admin-only Bun + Elysia Terraform management service. It stores provider-scoped keys, templates, and published APIs under `/config`, runtime Terraform artifacts under `/data`, and does not use a database.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| HTTP API / admin UI | `src/index.ts` | Elysia app, auth, provider-scoped API routes, simple HTML admin landing page. |
| Provider catalog defaults | `src/config.ts` | Built-in `aliyun/alicloud` and `hashicorp/google` metadata. |
| Domain types | `src/types.ts` | Provider, key, template, API, run contracts. |
| Filesystem storage | `src/storage.ts` | `/config/keys`, `/config/templates`, `/config/apis`, and `/data/apis` repositories. |
| Terraform execution | `src/terraform.ts` | Deployment API resolver, Terraform runner, selected key env injection. |
| Logging/redaction | `src/logger.ts` | Structured logs with secret-like key redaction. |

## CONVENTIONS

- Runtime/package manager is Bun. Use `bun run test` and `bun run typecheck` for validation.
- TypeScript path alias `@/*` maps to `./src/*`.
- No Prisma, SQLite, Aliyun SDK, cron cleanup, or legacy VPN/SOCKS5 workflow remains.
- Mutations must use non-GET routes.
- Cloud provider keys are created through admin API/UI and stored under `/config/keys/<provider-type>/<key-id>`.
- Key values must not be returned by public API responses.
- Terraform templates are server-side allowlisted and must reject terraform/backend/required_providers/provisioner/local-exec/remote-exec constructs.

## ANTI-PATTERNS

- Do not reintroduce DB-backed platform state.
- Do not add arbitrary Terraform source/backend/provider/env editing from UI/API.
- Do not put cloud provider keys in `.env.example` or platform deployment env.
- Do not write raw credentials into generated `.tf`, logs, metadata, or responses.
- Do not commit `/config`, `/data`, `.terraform`, `*.tfstate`, or plan artifacts.

## COMMANDS

```bash
bun install
bun run dev
bun run start
bun run test
bun run typecheck
just dev
just test
just build 0.1.0
```
