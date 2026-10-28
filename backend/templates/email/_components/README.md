# Email Template Components

Reusable MJML components for Club Calendar email templates. These components ensure consistency, maintainability, and scalability across all transactional emails.

## Components

### `header.mjml`
The brand header component with "Club Calendar wordmark" branding.

**Includes:**
- Text wordmark "Club Calendar" in brand green plus a hairline
- Company name
- Consistent styling (14px, #4a5b55 color)

**Reusable across:** All email types

**Example usage:**
```mjml
<mj-include path="./_components/header.mjml" />
```

---

### `button.mjml`
Call-to-action button component with fallback link.

**Features:**
- Primary action button (#0b6b58 brand-green background)
- Fallback text link for email clients that don't support buttons
- Consistent padding, border-radius, and typography
- White text on colored background for contrast

**Requires Twig variables:**
- `buttonUrl` — The destination URL for the action
- `buttonText` — The button label text (typically `'email.action.button'|trans`)

**Reusable in:** Password reset, email verification links, etc.

**Example usage:**
```mjml
{% set buttonUrl = resetUrl %}
{% set buttonText = 'email.reset.button'|trans %}
<mj-include path="./_components/button.mjml" />
```

**Output:**
```
┌─────────────────────────────┐
│      [Reset Password]       │  ← clickable button (#0b6b58)
└─────────────────────────────┘

Or copy this link:
https://example.com/reset?token=...  ← fallback link
```

---

### `section.mjml`
Reference documentation for the content section wrapper pattern.

**Not an include file** — this is a documentation file explaining the standard section structure used in all templates.

**Pattern:**
```mjml
<mj-section background-color="#ffffff" padding="40px 30px">
  <mj-column>
    <!-- content -->
  </mj-column>
</mj-section>
```

**Theme values to use:**
- `background-color="#ffffff"` — white content section
- `padding="40px 30px"` — standard margins
- Wrap in `<mj-body background-color="#f7f8f5">` — light gray body background

---

### `footer.mjml`
Footer: hairline, muted brand line and the legal links (imprint, privacy, terms) from the Twig function `legal_links()` (`App\Twig\LegalLinksExtension`, `LegalDocumentService::publicLinks()`); labels `email.footer.<type>`; the link line is omitted when no link exists.

**Current state:** Minimal/empty (ready for expansion)

**Future use cases:**
- Social media links
- Unsubscribe preferences
- Legal/privacy links
- Company address
- Copyright notice

**Example usage:**
```mjml
<mj-include path="./_components/footer.mjml" />
```

---

## Theme Colors

Keep these values consistent across all templates and components:

| Element | Hex Code | Usage |
|---------|----------|-------|
| **Body Background** | `#f7f8f5` | Page background (light, greenish) |
| **Section Background** | `#ffffff` | Content wrapper (white) |
| **Primary Text** | `#14221e` | Body text, headings |
| **Muted Text** | `#4a5b55` | Headers, hints, timestamps, secondary info |
| **Primary Color** | `#0b6b58` | Button background, link color (brand green) |
| **Button Text** | `#ffffff` | Text on button (white) |
| **Border Radius** | `8px` | Button corners (boxes 6-10px) |

---

## Building Templates

The build process compiles MJML files to Twig templates:

```bash
cd backend
npm run build:mail
```

Each `.mjml` file in the email directory is compiled and outputs a `.html.twig` template.
The MJML compiler resolves all `<mj-include>` statements, inlining the component markup.

---

## Template Structure

### Minimal Template Example

```mjml
<mjml>
  <mj-head>
    <mj-title>{{ 'email.action.subject'|trans }}</mj-title>
    <mj-preview>{{ 'email.action.subject'|trans }}</mj-preview>
    <mj-attributes>
      <mj-all font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" />
      <mj-text font-size="16px" color="#14221e" line-height="1.6" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f7f8f5">
    <mj-section background-color="#ffffff" padding="40px 30px">
      <mj-column>
        
        <!-- Brand header -->
        <mj-include path="./_components/header.mjml" />
        
        <!-- Your content -->
        <mj-text font-size="18px" font-weight="bold" padding-bottom="8px">
          {{ 'email.greeting'|trans({name: userName}) }}
        </mj-text>
        <mj-text padding-bottom="24px">
          {{ 'email.body'|trans }}
        </mj-text>
        
        <!-- Optional: CTA button -->
        {% set buttonUrl = actionUrl %}
        {% set buttonText = 'email.button'|trans %}
        <mj-include path="./_components/button.mjml" />
        
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

---

## Adding a New Email Template

1. **Create the `.mjml` file** in `backend/templates/email/`
   ```
   backend/templates/email/my-new-email.mjml
   ```

2. **Use the structure above** — copy from existing templates or use examples in this directory

3. **Include components** where they reduce duplication
   - Always use `header.mjml` for branding
   - Use `button.mjml` for any call-to-action
   - Reference `section.mjml` patterns for layout

4. **Add translations** to frontend locales
   ```json
   {
     "email.my_email.subject": "...",
     "email.my_email.greeting": "...",
     "email.my_email.body": "..."
   }
   ```

5. **Build the templates**
   ```bash
   npm run build:mail
   ```

6. **Test the output** — check `backend/templates/email/my-new-email.html.twig`
   - Verify included components are properly inlined
   - Check all Twig variables are present

---

## Migrating Existing Templates

To refactor an existing template to use components:

### Before:
```mjml
<mj-text font-size="14px" color="#4a5b55" padding-bottom="16px">
  Club Calendar wordmark
</mj-text>
```

### After:
```mjml
<mj-include path="./_components/header.mjml" />
```

### Migration checklist:
- [ ] Remove hardcoded "Club Calendar wordmark" header
- [ ] Replace with header component include
- [ ] Extract button pattern into button component
- [ ] Define `buttonUrl` and `buttonText` before button include
- [ ] Verify color usage matches theme palette
- [ ] Run `npm run build:mail`
- [ ] Check compiled `.html.twig` output
- [ ] Test in email client (Gmail, Outlook, etc.)

---

## Best Practices

1. **Use i18n for all text**
   - Never hardcode user-facing text
   - All strings must be translatable keys

2. **Keep components small**
   - One responsibility per component
   - Easier to maintain and reuse

3. **Document new components**
   - Include usage examples
   - List required variables
   - Document styling defaults

4. **Test across clients**
   - Some email clients don't support buttons or includes
   - The button component includes fallback links for safety
   - Always check compiled HTML in real email services

5. **Consistent spacing**
   - Use the theme padding values
   - 24px between major sections
   - 12px between related items

6. **Color contrast**
   - Primary text (#14221e) on white background ✓
   - Muted text (#4a5b55) on white background ✓
   - Button text (#ffffff) on brand-green background (#0b6b58) ✓

---

## Reference Files

- **`USAGE.md`** — Detailed usage guide with code examples
- **`header.mjml`** — Brand header component
- **`button.mjml`** — CTA button component with fallback
- **`footer.mjml`** — Footer (hairline + brand line + legal links)
- **`section.mjml`** — Section pattern documentation
