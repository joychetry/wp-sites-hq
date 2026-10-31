# Add your first site

Open WP Sites HQ and choose **Add a site** (or press `a` on Sites). Write the
site's address, like `https://example.com`.

## With Classic Monks

1. Pick **Classic Monks** and press **Open the sign-in page**.
2. Your browser opens the site's sign-in page. Sign in as an administrator.
3. Tick the tool groups WP Sites HQ may use. With none ticked it can't do
   anything.
4. Tick **This is my WP Sites HQ app (operator)** (Classic Monks Pro and older
   plugins say Monks Central app), then press **Connect**.
   This lets the app window make changes without asking the site each time;
   AI agents never get this.
5. Come back to WP Sites HQ. The site appears on its own.

## Basic mode (no Classic Monks)

1. On the site, go to **Users > Profile > Application Passwords**, give it a
   name like "WP Sites HQ" and press **Add New Application Password**. Copy
   the password.
2. In WP Sites HQ pick **Basic mode**, write your WordPress user name and paste
   the application password, then press **Add the site**.

The password is encrypted on your computer and never shown again. If the site
refuses it although it is right, the host may strip the `Authorization`
header; ask the host to pass it through, or use Classic Monks.

## If something goes wrong

- **"This site's certificate isn't trusted by your computer"**: the site's
  HTTPS certificate isn't one your operating system trusts. Fix the certificate,
  or trust your local development CA in the system (WP Sites HQ uses the
  system's trust store).
- **"Update WordPress to 7.1 or newer first"**: WP Sites HQ only works with
  WordPress 7.1 and newer.
- **"Sign in again"** on a site: its saved sign-in expired or can't be read.
  Choose **Sign in again**; groups, tags and notes stay.

Run `wpshq doctor https://example.com` in a terminal to check the data folder,
the keychain, TLS and whether the site answers.
