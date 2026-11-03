# Helix Development Workflow Diagram

This document illustrates the end-to-end development workflow when using Helix, showing how a developer interacts with Helix, how Helix guides the underlying AI coding agent, and how validation gates enforce software quality.

---

## The Helix Developer Journey

```mermaid
flowchart TD
    %% Roles & Boundaries
    subgraph DevSpace["Developer Space"]
        Dev["Developer"]
        TaskDef["1. Define Task / Issue"]
        Review["8. Final Review & Merge"]
    end

    subgraph HelixHarness["Helix Harness"]
        ContextMgr["2. Layered Context & Token Budget"]
        KnowledgeRetriever["3. APKS Knowledge Retrieval"]
        TaskPlanner["4. Tier Planning (Tiers 1-4) & Handoff Card"]
        Gate["7. Mechanical Validation Gate (0 Tokens)"]
    end

    subgraph ProjectSpace["Project & Persistent Knowledge"]
        Repo["Git Repository & Source Code"]
        KnowledgeBase[".helix/knowledge/ Domain Contracts"]
        Worktree["Ephemeral Isolated Worktree"]
    end

    subgraph AgentSpace["AI Coding Agent"]
        Agent["Underlying AI Agent (Claude Code / OpenCode / Cursor)"]
        Execution["5. Implement Changes in Isolation"]
        OptionalReviewer{"6. High-Assurance / Security Task?"}
        ReviewerAgent["Independent Diff Reviewer"]
    end

    subgraph ToolSpace["Development Tools & Tests"]
        LintTest["Secrets, Linter, Typecheck, Test Runner"]
    end

    %% Workflow Connections
    Dev --> TaskDef
    TaskDef --> ContextMgr
    Repo --> ContextMgr
    KnowledgeBase --> KnowledgeRetriever
    KnowledgeRetriever --> ContextMgr

    ContextMgr --> TaskPlanner
    TaskPlanner -->|"12-Line Handoff Card"| Agent
    TaskPlanner -.->|"Creates Isolated Workspace"| Worktree

    Agent --> Execution
    Worktree <--> Execution

    Execution --> OptionalReviewer
    OptionalReviewer -->|"Yes"| ReviewerAgent
    OptionalReviewer -->|"No"| Gate
    ReviewerAgent --> Gate

    Gate --> LintTest
    LintTest -->|"Pass (Green)"| Review
    LintTest -.->|"Fail (Red: Failures Only)"| Execution

    Review -->|"Approved"| Repo

    %% Styling
    classDef devStyle fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,color:#01579b;
    classDef helixStyle fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#4a148c;
    classDef agentStyle fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#e65100;
    classDef projStyle fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#1b5e20;
    classDef toolStyle fill:#eceff1,stroke:#455a64,stroke-width:2px,color:#263238;

    class Dev,TaskDef,Review devStyle;
    class ContextMgr,KnowledgeRetriever,TaskPlanner,Gate helixStyle;
    class Agent,Execution,OptionalReviewer,ReviewerAgent agentStyle;
    class Repo,KnowledgeBase,Worktree projStyle;
    class LintTest toolStyle;
```

---

## Workflow Stages Explained

1. **Task Definition:** The developer starts with an existing codebase and assigns a task (e.g. bug fix, feature, refactoring).
2. **Context Assembly:** Helix inspects the project, selects relevant files without loading the whole repo, and enforces strict token budgets.
3. **Knowledge Retrieval:** The Adaptive Project Knowledge System (APKS) injects domain contracts and naming rules in under 15ms.
4. **Task Planning:** Helix classifies the work into Tiers 1–4. Simple tasks stay single-agent; complex tasks receive a concise 12-line handoff card.
5. **Execution in Isolation:** The coding agent executes changes inside an ephemeral Git worktree, leaving the developer's working tree clean.
6. **Optional Reviewer:** For security-sensitive or high-risk tasks, an independent reviewer agent audits only the diff.
7. **Zero-Token Gate:** Helix mechanically verifies secrets, lint, types, and affected tests using 0 model tokens.
8. **Developer Review:** The developer inspects a verified, clean diff with high confidence and merges.
