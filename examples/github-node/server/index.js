#!/usr/bin/env node

/**
 * GitHub MCP server
 *
 * Provides tools for interacting with GitHub repositories, issues,
 * pull requests, and code search via the GitHub REST API.
 *
 * Required environment variable:
 *   GITHUB_TOKEN - GitHub personal access token (classic or fine-grained)
 *
 * Optional environment variable:
 *   GITHUB_API_URL - GitHub API base URL (default: https://api.github.com)
 *                    Override for GitHub Enterprise Server instances.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Octokit } from "@octokit/rest";

// ---------------------------------------------------------------------------
// Initialise Octokit client
// ---------------------------------------------------------------------------

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API_URL =
  process.env.GITHUB_API_URL || "https://api.github.com";

if (!GITHUB_TOKEN) {
  console.error(
    "Error: GITHUB_TOKEN environment variable is required. " +
      "Create a personal access token at https://github.com/settings/tokens"
  );
  process.exit(1);
}

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
  baseUrl: GITHUB_API_URL,
});

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/** Return a compact JSON string for tool results. */
function jsonText(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Wrap an async handler and convert GitHub API errors to friendly messages. */
async function withErrorHandling(fn) {
  try {
    return await fn();
  } catch (err) {
    const status = err.status ?? "unknown";
    const message = err.message ?? String(err);
    return {
      content: [
        {
          type: "text",
          text: `GitHub API error (HTTP ${status}): ${message}`,
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "list_repositories",
    description:
      "List repositories for a GitHub user or organisation. If no owner is specified, lists repositories for the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        owner: {
          type: "string",
          description:
            "GitHub username or organisation name. Omit to list your own repositories.",
        },
        type: {
          type: "string",
          enum: ["all", "owner", "member", "public", "private", "forks", "sources"],
          description: "Filter by repository type (default: all).",
        },
        sort: {
          type: "string",
          enum: ["created", "updated", "pushed", "full_name"],
          description: "Sort field (default: full_name).",
        },
        per_page: {
          type: "number",
          description: "Results per page, max 100 (default: 30).",
        },
        page: {
          type: "number",
          description: "Page number (default: 1).",
        },
      },
    },
  },
  {
    name: "get_repository",
    description: "Get details about a specific GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner (user or org)." },
        repo: { type: "string", description: "Repository name." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "get_file_contents",
    description:
      "Read the contents of a file or list a directory in a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
        path: {
          type: "string",
          description: "Path to the file or directory (e.g. 'src/index.js' or 'src/').",
        },
        ref: {
          type: "string",
          description: "Git ref (branch, tag, or commit SHA). Defaults to the default branch.",
        },
      },
      required: ["owner", "repo", "path"],
    },
  },
  {
    name: "list_branches",
    description: "List branches in a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
        per_page: { type: "number", description: "Results per page, max 100 (default: 30)." },
        page: { type: "number", description: "Page number (default: 1)." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "list_commits",
    description: "List commits in a repository branch.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
        sha: {
          type: "string",
          description: "Branch name, tag, or commit SHA to start listing from.",
        },
        path: {
          type: "string",
          description: "Only commits touching this path are returned.",
        },
        per_page: { type: "number", description: "Results per page, max 100 (default: 30)." },
        page: { type: "number", description: "Page number (default: 1)." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "list_issues",
    description: "List issues in a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
        state: {
          type: "string",
          enum: ["open", "closed", "all"],
          description: "Filter by issue state (default: open).",
        },
        labels: {
          type: "string",
          description: "Comma-separated list of label names to filter by.",
        },
        assignee: { type: "string", description: "Filter by assignee login." },
        per_page: { type: "number", description: "Results per page, max 100 (default: 30)." },
        page: { type: "number", description: "Page number (default: 1)." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "get_issue",
    description: "Get details of a specific issue.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
        issue_number: { type: "number", description: "Issue number." },
      },
      required: ["owner", "repo", "issue_number"],
    },
  },
  {
    name: "create_issue",
    description: "Create a new issue in a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
        title: { type: "string", description: "Issue title." },
        body: { type: "string", description: "Issue body (Markdown supported)." },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Label names to apply.",
        },
        assignees: {
          type: "array",
          items: { type: "string" },
          description: "Usernames to assign.",
        },
      },
      required: ["owner", "repo", "title"],
    },
  },
  {
    name: "create_issue_comment",
    description: "Add a comment to an existing issue or pull request.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
        issue_number: { type: "number", description: "Issue or PR number." },
        body: { type: "string", description: "Comment body (Markdown supported)." },
      },
      required: ["owner", "repo", "issue_number", "body"],
    },
  },
  {
    name: "list_pull_requests",
    description: "List pull requests in a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
        state: {
          type: "string",
          enum: ["open", "closed", "all"],
          description: "Filter by PR state (default: open).",
        },
        base: { type: "string", description: "Filter by base branch name." },
        head: {
          type: "string",
          description: "Filter by head branch (format: user:branch or org:branch).",
        },
        per_page: { type: "number", description: "Results per page, max 100 (default: 30)." },
        page: { type: "number", description: "Page number (default: 1)." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "get_pull_request",
    description: "Get details of a specific pull request.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner." },
        repo: { type: "string", description: "Repository name." },
        pull_number: { type: "number", description: "Pull request number." },
      },
      required: ["owner", "repo", "pull_number"],
    },
  },
  {
    name: "search_repositories",
    description:
      "Search for GitHub repositories using GitHub's search syntax. " +
      "Examples: 'language:javascript stars:>1000', 'topic:machine-learning', 'user:octocat'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "GitHub repository search query." },
        sort: {
          type: "string",
          enum: ["stars", "forks", "help-wanted-issues", "updated"],
          description: "Sort field.",
        },
        order: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort order (default: desc).",
        },
        per_page: { type: "number", description: "Results per page, max 100 (default: 30)." },
        page: { type: "number", description: "Page number (default: 1)." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_code",
    description:
      "Search for code across GitHub using GitHub's code search syntax. " +
      "Examples: 'addClass in:file language:js repo:jquery/jquery'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "GitHub code search query." },
        per_page: { type: "number", description: "Results per page, max 100 (default: 30)." },
        page: { type: "number", description: "Page number (default: 1)." },
      },
      required: ["query"],
    },
  },
];

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "github-node", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  return withErrorHandling(async () => {
    switch (name) {
      // -----------------------------------------------------------------------
      case "list_repositories": {
        if (args.owner) {
          // Check whether it's a user or an org; try user first, fall back to org
          try {
            const { data } = await octokit.repos.listForUser({
              username: args.owner,
              type: args.type ?? "all",
              sort: args.sort ?? "full_name",
              per_page: args.per_page ?? 30,
              page: args.page ?? 1,
            });
            return jsonText(data.map(repoSummary));
          } catch (err) {
            if (err.status !== 404) throw err;
            const { data } = await octokit.repos.listForOrg({
              org: args.owner,
              type: args.type ?? "all",
              sort: args.sort ?? "full_name",
              per_page: args.per_page ?? 30,
              page: args.page ?? 1,
            });
            return jsonText(data.map(repoSummary));
          }
        }
        const { data } = await octokit.repos.listForAuthenticatedUser({
          type: args.type ?? "all",
          sort: args.sort ?? "full_name",
          per_page: args.per_page ?? 30,
          page: args.page ?? 1,
        });
        return jsonText(data.map(repoSummary));
      }

      // -----------------------------------------------------------------------
      case "get_repository": {
        const { data } = await octokit.repos.get({
          owner: args.owner,
          repo: args.repo,
        });
        return jsonText(repoDetail(data));
      }

      // -----------------------------------------------------------------------
      case "get_file_contents": {
        const params = { owner: args.owner, repo: args.repo, path: args.path };
        if (args.ref) params.ref = args.ref;
        const { data } = await octokit.repos.getContent(params);

        if (Array.isArray(data)) {
          // Directory listing
          return jsonText(
            data.map((entry) => ({
              name: entry.name,
              type: entry.type,
              size: entry.size,
              path: entry.path,
              sha: entry.sha,
            }))
          );
        }

        if (data.type === "file") {
          const content =
            data.encoding === "base64"
              ? Buffer.from(data.content, "base64").toString("utf-8")
              : data.content;
          return {
            content: [
              {
                type: "text",
                text: content,
              },
            ],
          };
        }

        return jsonText(data);
      }

      // -----------------------------------------------------------------------
      case "list_branches": {
        const { data } = await octokit.repos.listBranches({
          owner: args.owner,
          repo: args.repo,
          per_page: args.per_page ?? 30,
          page: args.page ?? 1,
        });
        return jsonText(
          data.map((b) => ({ name: b.name, sha: b.commit.sha, protected: b.protected }))
        );
      }

      // -----------------------------------------------------------------------
      case "list_commits": {
        const params = {
          owner: args.owner,
          repo: args.repo,
          per_page: args.per_page ?? 30,
          page: args.page ?? 1,
        };
        if (args.sha) params.sha = args.sha;
        if (args.path) params.path = args.path;
        const { data } = await octokit.repos.listCommits(params);
        return jsonText(
          data.map((c) => ({
            sha: c.sha,
            message: c.commit.message,
            author: c.commit.author,
            date: c.commit.author?.date,
            url: c.html_url,
          }))
        );
      }

      // -----------------------------------------------------------------------
      case "list_issues": {
        const params = {
          owner: args.owner,
          repo: args.repo,
          state: args.state ?? "open",
          per_page: args.per_page ?? 30,
          page: args.page ?? 1,
        };
        if (args.labels) params.labels = args.labels;
        if (args.assignee) params.assignee = args.assignee;
        const { data } = await octokit.issues.listForRepo(params);
        // Exclude pull requests (GitHub returns PRs in issues endpoint)
        const issues = data.filter((i) => !i.pull_request);
        return jsonText(issues.map(issueSummary));
      }

      // -----------------------------------------------------------------------
      case "get_issue": {
        const { data } = await octokit.issues.get({
          owner: args.owner,
          repo: args.repo,
          issue_number: args.issue_number,
        });
        return jsonText(issueDetail(data));
      }

      // -----------------------------------------------------------------------
      case "create_issue": {
        const params = {
          owner: args.owner,
          repo: args.repo,
          title: args.title,
        };
        if (args.body) params.body = args.body;
        if (args.labels) params.labels = args.labels;
        if (args.assignees) params.assignees = args.assignees;
        const { data } = await octokit.issues.create(params);
        return jsonText({ number: data.number, html_url: data.html_url, title: data.title });
      }

      // -----------------------------------------------------------------------
      case "create_issue_comment": {
        const { data } = await octokit.issues.createComment({
          owner: args.owner,
          repo: args.repo,
          issue_number: args.issue_number,
          body: args.body,
        });
        return jsonText({ id: data.id, html_url: data.html_url });
      }

      // -----------------------------------------------------------------------
      case "list_pull_requests": {
        const params = {
          owner: args.owner,
          repo: args.repo,
          state: args.state ?? "open",
          per_page: args.per_page ?? 30,
          page: args.page ?? 1,
        };
        if (args.base) params.base = args.base;
        if (args.head) params.head = args.head;
        const { data } = await octokit.pulls.list(params);
        return jsonText(data.map(prSummary));
      }

      // -----------------------------------------------------------------------
      case "get_pull_request": {
        const { data } = await octokit.pulls.get({
          owner: args.owner,
          repo: args.repo,
          pull_number: args.pull_number,
        });
        return jsonText(prDetail(data));
      }

      // -----------------------------------------------------------------------
      case "search_repositories": {
        const params = { q: args.query, per_page: args.per_page ?? 30, page: args.page ?? 1 };
        if (args.sort) params.sort = args.sort;
        if (args.order) params.order = args.order;
        const { data } = await octokit.search.repos(params);
        return jsonText({
          total_count: data.total_count,
          items: data.items.map(repoSummary),
        });
      }

      // -----------------------------------------------------------------------
      case "search_code": {
        const { data } = await octokit.search.code({
          q: args.query,
          per_page: args.per_page ?? 30,
          page: args.page ?? 1,
        });
        return jsonText({
          total_count: data.total_count,
          items: data.items.map((item) => ({
            name: item.name,
            path: item.path,
            sha: item.sha,
            html_url: item.html_url,
            repository: {
              full_name: item.repository.full_name,
              html_url: item.repository.html_url,
            },
          })),
        });
      }

      // -----------------------------------------------------------------------
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Data shapers — keep responses lean
// ---------------------------------------------------------------------------

function repoSummary(r) {
  return {
    full_name: r.full_name,
    description: r.description,
    private: r.private,
    fork: r.fork,
    stars: r.stargazers_count,
    forks: r.forks_count,
    language: r.language,
    default_branch: r.default_branch,
    html_url: r.html_url,
    updated_at: r.updated_at,
  };
}

function repoDetail(r) {
  return {
    ...repoSummary(r),
    open_issues_count: r.open_issues_count,
    topics: r.topics,
    license: r.license?.name,
    clone_url: r.clone_url,
    homepage: r.homepage,
    created_at: r.created_at,
    pushed_at: r.pushed_at,
  };
}

function issueSummary(i) {
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    user: i.user?.login,
    assignees: i.assignees?.map((a) => a.login),
    labels: i.labels?.map((l) => l.name),
    comments: i.comments,
    created_at: i.created_at,
    updated_at: i.updated_at,
    html_url: i.html_url,
  };
}

function issueDetail(i) {
  return { ...issueSummary(i), body: i.body };
}

function prSummary(pr) {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    user: pr.user?.login,
    base: pr.base?.ref,
    head: pr.head?.ref,
    mergeable: pr.mergeable,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    html_url: pr.html_url,
  };
}

function prDetail(pr) {
  return {
    ...prSummary(pr),
    body: pr.body,
    commits: pr.commits,
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changed_files,
  };
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
server.connect(transport);
console.error("GitHub MCP server running...");
