# Helix Architecture Diagrams

This document contains visual diagrams depicting Helix's dual-modality architecture, subsystem boundaries, and component interaction topology.

---

## 1. Dual-Modality System Overview

Helix operates across two complementary operating modes:

1. **File Pack Generation**: Inspects an existing repository and emits minimal, platform-tailored configuration packs (`AGENTS.md` ≤ 300 tokens, `.helix/`, skills, MCPs).
2. **Autonomous Execution Engine**: Drives coding agents with progressive context assembly, worktree isolation, security bounds, and zero-token mechanical gates.

```mermaid
flowchart TD
    User["Developer / CI Pipeline"] --> CLI["Helix CLI (`helix init · run · bench · gate`)"]

    subgraph PackGen["File Pack Generation Subsystem (`src/generate.ts`)"]
        Detect["Stack Detector (`src/detect.ts`)"]
        Catalogs["Catalogs (`crew.ts`, `mcps.ts`, `platforms.ts`, `skills.ts`)"]
        Adapters["Platform Adapters (`src/adapters/`)"]
        PackOutput["Emitted Pack:\n- `AGENTS.md` (≤300t)\n- `.helix/gate.mjs` (0t)\n- Vendor configs (`opencode.json`, `.cursor/`, etc.)"]

        Detect --> Adapters
        Catalogs --> Adapters
        Adapters --> PackOutput
    end

    subgraph ExecEngine["Autonomous Execution Engine Subsystem (`src/engine/`)"]
        direction TB
        TaskPlan["Task Definition & Heuristic Planner (`task.ts`)"]
        ContextMgr["Layered Context & Token Budgeting (`context.ts`)"]
        WorktreeMgr["Ephemeral Git Worktree Isolation (`worktree.ts`)"]
        Security["Least-Privilege Security Guard (`security.ts`)"]
        Orchestrator["Agent Orchestrator & 12-Line Handoff Cards (`orchestrator.ts`)"]
        Gate["Mechanical Validation Engine (`gate.ts`, `validator.ts`)"]
        APKS["Adaptive Project Knowledge System (`src/knowledge/`)"]

        TaskPlan --> ContextMgr
        APKS --> ContextMgr
        ContextMgr --> Orchestrator
        Orchestrator --> WorktreeMgr
        Orchestrator --> Security
        Security --> Gate
    end

    CLI -->|"helix init"| PackGen
    CLI -->|"helix run"| ExecEngine
    CLI -->|"helix gate"| Gate
    CLI -->|"helix bench"| ExecEngine

    PackOutput -.->|"Informs"| ExecEngine

    %% Styling
    classDef cliStyle fill:#e3f2fd,stroke:#1565c0,stroke-width:2px;
    classDef packStyle fill:#f1f8e9,stroke:#558b2f,stroke-width:2px;
    classDef execStyle fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px;

    class User,CLI cliStyle;
    class PackGen,Detect,Catalogs,Adapters,PackOutput packStyle;
    class ExecEngine,TaskPlan,ContextMgr,WorktreeMgr,Security,Orchestrator,Gate,APKS execStyle;
```

---

## 2. Component Interaction & Security Boundary

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant Engine as Helix Orchestrator
    participant Context as Context Manager
    participant Worktree as Git Worktree
    participant Agent as Coding Agent
    participant Gate as Mechanical Gate

    Dev->>Engine: helix run "Task description"
    Engine->>Context: Assemble 4-layer context (budget ≤ 3,500t)
    Context-->>Engine: System prompt + Repo map + Task card
    Engine->>Worktree: Create isolated branch & worktree
    Engine->>Agent: Launch agent in isolated worktree
    Agent->>Worktree: Edit code files & write tests
    Agent-->>Engine: Execution completed (claim: success)
    Engine->>Gate: Run zero-token mechanical checks
    Note over Gate: Secrets scan · Lint · Typecheck · Affected tests
    alt Tests Pass
        Gate-->>Engine: Exit 0 (Green)
        Engine->>Worktree: Merge clean diff to target branch
        Engine-->>Dev: Verified completion & summary
    else Tests Fail
        Gate-->>Engine: Exit 1 (Red: Failure excerpt only)
        Engine->>Agent: Retry with failure context (budget ≤ 1,400t)
    end
```
