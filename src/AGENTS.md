# SRC KNOWLEDGE BASE

## OVERVIEW

`src/` contains the new Terraform platform only: API/UI composition, filesystem repositories, Terraform runner, provider catalog defaults, domain contracts, and redaction-aware logging.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add/change API | `index.ts` | Keep mutation routes non-GET and admin-auth protected. |
| Change storage layout | `storage.ts` | Maintain no-DB `/config` and `/data` contracts. |
| Change Terraform behavior | `terraform.ts` | Keep saved artifacts under run directory and redact secrets. |
| Change provider metadata | `config.ts` | Provider type metadata, not business workflow logic. |
| Change schemas | `types.ts` | Keep workspace/run/state/credential concepts separate. |

## CONVENTIONS

- Internal imports use `@/...`.
- API responses must expose credential env key names only, never credential values.
- Template content must stay server-side allowlisted.
- Terraform process env injection is the credential boundary.
