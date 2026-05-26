# terraform-platform

Admin-only Terraform management platform built with Bun and Elysia. This project no longer contains the old Aliyun ECS/VPN/SOCKS5 workflow and does not use Prisma, SQLite, or a database for platform state.

## Storage Model

- `/config`: configured provider credentials, provider instances, workspaces, Terraform templates, and published APIs.
- `/data/apis/<api-id>/runs/<run-id>`: Terraform run workspaces, plans, state files, logs, and metadata.

Runtime credentials are referenced by ID and injected into Terraform processes at run time. They are not returned by API responses and must not be written into generated Terraform files.

## Commands

```bash
bun install
bun run dev
bun run start
bun run test
bun run typecheck
```

Terraform must be installed and available as `terraform`, or set `TERRAFORM_BIN`. `ADMIN_API_KEY` is required at startup.

## Environment

See `.env.example` for supported variables:

- `PORT`
- `ADMIN_API_KEY`
- `CONFIG_DIR`
- `DATA_DIR`
- `TERRAFORM_BIN`

## API Flow

1. `GET /api/provider-types`
2. `POST /api/credentials`
3. `POST /api/provider-instances`
4. `POST /api/provider-instances/:id/test`
5. `POST /api/workspaces`
6. `POST /api/templates`
7. `POST /api/apis`
8. `POST /api/apis/:id/runs`

Mutating routes use non-GET verbs. Set `Authorization: Bearer <ADMIN_API_KEY>` for all API routes.

## Safety Boundaries

- Provider types are Terraform provider metadata, not app business logic.
- Templates are server-side allowlisted and reject `backend`, `provisioner`, `local-exec`, and `remote-exec` blocks.
- Credentials are stored as runtime references and redacted from public responses.
- State and plans are stored under `/data/apis/<api-id>/runs/<run-id>`.
