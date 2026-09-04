## ADDED Requirements

### Requirement: A file can be added to copy for this create only

Wherever the create form shows a provisioning offer, it SHALL offer an action that lets the user
choose one file through an extension-owned system picker. A file admitted inside the repository
SHALL appear selected as a Copy row, naming itself as added for this create in place of a source
file, and SHALL NOT be offered by a later opening.

#### Scenario: An environment file is added and the worktree is created

- **WHEN** the user chooses the repository's `.env` file and creates the worktree with the row selected
- **THEN** `.env` is copied into the new worktree through the same materialization path as a configured copy

#### Scenario: The picker is dismissed or chooses outside the repository

- **WHEN** the picker is dismissed or returns a file outside the repository
- **THEN** the offer is unchanged and the form offers the action again

### Requirement: A picked copy is spent only through the host-held offer

The form SHALL send no file path to the extension when adding or creating. The extension SHALL add
the host-chosen repository-relative path to the offer held for that opening, and Create SHALL copy it
only when it submits that offer id with the row's opaque item id selected. A stale, foreign, or
superseded id SHALL authorize no copy. Save defaults SHALL NOT record the picked file.

#### Scenario: Save defaults after adding a file

- **WHEN** a picked file is present and selected and the user saves current choices as defaults
- **THEN** the repository's native configuration records nothing of that file
- **AND** the file remains offered, selected, in the form that saved

#### Scenario: The source is switched after adding a file

- **WHEN** a picked file is present and the user takes a different provisioning source
- **THEN** the replacement offer still carries that file with its selection kept

### Requirement: An opened copy-file picker holds the form until it is answered

From the moment the copy-file picker is opened until the form is answered, the form SHALL NOT offer
to create, save, change source, or open another picker/input. Every admitted picker request SHALL be
answered unless the form that opened it is gone.
