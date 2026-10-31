# Rebuild the chat core in place and delete the unreachable subsystems

The inherited codebase (through PR #64) spent most of its weight on features no user could reach: MCP and its egress service, sandbox, browser execution, durable jobs, a monthly platform-budget planner and a guest flow. Its chat core also locked users out after interrupted replies (stuck BYOK leases, `chat_run` rows and credit reservations). We chose to rebuild the core (message tree, model registry, streaming, persistence) in this repository rather than clean it up step by step, moving over only what's worth keeping: Better Auth sign-in, BYOK key encryption, markdown rendering and the context ideas. The removed subsystems and their migrations and tests stay available in git history; later features such as MCP or jobs get rebuilt on the new core instead of being revived.

## Consequences

- The 23 SQL migrations collapse into one fresh starting migration. No deployed data existed to preserve.
