## MODIFIED Requirements

### Requirement: Agent startup honours the setup wait choice

WHERE a create will start an agent and at least one setup step is selected, the form SHALL offer the
choice to wait for setup, recommended and selected by default, and SHALL state the order it produces.

- With the choice off, agent startup begins after materialization and port allocation without waiting for setup to exit.
- With the choice on, the agent starts only after every selected setup step succeeds.
- A failed gated setup starts no agent and reports the failure.
- Where the offer carries a setup step and none is selected, the wait control remains visible but disabled, and states nothing beyond its own label.
- Where the offer carries no setup step, or no offer has arrived, the wait control SHALL NOT be presented.
- The wait control SHALL be presented beside the setup steps it gates, not among the agent's own settings.

#### Scenario: Setup is selected for an agent create

- **WHEN** an agent create is chosen and a setup step is selected
- **THEN** the wait choice is enabled and selected
- **AND** the form states that the agent starts after the selected setup finishes

#### Scenario: The repository declares no setup

- **WHEN** an agent create is chosen and the offer holds no setup step
- **THEN** no wait control is shown
