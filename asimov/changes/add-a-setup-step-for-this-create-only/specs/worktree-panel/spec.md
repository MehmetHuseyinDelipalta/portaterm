## ADDED Requirements

### Requirement: A setup step can be added for this create only

Wherever the create form shows a provisioning offer, it SHALL offer an action that adds one shell
command as a setup step for the create being composed, entered in an input the extension owns rather
than in the form. The added step SHALL appear selected among the offer's setup rows, naming itself as
applying to this create only in place of a source file, and SHALL NOT be offered by a later opening.

#### Scenario: A command is added and the worktree is created

- **WHEN** the user adds `pnpm install` through the offered input and creates the worktree with the step selected
- **THEN** `pnpm install` runs in the new worktree after materialization, as any selected setup step does

#### Scenario: The input is dismissed

- **WHEN** the user opens the input and dismisses it without confirming
- **THEN** the offer is unchanged and the form offers the action again

### Requirement: An opened setup input holds the form until it is answered

From the moment the setup input is opened until the form is answered, the form SHALL NOT offer to
create, to save, to change source, or to open another input. Every opened input SHALL be answered
unless the form that opened it is gone.

### Requirement: Only a step the form added can be edited or removed in it

Until the create is submitted, the form SHALL offer to edit and to remove each step it added this
way, and SHALL offer neither for any other row.

#### Scenario: A step is edited before the create

- **WHEN** the user edits an added step's text and confirms
- **THEN** the row shows the confirmed text, in the same position, still selected as it was

### Requirement: A typed setup step is spent only through the host-held offer

A step the user typed SHALL become part of the offer the extension holds for that form, and SHALL
run only when the create submits that offer's id with the step's item id selected, exactly as a
setup step a provider file declared. The form SHALL send no command text to the extension at any
point: adding, editing, removing, and creating each name an offer or an item the extension already
holds. A save SHALL NOT record a typed step in any configuration file.

#### Scenario: Save defaults after adding a step

- **WHEN** a typed step is present and selected and the user saves current choices as defaults
- **THEN** the repository's native configuration records no setup command
- **AND** the step is still offered, selected, in the form that saved

#### Scenario: The source is switched after adding a step

- **WHEN** a typed step is present and the user takes a different provisioning source
- **THEN** the replacement offer still carries the typed step, with its selection kept

## MODIFIED Requirements

### Requirement: A choice that configuration cannot express is stated, not silently dropped

WHERE a chosen state has no expression in the repository's own provisioning configuration, the
create form SHALL state before the save that the choice applies to this create only, and the
extension SHALL leave that choice unrecorded rather than approximating it.

#### Scenario: A setup command the user chose to run

- **WHEN** the user checks a setup command a provider file or a suggestion supplied, and saves
- **THEN** the saved configuration grants that command no standing consent
- **AND** the command is offered unchecked the next time the form is opened

#### Scenario: A setup command the user typed

- **WHEN** the user has added a setup step for this create and saves
- **THEN** the saved configuration records nothing of it
- **AND** the next opening of the form does not offer it

### Requirement: Only setup the user selected runs

After a worktree is created, the extension SHALL run only the setup steps selected from the provisioning offer shown in that create form.

- A step a provider file or a suggestion supplied starts unselected on every opening; a step the user typed into this form starts selected.
- A stale, unknown, or replaced offer runs nothing and requires a fresh offer and submission.
- Selected steps run in offer order after selected material and named ports have been applied.

#### Scenario: A checked-in command was not selected

- **WHEN** a provisioning offer contains a setup command and the user creates the worktree without selecting it
- **THEN** the worktree is created and that command does not run
