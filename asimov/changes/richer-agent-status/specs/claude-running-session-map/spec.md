# claude-running-session-map Delta

## ADDED Requirements

### Requirement: Preserve Claude registry lifecycle state

The host SHALL carry a live registry record's lifecycle status only when it is exactly `busy`, `waiting`, or `idle`; an absent or unrecognized value SHALL remain absent rather than being guessed. A valid finite, non-negative `statusUpdatedAt` SHALL travel with a recognized status and SHALL NOT be advanced by a registry scan or treated as a heartbeat.

#### Scenario: A registry publishes a lifecycle state

- **WHEN** a live record carries `status: "waiting"` and a valid `statusUpdatedAt`
- **THEN** both fields are present in the enumerated session unchanged

#### Scenario: A future registry publishes an unknown state

- **WHEN** a live record carries a status outside `busy`, `waiting`, and `idle`
- **THEN** its lifecycle status is absent from the enumerated session rather than mapped to a known state
