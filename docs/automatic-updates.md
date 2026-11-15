# Website releases

EDBP's GitHub Pages site is published from `beta` by `.github/workflows/pages.yml`.
Set the repository's Pages source to **GitHub Actions**. A successful test and
Vite build publishes `dist`; failed builds leave the previous site available.
The relative Vite base supports both repository paths and custom domains.

Each build adds the same version to the HTML metadata and `version.json`.
GitHub Actions uses the commit SHA; local builds use a stable source fingerprint.
JavaScript and CSS filenames are content-hashed, so releases cannot mix old
cached code with new HTML.

The editor checks every five minutes and when returning to the page or going
back online. A detected release waits for 15 seconds without interaction.
Focused inputs, open dialogs, Blockly dragging and connected/connecting
collaboration sessions delay the update. Pending JSON edits and the project
are saved before reloading. A failed save prevents the reload and displays a
warning. Shared-view projects are not saved over the personal project.

The URL's `_v` parameter requests fresh HTML without removing shared-project
parameters or the fragment. Development mode does not run the updater.
Pages opened before the updater's first release need one manual reload to
receive it. Browser storage remains the same because the public URL is unchanged.
