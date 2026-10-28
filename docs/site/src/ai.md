# AI apps

`monks mcp` is an MCP server for Claude Code, Claude Desktop, Cursor and VS
Code. It reaches every site through Monks Central, always as an agent.

```sh
claude mcp add monks-central -- monks mcp
```

or, in an MCP config file:

```json
{ "mcpServers": { "monks-central": { "command": "monks", "args": ["mcp"] } } }
```

The `monks` command comes with the app; see [Install](install.md) to put it
on your PATH.

## What an agent can do

| | Allowed? |
|---|---|
| Read any site with Classic Monks | Yes |
| Change one site | Only if you turned on agent access for that site (AI > Agent access), and the site asks you to approve each change |
| Change many sites | It can only propose a plan. The plan waits under AI > Plans to confirm and runs only when you click Confirm in the app. No tool can confirm it |
| A plan nobody confirms | Expires after 7 days, shows as Expired and never runs |

Five tools: `sites_list`, `site_describe`, `run_ability`, `plan_changes` and
`plan_status`. Everything an agent does is in the activity log (AI > Activity),
marked as an agent, or as an agent's plan you confirmed.
