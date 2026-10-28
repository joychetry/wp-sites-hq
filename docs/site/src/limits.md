# What it can't do (yet)

Honest limits of a desktop app, and of this first beta:

- **It watches your sites only while it runs.** Close the window and it keeps
  checking from the tray; quit it and checks stop. Sites can't send alerts to
  it on their own. For 24/7 alerts, use an external monitor alongside.
- **Unsigned installers.** macOS and Windows warn you once; see
  [Install](install.md).
- **Keychain needed.** Linux needs GNOME Keyring or KWallet running.
- **One computer.** Your data lives on the computer you use. Export the site
  list (Settings) to move it; sign in to each site again on the new computer.
- **No phone or network access.** Monks Central listens only on your own
  computer. Read-only access from other devices may come later.
- **Basic mode** sites can't update, roll back or log in with one click; install
  Classic Monks for that.
- **Windows** builds are made by the release workflow and not yet tested on
  a Windows machine.
