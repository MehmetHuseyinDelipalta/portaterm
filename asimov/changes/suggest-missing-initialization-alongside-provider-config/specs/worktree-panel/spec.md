## MODIFIED Requirements

### Requirement: A repository without provisioning configuration gets bounded initialization suggestions

WHETHER OR NOT a complete provisioning source is present, the create form SHALL inspect the fixed
supported environment filenames at the repository root and one level inside each workspace directory
the repository itself declares, together with repository-root package-manager lockfiles. It SHALL
append only material the source does not already express, as unchecked suggestions, without reading
an environment file's contents.

#### Scenario: An environment file exists without provisioning configuration

- **WHEN** the repository root contains an ordinary `.env.local` file and no provisioning source
- **THEN** `.env.local` is offered as an unchecked copy suggestion
- **AND** no byte of `.env.local` is read to produce the offer

#### Scenario: A complete provider omits an existing environment file and setup

- **WHEN** the repository has a complete supported provisioning source, `.env.local`, and `pnpm-lock.yaml`
- **AND** the source declares neither `.env.local` nor `pnpm install`
- **THEN** its configured rows remain unchanged
- **AND** `.env.local` is offered unchecked as a copy suggestion without reading its contents
- **AND** `pnpm install` is offered unchecked as a setup suggestion

#### Scenario: A complete empty source receives missing suggestions

- **WHEN** the repository has an empty supported provisioning file and also has `.env`
- **THEN** the source remains active and `.env` is offered unchecked as a copy suggestion

#### Scenario: A provider already expresses the candidate

- **WHEN** the chosen source declares or excludes `.env.local` and declares `pnpm install`
- **THEN** neither candidate is suggested a second time

#### Scenario: Setup command identity is exact

- **WHEN** the source declares `pnpm install ` with trailing whitespace and `pnpm-lock.yaml` exists
- **THEN** `pnpm install` remains a separate unchecked suggestion
- **AND** neither shell command is normalized or discarded

### Requirement: A present source answers, even when its answer is nothing

A source SHALL count as detected when any file it reads is present, whatever that file then yields.
A complete present source declaring nothing SHALL remain the active provider and contribute no
configured rows of its own; eligible host initialization suggestions MAY append after that answer. A
source carrying any provider problem SHALL remain the active problem answer and receive no
suggestions. Neither source SHALL be passed over for a later provider.

#### Scenario: The first source declares nothing

- **WHEN** a repository carries a complete first-order source whose file declares nothing, and a later source that declares rows
- **THEN** the first source contributes no configured rows and remains active
- **AND** eligible host initialization suggestions may appear unchecked
- **AND** the later source appears as a row offering to switch, with none of its rows offered until that is taken

### Requirement: A saved configuration replaces fallback suggestions

WHEN positive environment-file consent is saved into the native provisioning configuration, later
forms SHALL present that file as configured rather than suggested. Other supported material that
the configuration still does not express SHALL remain eligible for an unchecked suggestion.

#### Scenario: The saved copy becomes configured without granting setup consent

- **WHEN** a save records `.env.local` as a configured copy while `pnpm-lock.yaml` remains present
- **THEN** a later form offers `.env.local` as configured, not suggested
- **AND** `pnpm install` is offered unchecked again

## ADDED Requirements

### Requirement: An incomplete provider answer is not supplemented

A provider answer carrying any provider problem SHALL be incomplete, including an unreadable or
malformed source, an unknown or damaged key, or a dependency on an unresolved source. The answer and
its problem SHALL remain, and initialization suggestions SHALL be suppressed.

#### Scenario: A provisioning answer is incomplete

- **WHEN** a supported source is unreadable, malformed, or names an unresolved source
- **THEN** its problem and any material safely recovered remain the source's answer
- **AND** no initialization suggestion is appended

#### Scenario: A readable answer carries a non-fatal provider problem

- **WHEN** a supported source is readable and parsed but reports an unknown key
- **THEN** the source's problem remains its answer
- **AND** no initialization suggestion is appended
