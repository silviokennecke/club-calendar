# Changelog

All notable changes to this project are documented in this file, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and are released as git tags `vX.Y.Z`.

## [Unreleased]

### Added

- User documentation for all features in `/help`, including the subscribe guide with app tabs (iPhone/iPad, Mac, Outlook, Google Calendar) at `/help/publishing/subscribe`; the old `/help/subscribe` URL (with `?app=`) redirects there.
- In-app help at `/help` (German and English) with full-text search and contextual `HelpLink`s, compiled from Markdown at build time; screenshots are generated with Playwright (`npm run docs:screenshots`).

### Changed

- Page footers show a single help link: the help center (`/help`), on public calendar pages the subscribe guide; the help pages show only the legal links.
