---
id: decisions.sqlite-fts5-apks
type: decision
domain: knowledge-system
title: Adopt Disposable SQLite FTS5 for Adaptive Knowledge Indexing
status: verified
sources:
  - path: src/knowledge/index.ts
dependencies:
  - context-optimization
created_at: 2026-11-02
updated_at: 2026-11-02
verified_at: 2026-11-02
tags:
  - architecture
  - sqlite
  - fts5
  - indexing
  - decisions
---

# Decision: Adopt Disposable SQLite FTS5 for Adaptive Knowledge Indexing

## Context

Helix requires persistent, structured, evolving project knowledge that can be dynamically retrieved for agent tasks without introducing heavy external vector databases, graph databases, or remote cloud services.

## Decision

1. Canonical knowledge is stored in human-readable Markdown files with validated YAML frontmatter in `.helix/knowledge/`.
2. The SQLite index in `.helix/cache/knowledge.sqlite` is a derived, disposable cache. It can be deleted and 100% rebuilt from canonical Markdown files at any time.
3. Indexing uses Node 22 built-in `node:sqlite` (`DatabaseSync`) with `fts5` full-text search, BM25 ranking, and incremental SHA-256 content hashing.
4. Token efficiency is guaranteed through deterministic relevance scoring and strict token budget enforcement.
