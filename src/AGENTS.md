# SRC KNOWLEDGE BASE

## OVERVIEW

`src/` contains the Terraform platform only: provider-scoped API/UI composition, filesystem repositories, Terraform runner, provider catalog defaults, domain contracts, and redaction-aware logging.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add/change API | `index.ts` | Keep mutation routes non-GET and admin-auth protected. |
| Change storage layout | `storage.ts` | Maintain no-DB `/config/keys`, `/config/templates`, `/config/shells`, `/config/apis`, and `/data/apis` contracts. |
| Change Terraform behavior | `terraform.ts` | Resolve API -> selected key -> selected template -> optional shell, keep saved artifacts under run directory and redact secrets. |
| Change provider metadata | `config.ts` | Provider type metadata, not business workflow logic. |
| Change schemas | `types.ts` | Keep provider keys, templates, published APIs, and runs separate. |

## CONVENTIONS

- Internal imports use `@/...`.
- API responses must expose provider key env names only, never key values.
- Template content must stay server-side allowlisted.
- Platform-managed shell resources inject reusable commands into provider startup variables, but user templates must not define provisioners. API shell bindings store the selected shell; deploy writes the shell content into `user_data` for Alicloud or `startup_script` for Google.
- Terraform process env injection is the only boundary where selected key values become runtime env.
