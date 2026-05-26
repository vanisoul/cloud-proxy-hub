# PROJECT KNOWLEDGE BASE

## OVERVIEW

`terraform-platform` is an admin-only Bun + Elysia Terraform management service. It stores configuration under `/config`, runtime Terraform artifacts under `/data`, and does not use a database.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| HTTP API / admin UI | `src/index.ts` | Elysia app, auth, API routes, simple HTML admin landing page. |
| Provider catalog defaults | `src/config.ts` | Built-in `aliyun/alicloud` and `hashicorp/google` metadata. |
| Domain types | `src/types.ts` | Provider, credential, workspace, template, API, run contracts. |
| Filesystem storage | `src/storage.ts` | `/config` and `/data` repositories, redacted credential responses. |
| Terraform execution | `src/terraform.ts` | `init`, `validate`, `plan` runner and runtime credential injection. |
| Logging/redaction | `src/logger.ts` | Structured logs with secret-like key redaction. |

## CONVENTIONS

- Runtime/package manager is Bun. Use `bun run test` and `bun run typecheck` for validation.
- TypeScript path alias `@/*` maps to `./src/*`.
- No Prisma, SQLite, Aliyun SDK, cron cleanup, or legacy VPN/SOCKS5 workflow remains.
- Mutations must use non-GET routes.
- Credentials are stored as runtime references and must not be returned by public API responses.
- Terraform templates are server-side allowlisted and must reject backend/provisioner/local-exec/remote-exec constructs.

## ANTI-PATTERNS

- Do not reintroduce DB-backed platform state.
- Do not add arbitrary Terraform source/backend/provider/env editing from UI/API.
- Do not write raw credentials into generated `.tf`, `.tfvars`, logs, metadata, or responses.
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
