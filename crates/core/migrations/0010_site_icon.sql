-- A short hash of the site's cached icon (`<data>/icons/<id>`), so the window
-- knows when to load it again. NULL: no icon yet.
ALTER TABLE sites ADD COLUMN icon TEXT;
