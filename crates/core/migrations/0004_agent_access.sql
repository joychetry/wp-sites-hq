-- AI agents' own Classic Monks grant on a site (plan 5.6), JSON like `oauth`.
-- Its tokens live in `credentials` as `site:<id>:agent`.
ALTER TABLE sites ADD COLUMN agent_oauth TEXT;
