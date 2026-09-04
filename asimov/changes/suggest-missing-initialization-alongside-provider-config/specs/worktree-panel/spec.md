## MODIFIED Requirements

### Requirement: Missing initialization material is suggested without overriding configuration

WHETHER OR NOT a complete provisioning source is present, the create form SHALL inspect the existing
fixed environment filenames and root package-manager lockfiles. It SHALL append only material the
source does not already express, as unchecked suggestions.

#### Scenario: A readable provider omits an existing environment file and setup

- **WHEN** the repository has a readable supported provisioning source, `.env.local`, and `pnpm-lock.yaml`
- **AND** the source declares neither `.env.local` nor `pnpm install`
- **THEN** its configured rows remain unchanged
- **AND** `.env.local` is offered unchecked as a copy suggestion without reading its contents
- **AND** `pnpm install` is offered unchecked as a setup suggestion

#### Scenario: A provider already expresses the candidate

- **WHEN** the chosen source declares or excludes `.env.local` and declares `pnpm install`
- **THEN** neither candidate is suggested a second time

#### Scenario: Setup command identity is exact

- **WHEN** the source declares `pnpm install ` with trailing whitespace and `pnpm-lock.yaml` exists
- **THEN** `pnpm install` remains a separate unchecked suggestion
- **AND** neither shell command is normalized or discarded

### Requirement: An incomplete provider answer is not supplemented

A provider answer marked incomplete — unreadable, malformed, or depending on an unresolved source —
SHALL remain the answer and SHALL suppress initialization suggestions.

#### Scenario: A provisioning answer is incomplete

- **WHEN** a supported source is unreadable, malformed, or names an unresolved source
- **THEN** its problem and any material safely recovered remain the source's answer
- **AND** no initialization suggestion is appended

### Requirement: Saved configuration suppresses only the suggestions it now expresses

WHEN positive environment-file consent is saved into the native provisioning configuration, later
forms SHALL present that file as configured rather than suggested. Other supported material that
the configuration still does not express SHALL remain eligible for an unchecked suggestion.

#### Scenario: A saved copy does not become standing setup consent

- **WHEN** a save records `.env.local` as a configured copy while `pnpm-lock.yaml` remains present
- **THEN** a later form offers `.env.local` as configured, not suggested
- **AND** `pnpm install` is offered unchecked again
