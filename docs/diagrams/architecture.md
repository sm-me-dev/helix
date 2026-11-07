# Helix v2 system architecture

```mermaid
flowchart TB
    User[Developer] --> CLI["Helix CLI"]
    CLI --> Pack["Pack generator"]
    CLI --> Workflow["5-stage execution workflow"]

    subgraph Stages["INIT → DISCOVER → EXECUTE → VERIFY → COMPLETE"]
        Init[INIT] --> Discover[DISCOVER]
        Discover --> Execute[EXECUTE]
        Execute --> Verify[VERIFY]
        Verify --> Complete[COMPLETE]
    end
    Workflow --> Init
    Execute --> Modes["Four execution modes"]
    Modes --> Master["MODE_1_MASTER_LOOP"]
    Modes --> Scout["MODE_2_DISPOSABLE_SCOUT"]
    Modes --> Audit["MODE_3_ADVERSARIAL_AUDITOR"]
    Modes --> Team["MODE_4_PEER_TEAM"]

    subgraph Knowledge["Three-tier knowledge"]
        T0["Tier 0: route catalog"] --> T1["Tier 1: read-only skills, references, AST scripts"]
        T1 --> T2["Tier 2: episodic quarantine"]
        T2 --> DB[("SQLite · WAL · FTS5 · sqlite-vec")]
        DB --> Compact["Offline helix knowledge compact"]
    end
    Discover --> T0
    Execute --> T1
    Execute --> T2

    Execute --> Daemon["helixd · HTTP API + SSE"]
    Verify --> Daemon
    Serve["helix serve"] --> Daemon
    Daemon <--> TUI["helix tui"]
    Daemon <--> Web["helix web"]

    subgraph Gates["Execution controls"]
        Visibility[VisibilityGate]
        Write[WriteGate]
        StageA["Stage A deterministic checks"]
        StageB["Stage B context-firewalled audit"]
        StageA --> StageB
    end
    Execute --> Visibility
    Execute --> Write
    Verify --> StageA
```

The workflow permits direct `INIT → EXECUTE`, question completion from `EXECUTE`, and retry from `BLOCKED` to `INIT` or `DISCOVER`. The diagram shows the primary successful route and the major runtime boundaries.
