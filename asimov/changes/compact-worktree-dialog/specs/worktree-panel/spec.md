## ADDED Requirements

### Requirement: Creation separates routine files from setup consent

The dialog SHALL collapse routine files, keeping selected shared-folder consequences visible. Declared setup commands SHALL remain visible under existing consent rules, separate from detected suggestions. Ports and problems SHALL stay visible; conflicts, file suggestions and new or changed files in replacement offers SHALL expose only the affected file choices for review, without expanding unchanged routine files.

### Requirement: Provisioning actions use compact contextual controls

The create dialog SHALL offer detected configuration sources through one labelled selector instead of repeated alternate-source buttons. Adding files and setup commands SHALL use small contextual actions in their respective sections. Saving repository defaults SHALL remain a separate explicit action describing its persistence limits. These presentation changes SHALL preserve source switching, selection, busy-state and focus-restoration behavior.

### Requirement: Creation uses a compact editor-native presentation

The create dialog SHALL use a compact theme-aware layout without nested decorative cards or per-path background badges. Secondary actions SHALL be visually lighter than the persistent primary action. All supported after-create choices and folder destinations SHALL remain reachable. The optional first prompt SHALL be revealed on request without losing an entered prompt when collapsed. Dangerous permissions SHALL remain explicitly labelled and never become a default through this redesign.

### Requirement: Sparse creation presents only useful controls

With no offered files, the dialog SHALL show No extra files and the add-file action without zero counters or an Edit control. A single suggested command SHALL be shown directly with its suggestion status and source, without nested headings or the repeated generic setup-order note. File warnings and non-generic command explanations SHALL remain visible.

### Requirement: Repository defaults live with advanced creation settings

Repository defaults SHALL be reachable under the collapsed Branch, location & defaults disclosure. Moving the controls SHALL preserve their offer-dependent availability, write semantics and accessible persistence description. Without a source selector, the Environment heading SHALL be omitted while provisioning problems remain visible.

### Requirement: File choices use one compact row

Ordinary file choices SHALL show checkbox, path and any suggestion warning on one line without per-source headings. A source equal to the path SHALL not be repeated. Distinct provenance and full truncated paths SHALL remain accessible; shared-main warnings and conflict explanations SHALL remain visible. Conflict explanations may use an additional line.

### Requirement: Creation remains navigable in short viewports

The create dialog SHALL keep its title and actions outside the scrolling form body. Keyboard-focused controls SHALL remain visible without footer overlap, including when action feedback wraps. Other worktree dialogs SHALL retain their existing layout.

### Requirement: Shared folders have a bounded consequence summary

Selected linked folders SHALL have one persistent aggregate warning that writes affect the main checkout. Their individual paths and warnings SHALL remain reachable through a disclosure without expanding unrelated copies. Changing selection SHALL update the aggregate without moving focused controls.

### Requirement: Setup availability and execution order are explicit

Multiple setup commands SHALL distinguish configured, suggested and selected counts, including collapsed suggestions. Their displayed order SHALL match offer execution order and state that selected commands run top to bottom. Provider commands SHALL remain unchecked until explicitly selected; no bulk or automatic consent is introduced.

### Requirement: Creation adapts to low horizontal panels

In low viewports the create form SHALL occupy the full webview surface without surrounding dialog chrome. When also wide enough it SHALL place branch and environment choices beside after-create and advanced settings; taller viewports SHALL retain the compact dialog. Resizing SHALL preserve the same draft, selection, disclosures and focus without reopening or re-offering the form.

### Requirement: Two-column creation scrolls preparation independently

In the two-column presentation, scrolling branch, Files or Setup SHALL leave launch controls in place. The secondary column SHALL scroll independently only when its own expanded content exceeds the available height; no controls may be clipped or made unreachable. The one-column presentation SHALL retain a single scrolling form body.

### Requirement: Panel expansion is explicit

On the bottom-panel terminal surface, the create form SHALL keep a neutral Panel height action available at both low and tall heights, invoking VS Code’s Toggle Maximized Panel command, labelled as a toggle rather than promising a maximize-only operation. Sidebar and editor surfaces SHALL NOT offer or execute this action. Opening or resizing the form SHALL NOT automatically resize the host or recreate the draft.

### Requirement: Narrow worktree rows retain branch and status

At very narrow widths, worktree rows SHALL keep a visible branch label and move status marks below it when they cannot fit beside it. Missing, locked and workspace status SHALL remain readable rather than being clipped or hidden.

### Requirement: Visible repository lists keep a create action below their worktrees

Each expanded, displayed repository SHALL offer one always-visible create action below its worktrees, including after an idle disclosure or Show all control. A main-only repository SHALL retain its existing No other worktrees yet state and its create action, without a duplicate button. Actions SHALL target their own repository; unavailable creation and states with no matching repository SHALL retain their existing absence rules.

### Requirement: Normal-width status chips remain trailing

At normal widths, worktree status chips SHALL align to the trailing row edge without empty action space after them. Row actions SHALL remain keyboard-reachable and SHALL NOT obscure the branch or status; revealing actions SHALL NOT move the status chips.

## MODIFIED Requirements

### Requirement: Agent startup honours the setup wait choice

WHERE a create will start an agent and at least one setup step is selected, the form SHALL offer Start agent after setup, recommended and selected by default unless the user has chosen otherwise. The control SHALL be hidden when no setup is selected or no agent will start.

- With the choice off, agent startup begins after materialization and port allocation without waiting for setup to exit.
- With the choice on, the agent starts only after every selected setup step succeeds.
- A failed gated setup starts no agent and reports the failure.
- The wait control SHALL be presented beside the setup steps it gates, not among the agent's own settings.

### Requirement: Each after-create action states its consequence

The create form SHALL communicate its selected after-create action through the visible action and agent controls. Agent mode SHALL NOT add a sentence repeating those controls. Other modes SHALL retain their concise consequence explanation, updated when the selection changes.

### Requirement: A setup gate states the resulting order as its own line

The selected wait control SHALL state Start agent after setup without a duplicate explanation. When the user clears it while setup is selected, the overlapping execution order SHALL be explained on a separate line.
