# terraform-platform

Admin-only Terraform management platform built with Bun and Elysia. It stores provider keys, Terraform templates, and published deployment APIs under `/config`, while runtime Terraform artifacts live under `/data`.

## Storage Model

- `/config/keys/<provider-type>/<key-id>/metadata.json`: key metadata only.
- `/config/keys/<provider-type>/<key-id>/secret.json`: provider key environment values.
- `/config/templates/<provider-type>/<template-id>/metadata.json`: template metadata.
- `/config/templates/<provider-type>/<template-id>/files/...`: Terraform template files.
- `/config/apis/<provider-type>/<api-id>/metadata.json`: published API metadata referencing key and template IDs.
- `/data/apis/<api-id>/runs/<run-id>`: Terraform run artifacts, redacted logs, and redacted metadata.

Cloud provider keys are created through the admin API/UI and are not configured through `.env`.

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

See `.env.example` for supported platform variables:

- `PORT`
- `ADMIN_API_KEY`
- `CONFIG_DIR`
- `DATA_DIR`
- `TERRAFORM_BIN`

## API Flow

1. `GET /api/provider-types`
2. `POST /api/providers/:providerTypeId/keys`
3. `POST /api/providers/:providerTypeId/templates`
4. `POST /api/providers/:providerTypeId/apis`
5. `POST /api/deployments/:apiId/deploy`
6. `POST /api/deployments/:apiId/delete`
7. `GET /api/deployments/:apiId/status`
8. `GET /api/deployments/:apiId/output`

Set `Authorization: Bearer <ADMIN_API_KEY>` for all API routes.

## Safety Boundaries

- Provider types are Terraform provider metadata, not app business logic.
- Key list/get responses expose metadata and `envKeys` only, never key values.
- Templates are server-side allowlisted and reject `terraform`, `backend`, `required_providers`, `provisioner`, `local-exec`, and `remote-exec` constructs.
- Published APIs store only provider type, key ID, template ID, and action metadata.
- Terraform subprocesses receive only minimal runtime env plus the selected key env for that run.
