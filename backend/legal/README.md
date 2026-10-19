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
