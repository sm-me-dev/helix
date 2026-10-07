// Representative 15-server MCP tools/list composite.
//
// PROVENANCE (2026-10-07): hand-composite, NOT a live capture — except the
// playwright section, whose 25 tool names are the real captured set from
// fixtures/captures/playwright.tools.json (same day, same script). Tool names
// elsewhere follow the vendors' documented surfaces with trimmed descriptions
// and realistic input schemas in the standard tools/list envelope ($schema,
// annotations). Per-tool weight is calibrated against 4 live captures taken
// the same day (graphify 1336t/10 tools, playwright 4413t/25, serena 8204t/29,
// chrome-devtools 5914t/30 → ~130–280 tokens/tool); this composite lands in
// that band. Purpose: measure the SCALE of a 15-server "connect everything"
// setup, not to call anything. Do not cite individual names as a directory —
// prefer real captures from scripts/measure-mcp.mjs wherever launchable.
type Param = [name: string, desc: string];
type Row = [name: string, desc: string, params: Param[]];

const SERVERS: [server: string, tools: Row[]][] = [
  [
    "filesystem",
    [
      [
        "read_text_file",
        "Read a complete file as text",
        [
          ["path", "Absolute path to the file"],
          ["head", "Read only the first N lines"],
          ["tail", "Read only the last N lines"],
        ],
      ],
      [
        "read_media_file",
        "Read an image or audio file",
        [["path", "Absolute path to the media file"]],
      ],
      [
        "read_multiple_files",
        "Read several files at once",
        [["paths", "Array of absolute file paths"]],
      ],
      [
        "write_file",
        "Create or overwrite a file",
        [
          ["path", "Absolute path to write"],
          ["content", "Full file content"],
        ],
      ],
      [
        "edit_file",
        "Surgical text replacement in a file",
        [
          ["path", "Absolute path to the file"],
          ["edits", "Old/new string pairs to apply"],
          ["dryRun", "Preview edits without writing"],
        ],
      ],
      ["create_directory", "Create a directory path", [["path", "Absolute directory path"]]],
      ["list_directory", "List entries in a directory", [["path", "Absolute directory path"]]],
      [
        "list_directory_with_sizes",
        "List entries with sizes",
        [
          ["path", "Absolute directory path"],
          ["sortBy", "Sort by name, size, or time"],
        ],
      ],
      [
        "directory_tree",
        "Recursive tree as JSON",
        [
          ["path", "Root path to walk"],
          ["excludePatterns", "Glob patterns to skip"],
        ],
      ],
      [
        "move_file",
        "Move or rename files",
        [
          ["source", "Absolute source path"],
          ["destination", "Absolute destination path"],
        ],
      ],
      [
        "search_files",
        "Recursive filename and content search",
        [
          ["path", "Root path to search under"],
          ["pattern", "Regex or glob pattern"],
          ["excludePatterns", "Glob patterns to skip"],
        ],
      ],
      ["get_file_info", "Size, times, and permissions", [["path", "Absolute path to stat"]]],
      ["list_allowed_directories", "Roots this server may touch", []],
    ],
  ],
  [
    "fetch",
    [
      [
        "fetch",
        "Fetch a URL as markdown",
        [
          ["url", "The URL to fetch"],
          ["max_length", "Maximum characters to return"],
          ["start_index", "Character offset to start from"],
        ],
      ],
    ],
  ],
  [
    "memory",
    [
      [
        "create_entities",
        "Create typed entities",
        [["entities", "Entities with names, types, observations"]],
      ],
      [
        "create_relations",
        "Link entities with relations",
        [["relations", "From/to pairs with relation types"]],
      ],
      [
        "add_observations",
        "Append observations to entities",
        [
          ["entityName", "Target entity"],
          ["observations", "New observation strings"],
        ],
      ],
      ["delete_entities", "Remove entities", [["entityNames", "Entity names to delete"]]],
      [
        "delete_observations",
        "Remove observations",
        [
          ["entityName", "Target entity"],
          ["observations", "Observations to remove"],
        ],
      ],
      ["delete_relations", "Remove relations", [["relations", "Relations to remove"]]],
      ["read_graph", "Read the whole knowledge graph", []],
      ["search_nodes", "Search entities and facts", [["query", "Search query string"]]],
      ["open_nodes", "Open specific entities by name", [["names", "Entity names to open"]]],
    ],
  ],
  [
    "sequential-thinking",
    [
      [
        "sequentialthinking",
        "Structured step-by-step reasoning trace",
        [
          ["thought", "Current thinking step"],
          ["thoughtNumber", "1-based step index"],
          ["totalThoughts", "Estimated total steps"],
          ["nextThoughtNeeded", "Whether another step follows"],
        ],
      ],
    ],
  ],
  [
    "postgres",
    [["query", "Run read-only SQL against Postgres", [["sql", "The SELECT statement to run"]]]],
  ],
  [
    "sqlite",
    [
      ["read_query", "Run a SELECT query", [["query", "The SELECT statement"]]],
      ["write_query", "Run INSERT, UPDATE, or DELETE", [["query", "The write statement"]]],
      ["list_tables", "List tables in the database", []],
      ["describe_table", "Schema of one table", [["table_name", "Table to describe"]]],
      ["append_insight", "Record a business insight", [["insight", "Insight text to store"]]],
    ],
  ],
  [
    "github-full",
    [
      [
        "create_issue",
        "Open an issue",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["title", "Issue title"],
          ["body", "Issue body markdown"],
        ],
      ],
      [
        "list_issues",
        "List issues with filters",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["state", "open, closed, or all"],
        ],
      ],
      [
        "get_issue",
        "Full issue detail",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["issue_number", "Issue number"],
        ],
      ],
      [
        "update_issue",
        "Edit title, body, or state",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["issue_number", "Issue number"],
          ["state", "New state"],
        ],
      ],
      [
        "add_issue_comment",
        "Comment on an issue",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["issue_number", "Issue number"],
          ["body", "Comment markdown"],
        ],
      ],
      [
        "create_pull_request",
        "Open a pull request",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["title", "PR title"],
          ["head", "Source branch"],
          ["base", "Target branch"],
        ],
      ],
      [
        "list_pull_requests",
        "List pull requests",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["state", "open, closed, or all"],
        ],
      ],
      [
        "get_pull_request",
        "Full pull request detail",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["pull_number", "PR number"],
        ],
      ],
      [
        "merge_pull_request",
        "Merge a pull request",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["pull_number", "PR number"],
          ["merge_method", "merge, squash, or rebase"],
        ],
      ],
      [
        "update_pull_request_branch",
        "Update branch with base",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["pull_number", "PR number"],
        ],
      ],
      [
        "list_commits",
        "Commits on a branch",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["sha", "Branch or SHA"],
        ],
      ],
      [
        "get_commit",
        "Single commit detail",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["sha", "Commit SHA"],
        ],
      ],
      [
        "create_branch",
        "Create a branch",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["branch", "New branch name"],
          ["sha", "Base SHA"],
        ],
      ],
      [
        "list_branches",
        "List branches",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
        ],
      ],
      [
        "create_repository",
        "Create a repository",
        [
          ["name", "Repository name"],
          ["private", "Whether private"],
        ],
      ],
      [
        "fork_repository",
        "Fork a repository",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
        ],
      ],
      ["search_repositories", "Search repositories", [["query", "Search query"]]],
      [
        "search_code",
        "Search code",
        [
          ["q", "Code search query"],
          ["perPage", "Results per page"],
        ],
      ],
      ["search_issues", "Search issues and PRs", [["q", "Issue search query"]]],
      [
        "list_workflows",
        "List Actions workflows",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
        ],
      ],
      [
        "get_workflow_run",
        "One workflow run",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["run_id", "Run id"],
        ],
      ],
      [
        "rerun_workflow_run",
        "Rerun a workflow run",
        [
          ["owner", "Repository owner"],
          ["repo", "Repository name"],
          ["run_id", "Run id"],
        ],
      ],
      [
        "create_gist",
        "Create a gist",
        [
          ["files", "Filenames mapped to content"],
          ["public", "Whether public"],
        ],
      ],
      ["list_notifications", "List notifications", [["all", "Include read"]]],
    ],
  ],
  [
    "gitlab",
    [
      ["list_projects", "List projects", [["search", "Search string"]]],
      ["get_project", "Single project detail", [["project_id", "Project id or path"]]],
      [
        "list_issues",
        "List issues",
        [
          ["project_id", "Project id"],
          ["state", "opened, closed, or all"],
        ],
      ],
      [
        "get_issue",
        "Single issue",
        [
          ["project_id", "Project id"],
          ["issue_iid", "Issue iid"],
        ],
      ],
      [
        "create_issue",
        "Create an issue",
        [
          ["project_id", "Project id"],
          ["title", "Issue title"],
        ],
      ],
      [
        "update_issue",
        "Update an issue",
        [
          ["project_id", "Project id"],
          ["issue_iid", "Issue iid"],
          ["state_event", "close or reopen"],
        ],
      ],
      [
        "list_merge_requests",
        "List merge requests",
        [
          ["project_id", "Project id"],
          ["state", "opened, merged, closed, or all"],
        ],
      ],
      [
        "get_merge_request",
        "Single merge request",
        [
          ["project_id", "Project id"],
          ["mr_iid", "MR iid"],
        ],
      ],
      [
        "create_merge_request",
        "Create a merge request",
        [
          ["project_id", "Project id"],
          ["title", "MR title"],
          ["source_branch", "Source branch"],
          ["target_branch", "Target branch"],
        ],
      ],
      ["list_pipelines", "List pipelines", [["project_id", "Project id"]]],
      [
        "create_pipeline",
        "Trigger a pipeline",
        [
          ["project_id", "Project id"],
          ["ref", "Branch or tag"],
        ],
      ],
      [
        "search",
        "Search across GitLab",
        [
          ["query", "Search query"],
          ["scope", "projects, issues, or merge_requests"],
        ],
      ],
    ],
  ],
  [
    "slack",
    [
      ["list_channels", "List channels", [["types", "public_channel, private_channel, im"]]],
      [
        "post_message",
        "Post a message",
        [
          ["channel_id", "Channel id"],
          ["text", "Message text"],
        ],
      ],
      [
        "reply_to_thread",
        "Reply in a thread",
        [
          ["channel_id", "Channel id"],
          ["thread_ts", "Parent timestamp"],
          ["text", "Reply text"],
        ],
      ],
      [
        "add_reaction",
        "Add an emoji reaction",
        [
          ["channel_id", "Channel id"],
          ["timestamp", "Message timestamp"],
          ["name", "Emoji name"],
        ],
      ],
      ["list_users", "List workspace users", []],
      ["get_user_profile", "One user profile", [["user_id", "User id"]]],
      [
        "search_messages",
        "Search message history",
        [
          ["query", "Search query"],
          ["count", "Results to return"],
        ],
      ],
      [
        "list_thread_replies",
        "Replies in a thread",
        [
          ["channel_id", "Channel id"],
          ["thread_ts", "Parent timestamp"],
        ],
      ],
    ],
  ],
  [
    "notion",
    [
      [
        "search",
        "Search pages and databases",
        [
          ["query", "Search query"],
          ["filter", "page or database"],
        ],
      ],
      ["fetch", "Fetch a page by id", [["id", "Page or block id"]]],
      [
        "query_data_source",
        "Query a database",
        [
          ["data_source_id", "Database id"],
          ["filter", "Filter object"],
          ["sorts", "Sort objects"],
        ],
      ],
      [
        "create_pages",
        "Create pages",
        [
          ["parent", "Parent page or database"],
          ["properties", "Page properties"],
        ],
      ],
      [
        "update_page_properties",
        "Update page properties",
        [
          ["page_id", "Page id"],
          ["properties", "Properties to set"],
        ],
      ],
      [
        "create_comment",
        "Comment on a page",
        [
          ["page_id", "Page id"],
          ["text", "Comment text"],
        ],
      ],
    ],
  ],
  [
    "linear-full",
    [
      [
        "list_issues",
        "List issues with filters",
        [
          ["team", "Team key"],
          ["status", "Status name"],
        ],
      ],
      ["get_issue", "Single issue detail", [["id", "Issue id"]]],
      [
        "create_issue",
        "Create an issue",
        [
          ["teamId", "Team id"],
          ["title", "Issue title"],
          ["description", "Issue description"],
        ],
      ],
      [
        "update_issue",
        "Update an issue",
        [
          ["id", "Issue id"],
          ["stateId", "New workflow state"],
        ],
      ],
      ["list_teams", "List teams", []],
      ["list_projects", "List projects", []],
      [
        "create_comment",
        "Comment on an issue",
        [
          ["issueId", "Issue id"],
          ["body", "Comment markdown"],
        ],
      ],
      ["search_issues", "Search issues", [["query", "Search query"]]],
    ],
  ],
  [
    "sentry-full",
    [
      ["list_organizations", "List organizations", []],
      ["list_projects", "List projects", [["organization_slug", "Organization slug"]]],
      [
        "list_issues",
        "List issues",
        [
          ["organization_slug", "Organization slug"],
          ["project_slug", "Project slug"],
          ["statsPeriod", "Stats window like 24h"],
        ],
      ],
      [
        "get_issue",
        "Single issue with stacktrace",
        [
          ["organization_slug", "Organization slug"],
          ["issue_id", "Issue id"],
        ],
      ],
      [
        "update_issue",
        "Resolve or archive",
        [
          ["organization_slug", "Organization slug"],
          ["issue_id", "Issue id"],
          ["status", "resolved or archived"],
        ],
      ],
      [
        "list_events",
        "Events for an issue",
        [
          ["organization_slug", "Organization slug"],
          ["issue_id", "Issue id"],
        ],
      ],
      [
        "search_errors",
        "Search by message or fingerprint",
        [
          ["organization_slug", "Organization slug"],
          ["query", "Search query"],
        ],
      ],
      ["list_releases", "List releases", [["organization_slug", "Organization slug"]]],
    ],
  ],
  [
    "playwright-real",
    [
      ["browser_navigate", "Go to a URL", [["url", "The URL to navigate to"]]],
      ["browser_navigate_back", "Back in history", []],
      ["browser_snapshot", "Accessibility snapshot", []],
      [
        "browser_click",
        "Click an element",
        [
          ["element", "Human-readable description"],
          ["ref", "Element reference from snapshot"],
        ],
      ],
      [
        "browser_hover",
        "Hover an element",
        [
          ["element", "Human-readable description"],
          ["ref", "Element reference from snapshot"],
        ],
      ],
      [
        "browser_type",
        "Type into an element",
        [
          ["element", "Human-readable description"],
          ["ref", "Element reference from snapshot"],
          ["text", "Text to type"],
          ["submit", "Press Enter after typing"],
        ],
      ],
      [
        "browser_fill_form",
        "Fill several fields",
        [["fields", "Array of field selectors and values"]],
      ],
      [
        "browser_select_option",
        "Pick dropdown options",
        [
          ["element", "Human-readable description"],
          ["ref", "Element reference from snapshot"],
          ["values", "Option values to select"],
        ],
      ],
      [
        "browser_drag",
        "Drag between elements",
        [
          ["sourceElement", "Drag source description"],
          ["destinationElement", "Drop target description"],
        ],
      ],
      ["browser_file_upload", "Upload files", [["paths", "Absolute file paths"]]],
      ["browser_press_key", "Press a keyboard key", [["key", "Key name like Enter or ArrowLeft"]]],
      [
        "browser_wait_for",
        "Wait for text or time",
        [
          ["text", "Text to wait for"],
          ["time", "Seconds to wait"],
        ],
      ],
      ["browser_console_messages", "Console output", []],
      ["browser_network_requests", "Network request log", []],
      [
        "browser_take_screenshot",
        "Screenshot the page",
        [
          ["fullPage", "Capture the full scrollable page"],
          ["type", "png, jpeg, or webp"],
        ],
      ],
      ["browser_emulate_media", "Emulate CSS media features", [["media", "Media type override"]]],
      [
        "browser_network_request",
        "Full details of one network request",
        [["index", "Request index from the log"]],
      ],
      [
        "browser_run_code_unsafe",
        "Run a Playwright code snippet",
        [["code", "Playwright code to execute"]],
      ],
      ["browser_close", "Close the page", []],
      [
        "browser_resize",
        "Resize the viewport",
        [
          ["width", "Viewport width"],
          ["height", "Viewport height"],
        ],
      ],
      ["browser_evaluate", "Run page JavaScript", [["function", "Function source to evaluate"]]],
      ["browser_handle_dialog", "Accept a dialog", [["accept", "Whether to accept"]]],
      ["browser_tabs", "List, create, or close tabs", [["action", "list, new, close, or select"]]],
      ["browser_drop", "Drop files onto an element", [["paths", "Absolute file paths"]]],
      ["browser_find", "Search the page snapshot", [["text", "Text to search for"]]],
    ],
  ],
  [
    "brave-search",
    [
      [
        "brave_web_search",
        "Web search with snippets",
        [
          ["query", "Search query"],
          ["count", "Results to return"],
        ],
      ],
      ["brave_local_search", "Local businesses and places", [["query", "Local search query"]]],
    ],
  ],
  [
    "google-drive",
    [
      ["search", "Search Drive files", [["query", "Search query"]]],
      ["list_files", "List a folder", [["folderId", "Folder id"]]],
      ["read_file", "Read file content", [["fileId", "File id"]]],
      [
        "create_file",
        "Create a file",
        [
          ["name", "File name"],
          ["content", "File content"],
        ],
      ],
    ],
  ],
];

function titleCase(name: string): string {
  return name
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function toolJson(server: string, name: string, desc: string, params: Param[]): string {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const [pname, pdesc] of params) properties[pname] = { type: "string", description: pdesc };
  return JSON.stringify({
    server,
    name,
    description: `${desc}.`,
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties,
      additionalProperties: false,
      ...(params.length > 0 ? { required: [params[0][0]] } : {}),
    },
    annotations: { title: `${titleCase(name)} — ${server}` },
  });
}

export const TYPICAL_MCP_SCHEMAS = `[${SERVERS.map(([server, tools]) =>
  tools.map(([name, desc, params]) => toolJson(server, name, desc, params)).join(","),
).join(",")}]`;

export const TYPICAL_MCP_TOOL_COUNT = SERVERS.reduce((n, [, tools]) => n + tools.length, 0);
