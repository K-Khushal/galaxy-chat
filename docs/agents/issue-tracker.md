# Issue tracker: GitHub

Issues and specs live in K-Khushal/galaxy-chat on GitHub.
Use the gh CLI from this repository.

## Conventions

- Verify the target before creating issues:
  `gh repo view --json nameWithOwner`.
- Create issues with `gh issue create --title "..." --body-file <file>`.
- Read issues with
  `gh issue view <number> --json number,title,body,labels,comments`.
- List issues with `gh issue list`, using relevant state and label filters.
- Comment with `gh issue comment <number> --body-file <file>`.
- Apply or remove labels with `gh issue edit`.
- Explain the resolution in a comment before closing an issue.
- Use native GitHub sub-issues and issue dependencies when supported.
  Otherwise put `Part of #<parent>` and `Blocked by: #<number>`
  at the top of the issue body.
- An issue is unblocked when all its blockers are closed.
- File issues only into the user's repository.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill operations

“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read the GitHub issue.

## Wayfinding

Use one issue labelled `wayfinder:map` for the map.
Link child issues as sub-issues, or use a task list and parent references.
Label children `wayfinder:<type>`: research, prototype, grilling, or task.
Choose the first open, unassigned child without open blockers in map order.
Claim with `gh issue edit <number> --add-assignee @me`.
Resolve by commenting, closing, and adding a context pointer to the map.
