## ADDED Requirements

### Requirement: A file can be added to copy for this create only

Wherever the create form shows a provisioning offer, it SHALL offer an action that lets the user
choose one file through an extension-owned system picker. On a platform that can safely hold a
no-follow regular file, an admitted file inside the repository SHALL appear selected as a Copy row,
marked as added for this create and warning that it may contain secrets. Its contents SHALL NOT be
read before Create.

#### Scenario: An environment file is added and the worktree is created

- **WHEN** the user chooses the repository's ordinary `.env` file and creates the worktree with the row selected
- **THEN** `.env` is copied from the exact file object the extension held after the picker returned
- **AND** the row warned that the file may contain secrets

#### Scenario: The platform cannot safely hold the source

- **WHEN** the picker returns a file but the platform cannot open its final component without following
- **THEN** the offer is unchanged and the action becomes available again

#### Scenario: Admission does not settle

- **WHEN** containment or safe hold does not answer within the bounded admission window
- **THEN** the unchanged fresh offer releases the form
- **AND** that unfinished admission consumes at most one globally bounded lifecycle slot

#### Scenario: The picker is dismissed or chooses outside the repository

- **WHEN** the picker is dismissed or the chosen file does not remain resolved inside the repository around the safe hold
- **THEN** the offer is unchanged and the action becomes available again

### Requirement: A picked copy is spent only through private host-held provenance

The form SHALL send no file path, handle, or origin marker to the extension when adding, saving, or
creating. The extension SHALL associate the held file privately with the exact offer entry before item
ids are reminted. Create SHALL copy it only when the current offer id and selected opaque item id
redeem and claim that private holder. A stale, foreign, superseded, already-claimed, or presentation-
only row SHALL authorize no held-file copy.

#### Scenario: A display marker does not grant authority

- **WHEN** a provider row carries the same path, source label, or added-for-create display value as a picked row but no private holder
- **THEN** Create treats it only as ordinary model material

#### Scenario: One selected holder cannot be claimed

- **WHEN** more than one picked row is selected and any holder cannot be claimed
- **THEN** Create dispatches nothing and closes every holder already claimed for that submission

### Requirement: Picked files survive only their opening's compatible reissues

A picked-file record and its checkbox state SHALL survive source switches, Save rereads, and picker
answers in the same opening. Current provider entries, exclusions, and possible destination contenders
SHALL take precedence: an initial duplicate SHALL be refused, and a later conflicting source SHALL
withhold the affected record prefix without discarding its holder or tick. The record and all
untransferred holders SHALL be closed when the opening retires or the extension disposes.

#### Scenario: The source is switched after adding a file

- **WHEN** a picked file is present and the user takes a compatible provisioning source
- **THEN** the replacement offer still carries that file with its selection kept

#### Scenario: A source excludes the picked path

- **WHEN** the active source excludes the path the picker returned
- **THEN** no ad-hoc duplicate enters the offer and the provider exclusion remains authoritative

#### Scenario: A later source conflicts and the prior source returns

- **WHEN** switching sources introduces a duplicate or possible-fold conflict and switching back removes it
- **THEN** the picked row returns with its prior checkbox state and the same held file object

### Requirement: Save defaults never persists a picked file

Save SHALL identify picked rows from the current offer's private provenance, omit them from the native
configuration divergence, and reissue the same opening with their record and selection preserved.
Presentation labels, paths, and origin fields SHALL NOT decide persistence.

#### Scenario: Save defaults before Create

- **WHEN** a picked file is selected and Save defaults is pressed
- **THEN** the native configuration records nothing of that file
- **AND** the file remains offered with its selection kept so Create may follow

### Requirement: An opened copy-file picker holds the form until it is answered

From the moment the copy-file picker is opened until the form receives a fresh answer, the form SHALL
NOT offer to create, save, change repository or source, or open another picker/input. Every admitted
picker request SHALL receive one fresh offer unless the form is gone or a later ordered action has
superseded it; a discarded picker result SHALL close its holder.

#### Scenario: The picker is cancelled

- **WHEN** the user cancels the picker
- **THEN** the unchanged fresh offer releases every held control and the copy action is available again

#### Scenario: A slow picker loses to a source switch

- **WHEN** a later ordered source action wins while the picker is open
- **THEN** the picker answer publishes nothing, changes no record, and closes any holder it produced
