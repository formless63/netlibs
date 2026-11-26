# Releasing

Packages are published to npm by `.github/workflows/release.yml` on every push to `main`: any public
package whose version is not on the registry yet is published, dependencies first, with provenance.
Private packages (`"private": true`) are never published.

To release a package, raise its `version` in its `package.json` and merge to `main`. Raise the versions of
packages that need its new behaviour at the same time. Before 1.0, a breaking change raises the minor version.

`bun scripts/release.ts` shows what would be published; `--dry-run` also packs and runs `npm publish --dry-run`
(CI does this on every push).

## One-time setup

npm only lets a trusted publisher be configured for a package that already exists, so the first release uses a
short-lived token and every later one uses GitHub's OIDC identity with no stored secret.

1. **Scope.** Create the npm organization `formless63` on the free "Unlimited public packages" plan, or use a
   user account of that name. Turn on two-factor authentication for the account.
2. **First-release token.** Create a granular access token: read and write (publish), only the `@formless63`
   scope, "bypass two-factor authentication" ticked, and the shortest expiry offered. Store it without showing
   it to anyone: `gh secret set NPM_TOKEN -R formless63/netlibs` (paste when prompted).
3. **First release.** Merge to `main` (or run the Release workflow by hand). Every package is published with
   provenance.
4. **Trusted publishing.** For each package, on npmjs.com open the package, then Settings, then Trusted
   publishing, and add GitHub Actions with organization or user `formless63`, repository `netlibs`, workflow
   `release.yml` and environment `npm`. With npm 11.15 or later this can be scripted:
   `npm trust github @formless63/<name> --file release.yml --repo formless63/netlibs --allow-publish`.
5. **Close the door.** Delete the token on npmjs.com and run `gh secret delete NPM_TOKEN -R formless63/netlibs`.
   For each package, set Settings, then Publishing access, to "Require two-factor authentication and disallow
   tokens". Trusted publishing keeps working.

A new package later needs steps 2 to 5 for that package only.
