# Install Monks Central

Monks Central is free and runs on macOS, Windows and Linux. Download the file
for your computer from the
[releases page](https://github.com/joychetry/monks-central/releases/latest).

The installers are **not signed** yet (signing costs money every year, and the
project will pay for it once it is used enough). Your computer warns you the
first time you open an unsigned app. The steps below get you past that warning,
once. Every installer is built in the open from this repository by
`.github/workflows/release.yml`.

| Your computer | File to download |
|---|---|
| Mac with Apple silicon (M1 or newer) | `Monks.Central_<version>_aarch64.dmg` |
| Mac with an Intel chip | `Monks.Central_<version>_x64.dmg` |
| Windows 10 or 11 | `Monks.Central_<version>_x64-setup.exe` (or the `.msi`) |
| Ubuntu, Debian, Mint, Pop!_OS | `Monks.Central_<version>_amd64.deb` |
| Fedora, openSUSE, RHEL | `Monks.Central-<version>-1.x86_64.rpm` |
| Any other Linux (Arch too) | `Monks.Central_<version>_amd64.AppImage` |

Your sites need WordPress 7.1 or newer.

## macOS

1. Open the `.dmg` and drag **Monks Central** into **Applications**.
2. Open Monks Central from Applications. macOS says it can't check the app for
   malicious software and offers **Done** or **Move to Trash**. Choose **Done**.
3. Open **System Settings > Privacy & Security**. Scroll down to **Security**.
   You see "Monks Central was blocked to protect your Mac". Click **Open Anyway**.
4. Confirm with your password or Touch ID, then click **Open Anyway** again.

You do this once per version. On macOS 15 (Sequoia) and newer, Control-click >
Open no longer skips the warning; System Settings is the only way.

The macOS build is ad-hoc signed, which is what lets macOS offer **Open
Anyway**. If it says "Monks Central is damaged and can't be opened" instead
(older builds, or a download that lost its signature), the app isn't damaged:
click **Cancel**, run this in **Terminal**, then open it again.

```sh
xattr -cr "/Applications/Monks Central.app"
```

The first time Monks Central saves a site, macOS asks whether it may use your
keychain. Click **Always Allow**. Because the app isn't signed, macOS asks
again once after each update.

**Command line (`monks`, for AI apps):**

```sh
sudo ln -sf "/Applications/Monks Central.app/Contents/MacOS/monks" /usr/local/bin/monks
```

## Windows

1. Run `Monks.Central_<version>_x64-setup.exe`. If your browser warns that the
   file isn't commonly downloaded, choose **Keep** (Edge: **...** > **Keep** >
   **Show more** > **Keep anyway**).
2. Windows SmartScreen shows "Windows protected your PC". Click **More info**,
   then **Run anyway**.
3. The installer puts Monks Central in your user folder, so it doesn't need
   an administrator. The `.msi` installs for every user and asks for one.

**Command line (`monks`, for AI apps):** `monks.exe` sits next to
`Monks Central.exe` in the install folder (right-click Monks Central in the
Start menu > **Open file location** shows it). Add that folder to your PATH:
Start > "Edit environment variables for your account" > Path > Edit > New.

## Linux

Monks Central keeps its master key in the Secret Service, so GNOME Keyring or
KWallet must be installed and unlocked (most desktops start one at login; on a
bare window manager install `gnome-keyring` and start it with your session).
Without one, Monks Central says it couldn't use the system keychain and
doesn't start.

**Debian, Ubuntu and friends:**

```sh
sudo apt install ./Monks.Central_<version>_amd64.deb
```

**Fedora, openSUSE:**

```sh
sudo dnf install ./Monks.Central-<version>-1.x86_64.rpm
```

Both put Monks Central in your app menu and `monks` on your PATH
(`/usr/bin/monks`).

**AppImage (any distribution):**

```sh
chmod +x Monks.Central_<version>_amd64.AppImage
./Monks.Central_<version>_amd64.AppImage
```

If it says FUSE is missing, install `libfuse2` (Debian, Ubuntu) or `fuse2`
(Arch). To get the `monks` command out of the AppImage:

```sh
./Monks.Central_<version>_amd64.AppImage --appimage-extract usr/bin/monks
install -m 755 squashfs-root/usr/bin/monks ~/.local/bin/monks && rm -r squashfs-root
```

The app needs WebKitGTK 4.1, which the `.deb` and `.rpm` pull in and the
AppImage carries.

## Updates

Monks Central checks GitHub for a new version when it starts and tells you
when one is ready. Install it in **Settings > Updates for Monks Central**. Every
update is signed; Monks Central checks the signature before it installs
anything, and refuses an update that doesn't match. Nothing installs without
your click.

- macOS and the AppImage replace themselves and restart.
- Windows runs the new installer and restarts.
- `.deb` and `.rpm` ask for your password to install the new package.

Your sites, settings and history stay through every update.

## Uninstall

Remove the app the usual way (drag it to the Trash; Windows Settings > Apps;
`sudo apt remove monks-central` or `sudo dnf remove monks-central`; delete the
AppImage). Your data stays in the data folder until you delete it:

| System | Data folder |
|---|---|
| macOS | `~/Library/Application Support/com.classicmonks.monks-central` |
| Windows | `%APPDATA%\com.classicmonks.monks-central` |
| Linux | `~/.local/share/com.classicmonks.monks-central` |

Remove each site in the app first (Sites > Remove) if you want the sites to
forget Monks Central too: that revokes its connection on each site. The master
key stays in your keychain under `com.classicmonks.monks-central`; delete it
there.
