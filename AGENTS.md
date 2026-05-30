# PROJECT KNOWLEDGE BASE

## OVERVIEW

`terraform-platform` is an admin-only Bun + Elysia Terraform management service. It stores provider-scoped keys, templates, initialization shells, and published APIs under `/config`, runtime Terraform artifacts under `/data`, and does not use a database.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| HTTP API / admin UI shell | `src/index.ts` | Elysia app, auth, provider-scoped API routes, login page, and built SPA static serving. |
| Admin SPA frontend | `web/` | Vite + Vue 3 + Element Plus admin console built to `web/dist`. |
| Provider catalog defaults | `src/config.ts` | Built-in `aliyun/alicloud` and `hashicorp/google` metadata. |
| Domain types | `src/types.ts` | Provider, key, template, shell, API, run contracts. |
| Filesystem storage | `src/storage.ts` | `/config/keys`, `/config/templates`, `/config/shells`, `/config/apis`, and `/data/apis` repositories. |
| Terraform execution | `src/terraform.ts` | Deployment API resolver, Terraform runner, selected key env injection, and platform-managed shell startup variable injection. |
| Logging/redaction | `src/logger.ts` | Structured logs with secret-like key redaction. |

## CONVENTIONS

- Runtime/package manager is Bun. Use `bun run test` and `bun run typecheck` for validation.
- Admin UI is a Vite/Vue/Element Plus SPA under `web/`; run `bun run build` before `bun run start` in fresh checkouts.
- TypeScript path alias `@/*` maps to `./src/*`.
- No Prisma, SQLite, Aliyun SDK, cron cleanup, or legacy VPN/SOCKS5 workflow remains.
- Mutations must use non-GET routes.
- Cloud provider keys are created through admin API/UI and stored under `/config/keys/<provider-type>/<key-id>`.
- Key values must not be returned by public API responses.
- Terraform templates are server-side allowlisted and must reject terraform/backend/required_providers/provisioner/local-exec/remote-exec constructs.
- Shell resources are stored under `/config/shells/<provider-type>/<shell-id>` as reusable inline commands only. APIs may bind a shell; deploy injects its content into provider startup variables (`user_data` for Alicloud, `startup_script` for Google) instead of generating provisioners.

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
 bun run dev:web
 bun run build
bun run start
bun run test
bun run typecheck
just dev
just test
just build 0.1.0
```
