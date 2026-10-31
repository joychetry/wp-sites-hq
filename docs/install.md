# Install WP Sites HQ

WP Sites HQ is free and runs on macOS, Windows and Linux. Download the file
for your computer from the
[releases page](https://github.com/joychetry/wp-sites-hq/releases/latest).

The installers are **not signed** yet (signing costs money every year, and the
project will pay for it once it is used enough). Your computer warns you the
first time you open an unsigned app. The steps below get you past that warning,
once. Every installer is built in the open from this repository by
`.github/workflows/release.yml`.

| Your computer | File to download |
|---|---|
| Mac with Apple silicon (M1 or newer) | `WP.Sites.HQ_<version>_aarch64.dmg` |
| Mac with an Intel chip | `WP.Sites.HQ_<version>_x64.dmg` |
| Windows 10 or 11 | `WP.Sites.HQ_<version>_x64-setup.exe` (or the `.msi`) |
| Ubuntu, Debian, Mint, Pop!_OS | `WP.Sites.HQ_<version>_amd64.deb` |
| Fedora, openSUSE, RHEL | `WP.Sites.HQ-<version>-1.x86_64.rpm` |
| Any other Linux (Arch too) | `WP.Sites.HQ_<version>_amd64.AppImage` |

Your sites need WordPress 7.1 or newer.

## macOS

1. Open the `.dmg` and drag **WP Sites HQ** into **Applications**.
2. Open WP Sites HQ from Applications. macOS says it can't check the app for
   malicious software and offers **Done** or **Move to Trash**. Choose **Done**.
3. Open **System Settings > Privacy & Security**. Scroll down to **Security**.
   You see "WP Sites HQ was blocked to protect your Mac". Click **Open Anyway**.
4. Confirm with your password or Touch ID, then click **Open Anyway** again.

You do this once per version. On macOS 15 (Sequoia) and newer, Control-click >
Open no longer skips the warning; System Settings is the only way.

The macOS build is ad-hoc signed, which is what lets macOS offer **Open
Anyway**. If it says "WP Sites HQ is damaged and can't be opened" instead
(older builds, or a download that lost its signature), the app isn't damaged:
click **Cancel**, run this in **Terminal**, then open it again.

```sh
xattr -cr "/Applications/WP Sites HQ.app"
```

The first time WP Sites HQ saves a site, macOS asks whether it may use your
keychain. Click **Always Allow**. Because the app isn't signed, macOS asks
again once after each update.

**Command line (`wpshq`, for AI apps):**

```sh
sudo ln -sf "/Applications/WP Sites HQ.app/Contents/MacOS/wpshq" /usr/local/bin/wpshq
```

If you updated from Monks Central, the app may still be called
`Monks Central.app`; use that path instead, or rename the app first (see
[Moving from Monks Central](#moving-from-monks-central)).

## Windows

1. Run `WP.Sites.HQ_<version>_x64-setup.exe`. If your browser warns that the
   file isn't commonly downloaded, choose **Keep** (Edge: **...** > **Keep** >
   **Show more** > **Keep anyway**).
2. Windows SmartScreen shows "Windows protected your PC". Click **More info**,
   then **Run anyway**.
3. The installer puts WP Sites HQ in your user folder, so it doesn't need
   an administrator. The `.msi` installs for every user and asks for one.

**Command line (`wpshq`, for AI apps):** `wpshq.exe` sits next to
`wp-sites-hq.exe` in the install folder (right-click WP Sites HQ in the
Start menu > **Open file location** shows it). Add that folder to your PATH:
Start > "Edit environment variables for your account" > Path > Edit > New.

## Linux

WP Sites HQ keeps its master key in the Secret Service, so GNOME Keyring or
KWallet must be installed and unlocked (most desktops start one at login; on a
bare window manager install `gnome-keyring` and start it with your session).
Without one, WP Sites HQ says it couldn't use the system keychain and
doesn't start.

**Debian, Ubuntu and friends:**

```sh
sudo apt install ./WP.Sites.HQ_<version>_amd64.deb
```

**Fedora, openSUSE:**

```sh
sudo dnf install ./WP.Sites.HQ-<version>-1.x86_64.rpm
```

Both put WP Sites HQ in your app menu and `wpshq` on your PATH
(`/usr/bin/wpshq`, and `/usr/bin/monks`, its old name, until 1.0).

**AppImage (any distribution):**

```sh
chmod +x WP.Sites.HQ_<version>_amd64.AppImage
./WP.Sites.HQ_<version>_amd64.AppImage
```

If it says FUSE is missing, install `libfuse2` (Debian, Ubuntu) or `fuse2`
(Arch). To get the `wpshq` command out of the AppImage:

```sh
./WP.Sites.HQ_<version>_amd64.AppImage --appimage-extract usr/bin/wpshq
install -m 755 squashfs-root/usr/bin/wpshq ~/.local/bin/wpshq && rm -r squashfs-root
```

The app needs WebKitGTK 4.1, which the `.deb` and `.rpm` pull in and the
AppImage carries.

## Updates

WP Sites HQ checks GitHub for a new version when it starts and tells you
when one is ready. Install it in **Settings > Updates for WP Sites HQ**. Every
update is signed; WP Sites HQ checks the signature before it installs
anything, and refuses an update that doesn't match. Nothing installs without
your click.

- macOS and the AppImage replace themselves and restart.
- Windows runs the new installer and restarts.
- `.deb` and `.rpm` ask for your password to install the new package.

Your sites, settings and history stay through every update.

## Moving from Monks Central

WP Sites HQ was called Monks Central until 0.3.2. Update from inside the app
as usual (Settings > Updates); nothing else is needed. Your sites, saved
sign-ins, settings and history stay: the data folder and the keychain entry
keep their old names (`com.classicmonks.monks-central`), so you never sign in
to your sites again because of the rename.

- **macOS:** the update keeps the app where it is, so Finder may still show
  `Monks Central.app` in Applications. The Dock, menu bar and About say WP
  Sites HQ. To match, quit the app and rename it in Finder to `WP Sites HQ`
  (or install the new `.dmg` and delete the old app). A `/usr/local/bin/monks`
  link keeps working; if you rename the app, make the `wpshq` link above
  again.
- **Windows:** the update installs WP Sites HQ and removes Monks Central (its
  Start menu entry and its entry in Apps). If you added the old install folder
  to your PATH for `monks.exe`, point PATH at the new folder,
  `%LOCALAPPDATA%\WP Sites HQ`, which has `wpshq.exe` and `monks.exe`.
- **Linux `.deb` and `.rpm`:** the `wp-sites-hq` package replaces
  `monks-central`. Remove and uninstall commands now use `wp-sites-hq`.
- **AppImage:** the update replaces the file in place and keeps its old file
  name; rename it if you like. If you copied `monks` out of it, copy `wpshq`
  as shown above.
- **Command line and AI apps:** the command is `wpshq` now. `monks` still
  works (it prints a one-line note, except for `monks mcp`) until 1.0, so AI
  app configs that say `monks mcp` keep working. Change them to `wpshq mcp`
  when you can.
- **The plugin on your sites:** the Monks Central plugin is now the WP Sites
  HQ plugin, in a new folder (`wp-sites-hq`). Sites that have Monks Central
  0.1.x keep working. To move a site, update Monks Central on it to 0.1.4,
  which offers the move to WP Sites HQ in one click and keeps its settings and
  sign-ins. Don't delete the old plugin folder by hand before the move: that
  resets its settings.

## Uninstall

Remove the app the usual way (drag it to the Trash; Windows Settings > Apps;
`sudo apt remove wp-sites-hq` or `sudo dnf remove wp-sites-hq`; delete the
AppImage). Your data stays in the data folder until you delete it:

| System | Data folder |
|---|---|
| macOS | `~/Library/Application Support/com.classicmonks.monks-central` |
| Windows | `%APPDATA%\com.classicmonks.monks-central` |
| Linux | `~/.local/share/com.classicmonks.monks-central` |

Remove each site in the app first (Sites > Remove) if you want the sites to
forget WP Sites HQ too: that revokes its connection on each site. The master
key stays in your keychain under `com.classicmonks.monks-central`; delete it
there.
