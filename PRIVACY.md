# Privacy

Monks Central runs on your computer. There is no Monks Central account, no
server of ours, no analytics and no crash reporting. We never see your sites,
your content or your passwords.

## What stays on your computer

- Your site list, groups, tags, notes, clients, costs, jobs and the activity log,
  in one SQLite file in the app's data folder (see [the install guide](https://github.com/joychetry/monks-central/blob/main/docs/install.md#uninstall)).
- Each site's sign-in (OAuth tokens or an application password), encrypted with
  XChaCha20-Poly1305. The key for that encryption is kept in your system keychain
  (macOS Keychain, Windows Credential Manager, the Linux Secret Service).
- Reports and exports you save, in your Downloads folder. Exports never contain
  passwords or tokens.

## Who Monks Central talks to

Only these, and only for the reason given:

| Who | Why | When |
|---|---|---|
| Your own WordPress sites | Everything the app does with them | When you act, and on a schedule while the app runs (checks every 15 minutes, uptime every 5) |
| api.wordpress.org | Plugin search | When you search |
| wpvulnerability.net | Known vulnerabilities in your WordPress, plugins and themes, and plugins WordPress.org closed (sends names and versions, nothing else) | Once a day |
| rdap.org and your domain's registry | When each domain expires | Once a day |
| Google PageSpeed | Speed of a public page you picked | Only when you click |
| Google Search Console | Search numbers for your reports, through your own Google OAuth client | Only if you turn it on in Settings |
| github.com | Whether a new Monks Central version is out (no data about you or your sites is sent) | At start, and when you click Check |

Requests carry the app name and version (`MonksCentral/<version>`). Nothing else
identifies you, and none of these services receives data from the others.

## AI apps

`monks mcp` lets an AI app on your computer (Claude, Cursor, VS Code) read your
sites through Monks Central. What the AI app does with that data is up to the
AI app and its provider. Monks Central only lets an agent change a site you
allowed, with the site's own approval, and never runs a change on many sites
without your confirmation in the app.

## On your sites

Classic Monks logs every change Monks Central makes on a site, in that site's
own activity log. Removing a site in Monks Central revokes its connection on the
site.

Questions: open an issue. To report a security problem privately, see [SECURITY.md](https://github.com/joychetry/monks-central/blob/main/SECURITY.md).
