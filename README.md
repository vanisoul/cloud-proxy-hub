# terraform-platform

Admin-only Terraform management platform built with Bun and Elysia. It stores provider keys, Terraform templates, initialization shells, and published deployment APIs under `/config`, while runtime Terraform artifacts live under `/data`.

## Storage Model

- `/config/keys/<provider-type>/<key-id>/metadata.json`: key metadata only.
- `/config/keys/<provider-type>/<key-id>/secret.json`: provider key environment values.
- `/config/templates/<provider-type>/<template-id>/metadata.json`: template metadata.
- `/config/templates/<provider-type>/<template-id>/files/...`: Terraform template files.
- `/config/shells/<provider-type>/<shell-id>/metadata.json`: reusable initialization shell metadata and inline commands only.
- `/config/apis/<provider-type>/<api-id>/metadata.json`: published API metadata referencing key, template, and optional shell binding.
- `/config/apis/<provider-type>/<api-id>/secret.json`: published API variable values.
- `/data/apis/<api-id>`: stable Terraform workdir that preserves `terraform.tfstate` for the published API.
- `/data/apis/<api-id>/runs/<run-id>`: per-run redacted logs, metadata, and output snapshots.
- `/data/apis/<api-id>/current-output.redacted.json`: latest deploy output snapshot for runtime output reads.

Cloud provider keys are created through the admin API/UI and are not configured through `.env`.

## Commands

```bash
bun install
bun run dev
 bun run dev:web
 bun run build
 bun run build:web
bun run start
bun run test
bun run typecheck
```

The admin frontend is a Vite/Vue/Element Plus SPA under `web/`. Run `bun run build` before `bun run start` in a fresh checkout so `web/dist` exists; Docker builds this asset bundle in its builder stage. `bun run test` also builds the SPA before running backend tests.

Terraform must be installed and available as `terraform`, or set `TERRAFORM_BIN`. `ADMIN_API_KEY` is required at startup.

## Environment

See `.env.example` for supported platform variables:

- `PORT`
- `ADMIN_API_KEY`
- `CONFIG_DIR`
- `DATA_DIR`
- `TERRAFORM_BIN`
- `PUBLIC_CALLBACK_BASE_URL` (optional; when empty, Init Shell Log callback is disabled and runtime output curl examples have no public origin)

## API Flow

1. `GET /api/provider-types`
2. `POST /api/providers/:providerTypeId/keys`
3. `POST /api/providers/:providerTypeId/templates`
4. `POST /api/providers/:providerTypeId/shells` (optional)
5. `POST /api/providers/:providerTypeId/apis`
6. `POST /api/deployments/:apiId/deploy`
7. `POST /api/deployments/:apiId/delete`
8. `GET /api/deployments/:apiId/status`
9. `GET /api/deployments/:apiId/output`
10. `GET /api/runtime/:apiId/outputs/:outputName`

Set `Authorization: Bearer <ADMIN_API_KEY>` for all API routes.

`GET /api/runtime/:apiId/outputs/:outputName` is the read-only runtime output surface for consumers. It accepts `ADMIN_API_KEY` with `X-API-Key: <ADMIN_API_KEY>` or `Authorization: Bearer <ADMIN_API_KEY>`. The route returns one top-level Terraform output value from the latest successful deploy snapshot and never returns admin run metadata. String outputs are returned as raw text; object, array, number, boolean, and null outputs are returned as the JSON value itself without an API wrapper. Error responses remain JSON objects with `error` and `message`. Successful delete disables the current runtime output. Runtime output curl examples in the UI use `PUBLIC_CALLBACK_BASE_URL` as their public origin.

Only share runtime output curl examples with consumers who may hold `ADMIN_API_KEY`; that token can also access admin API routes.

## Safety Boundaries

- Provider types are Terraform provider metadata, not app business logic.
- Key list/get responses expose metadata and `envKeys` only, never key values.
- Templates are server-side allowlisted and reject `terraform`, `backend`, `required_providers`, `provisioner`, `local-exec`, and `remote-exec` constructs.
- Shell resources are platform-managed reusable initialization commands. When a shell is bound while publishing an API, deploy injects the shell commands into a provider-specific startup variable in `terraform.tfvars.json`: Alicloud uses `user_data`; Google uses `startup_script`; other providers may use `user_data`, `startup_script`, or `cloud_init`. Templates remain blocked from defining provisioners.
- Published APIs store provider type, key ID, template ID, optional shell ID, action metadata, and revision snapshots.
- Terraform subprocesses receive only minimal runtime env plus the selected key env for that run.
- Init Shell Log callback is passive and disabled unless `PUBLIC_CALLBACK_BASE_URL` is set to a URL reachable by deployed VMs. When enabled for shell-bound APIs, the generated startup script posts its captured stdout/stderr back to the platform with a short-lived signed callback URL. The same public origin is used when the UI generates runtime output curl examples.
