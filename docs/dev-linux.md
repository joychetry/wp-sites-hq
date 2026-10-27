# Developing on Linux (Arch / Omarchy)

## Test sites (WordPress Studio)

`scripts/test-sites.sh create` makes `mc-a`, `mc-b` and `mc-c` (see the header
of the script). Notes:

- `studio create`/`start` edit `/etc/hosts` through `pkexec`; with no polkit
  agent running they hang. The script creates the site without starting it,
  writes the hosts entry inside Studio's `# BEGIN/END WordPress Studio` block
  with `sudo`, then starts it. Studio sees the entry and skips its own edit.
- The Studio CA must be trusted system-wide
  (`/etc/ca-certificates/trust-source/anchors/wordpress-studio-ca.crt`, then
  `sudo trust extract-compat`). Monks Central uses the OS trust store, so no
  `SSL_CERT_FILE` or other TLS variables are needed. `monks doctor` lists any
  that are set.
- `nsswitch.conf` must check `files` before mDNS so `*.local` resolves from
  `/etc/hosts`.
- Classic Monks is not on wordpress.org yet, so `mc-b` gets the released code
  from the `main` branch of the local `classic-monks` repo (`git archive`,
  read-only).
- WP-CLI: `studio wp --path ~/Studio/mc-a ...`.

## Keychain

The master key lives in the Secret Service (GNOME Keyring, KWallet) under
service `com.classicmonks.monks-central`, one item per data folder: account
`master-key-<first 16 hex of sha256 of the data folder path>`. A test data
folder (`MONKS_HOME`) has its own item; delete it with
`secret-tool clear service com.classicmonks.monks-central username <account>`. The Secret
Service has no per-app access control: any program running as your user can
read the key while the keyring is unlocked. That is the same trust boundary as
every other app on Linux; site secrets are still encrypted at rest in SQLite.

## App prerequisites

WebKitGTK 4.1 and the usual Tauri 2 packages (`webkit2gtk-4.1`, `librsvg`,
`libayatana-appindicator`, `xdotool` on Arch).
