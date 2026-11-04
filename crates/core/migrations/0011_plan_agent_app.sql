-- The AI app (its MCP clientInfo name) that proposed an agent's plan, e.g.
-- Claude or Cursor. NULL: a person's job, or the app didn't say.
ALTER TABLE jobs ADD COLUMN agent_app TEXT;
