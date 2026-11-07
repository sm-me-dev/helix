# Helix v2 development workflow

```mermaid
stateDiagram-v2
    [*] --> INIT
    INIT --> DISCOVER
    INIT --> EXECUTE: direct / no worktree
    INIT --> BLOCKED
    DISCOVER --> EXECUTE
    DISCOVER --> BLOCKED
    EXECUTE --> VERIFY
    EXECUTE --> COMPLETE: question / no diff gate
    EXECUTE --> BLOCKED
    VERIFY --> COMPLETE
    VERIFY --> BLOCKED
    BLOCKED --> INIT: retry
    BLOCKED --> DISCOVER: resume
    COMPLETE --> [*]
```

```mermaid
flowchart TD
    Task[Task request] --> Bootstrap["Bootstrap < 600 tokens\nTier 0 routes < 250 tokens"]
    Bootstrap --> Select{Select domain and mode}
    Select --> Skill["load_skill · Tier 1 canonical guidance"]
    Select --> Scout["Optional read-only scout\n≤ 8 turns · ≤ 250-token JSON"]
    Skill --> Loop["Master loop · tool_search on demand"]
    Scout --> Loop
    Loop --> Visibility[VisibilityGate]
    Visibility --> Write["WriteGate · path, ownership, approval"]
    Write --> Verify["Stage A deterministic checks"]
    Verify -->|pass and audit selected| Audit["Stage B cross-model firewalled audit"]
    Verify -->|pass| Done[Complete]
    Audit --> Done
    Verify -->|fail| Blocked[Blocked / retry]
    Loop --> Team["Optional peer DAG\nfile locks + ownedPaths"]
    Team --> Loop
    Loop --> Compact["At 92% context threshold, archive old outputs to NOTES.md"]
```

## Stage responsibilities

1. **INIT:** normalize the task, resolve provider configuration, and select workspace/runtime state.
2. **DISCOVER:** match Tier 0 domain routes, then load only selected Tier 1 skills and tools.
3. **EXECUTE:** run the master loop; bounded scouts and peer teams are optional topologies.
4. **VERIFY:** run deterministic gates first. A selected second-model audit runs only after Stage A passes and receives a context-firewalled summary.
5. **COMPLETE:** persist the final outcome and expose it to the CLI and daemon clients.

Tier 2 episodic records are retrieved as quarantined hints. `helix knowledge compact` reviews and maintains them offline; the runtime does not silently promote them to canonical rules.
