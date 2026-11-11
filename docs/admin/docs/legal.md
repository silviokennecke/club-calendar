# Legal documents

Club Calendar shows three legal documents: the **imprint**, the **privacy policy** and the **terms of use**. You must provide the content of these documents yourself. Club Calendar does not write them for you, and this page is not legal advice. If you are unsure what your installation needs, ask a lawyer.

## The three documents

| Document | Usually called | Users must accept it? |
|---|---|---|
| Imprint | Impressum | No |
| Privacy policy | Datenschutzerklärung | Yes |
| Terms of use | Nutzungsbedingungen | Yes |

Users accept the privacy policy and the terms of use when they sign up. The imprint does not need consent.

## Two ways to provide each document

For each document, choose one of two ways:

=== "Markdown files"

    Write the document as a Markdown file and place it in the `legal` folder:

    - `imprint.md`
    - `privacy.md`
    - `terms.md`

    The first heading in the file becomes the title. Raw HTML in the file is shown as plain text.

    Where the folder is depends on how you run the app:

    - **Docker:** mount your folder into the container at `/data/legal`, for example `./legal:/data/legal`. This is the folder the image reads. The file names stay the same.
    - **Without Docker:** use the `backend/legal/` folder, or set `LEGAL_DOCUMENTS_PATH` to another folder.

    The folder `backend/legal/` contains `*.md.example` files as a starting point. Copy them to `*.md` and replace the placeholder text. Your real `*.md` files are not part of the code repository.

=== "External links"

    If your documents are already published on another page, link to them instead. Set the link in the settings:

    - `LEGAL_IMPRINT_URL`
    - `LEGAL_PRIVACY_URL`
    - `LEGAL_TERMS_URL`

    Each value must be a full address that starts with `https://` (or `http://`). Users are sent to that page when they open the document.

If you provide both a file and a link for the same document, the **file wins**. If you provide neither, the document is marked as "not provided". See the [Configuration reference](configuration/reference.md) for all related settings.

!!! warning "Invalid links are ignored"

    An address that is not a full `http(s)://` link is ignored. The app then falls back to the file or to "not provided". The sync command reports this as a warning. Check its output after you change a link.

## Where the documents appear

- **Footer:** the imprint, privacy policy and terms of use are linked in the footer of the sign-in pages and of the public pages.
- **Sign-up:** the new-account form has checkboxes for the privacy policy and the terms of use. The user must tick both.
- **E-mails:** the footer of every e-mail the app sends links to the documents that are provided.

If a document is not provided, its link does not appear.

## Changing a document

1. Edit the Markdown file, or change the link in the settings.
2. Load the change into the app with the sync command:

    === "Docker"

        ```bash
        docker compose exec app php bin/console app:legal:sync
        ```

        Replace `app` with the name of your app service if it is different.

    === "Without Docker"

        ```bash
        php bin/console app:legal:sync
        ```

The sync also runs automatically when the container starts and when the application cache is cleared. You only need to run it by hand if you want to see the result right away.

What a change does depends on the kind of change:

| Change | Effect for users |
|---|---|
| Edit the content of a Markdown file | New version. Users must accept it again. |
| Change a link URL | Same document. Users are **not** asked again. |
| Switch from a file to a link, or from a link to a file | New version. Users must accept it again. |
| Remove a file or link | The document is "not provided". |

The app keeps every old version, so the consent history of each user stays complete.

!!! warning "Consent is asked again after a content change"

    Every change to the privacy policy or the terms of use means that all users must accept the new version. Make sure the text is final before you publish it.

## What users see after a change

- **Running sessions:** users who are already signed in see a banner about the changed documents. They can dismiss it and keep working.
- **Next sign-in:** users must accept the new privacy policy and terms of use before they can continue. They can also open their consent history or delete their account from that page.
- **Maximum delay:** sessions last at most 30 days, so every user is asked within that time.

If no privacy policy and no terms of use are provided, nobody is asked for consent.

## What is stored when a user accepts

For each accepted document, the app stores:

- the version of the document that was accepted
- the time of acceptance
- the IP address of the user
- the user agent (the browser or app name the user sent)

Your privacy policy must describe this. Users can see their own consent history in their profile.

## What the security log stores

Besides the consent history, the app keeps a security log per account (see [Protection mechanisms](security.md#security-log)). For each entry it stores the time, the IP address, the approximate city and country, and the browser name and version. It covers sign-ins (password, passkey, single sign-on, AI app connections), failed sign-ins on existing accounts, two-step sign-in and password changes. Entries are deleted after one year, and when the account is deleted.

Your privacy policy must describe this log, its purpose, and its retention period.

## Troubleshooting

- **A document does not appear:** run `app:legal:sync` and read its output. A missing file is reported as a warning.
- **A link is not used:** check that it starts with `https://` or `http://` and has no spaces. The sync output names invalid values.
- **The sync fails in Docker:** the container still starts, but the documents may be out of date. Check the container log for the warning "legal document sync failed". Then run the sync command by hand to see the error.
- **Changes do not appear:** make sure the file is in the folder the app reads. In Docker, check the mount. Without Docker, check `LEGAL_DOCUMENTS_PATH`.

For log access and other operating tasks, see [Operations](operations.md). For the initial setup, see the [Quick start](quick-start.md).
