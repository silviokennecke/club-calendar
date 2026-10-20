# Legal documents

Place the legal texts of your installation here as Markdown files (one language per document):

- `imprint.md` (Impressum)
- `privacy.md` (Datenschutzerklaerung, requires the users' consent)
- `terms.md` (Nutzungsbedingungen, requires the users' consent)

The first `# Heading` is used as the title. Raw HTML in the files is escaped. The `*.md` files are gitignored; copy
the `*.md.example` files as a starting point. The directory can be changed with `LEGAL_DOCUMENTS_PATH`.

The files are synchronised into the database on `cache:clear`/`cache:warmup` and by `php bin/console app:legal:sync`
(docker entrypoint and deploy run it after the migrations). Versions are identified by the SHA-256 hash of the file:
a changed file creates a new version (users must consent again), an unchanged file does nothing, a removed file
retires the document ("not provided"), and the unchanged file coming back restores it.

## External links instead of files

A document can also be an externally hosted page: set `LEGAL_IMPRINT_URL`, `LEGAL_PRIVACY_URL` and/or `LEGAL_TERMS_URL` to an
absolute `http(s)://` URL. A Markdown file of the same type always wins; without a file the link is used; without
either the document is "not provided". Invalid values are ignored and reported as a warning by `app:legal:sync`.
A link is one single version: users consent to a privacy policy / terms given as a link once and are not asked
again when the URL changes (the new URL is stored in place). Switching between file and link creates a new version
(consent is asked again). Removing the link retires the document; the same kind of link coming back restores it.
