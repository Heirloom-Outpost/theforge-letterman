# Letterman: the student page

This repository publishes the student page of Letterman, the learning portal of the Heirloom Estate Academy, at
https://heirloom-outpost.github.io/theforge-letterman/

It holds only what a student's browser downloads anyway: the page, its course content and its pictures. The
teaching console, the teacher's material and the source of record are not here.

- `dist/site/` is the page, exactly as it is built.
- `MANIFEST.md` lists every file with its fingerprint. It is generated and never edited by hand.
- `.github/workflows/pages.yml` publishes `dist/site/` to the address above whenever this repository changes.

Nothing on the page sends anything anywhere. A student's answers stay in their own browser, and only if they
choose to keep them.
