# Email Template Components Usage Guide

This directory contains reusable MJML components for the Club Calendar email templates.

## Components Overview

### 1. header.mjml
Renders the brand header with the "Club Calendar wordmark" logo and styling.

**Usage:**
```mjml
<mj-include path="./_components/header.mjml" />
```

**Output:**
- Brand name with emoji icon
- Consistent styling across all templates
- Font size: 14px, Color: #4a5b55

---

### 2. section.mjml
Reference documentation for the content section wrapper pattern.

**Pattern (in templates):**
```mjml
<mj-section background-color="#ffffff" padding="40px 30px">
  <mj-column>
    <!-- Content here -->
  </mj-column>
</mj-section>
```

**Theme Variables:**
- Section background: `#ffffff` (white)
- Body background: `#f7f8f5` (light, greenish)
- Text color: `#14221e` (dark)
- Muted text: `#4a5b55` (light, greenish)
- Primary/link color: `#0b6b58` (brand green)
- Padding: `40px 30px`

---

### 3. button.mjml
Reusable CTA button with fallback link for email clients that don't support buttons.

**Usage in templates:**

```mjml
<!-- Set context variables before including -->
{% set buttonUrl = resetUrl %}
{% set buttonText = 'email.reset.button'|trans %}
<mj-include path="./_components/button.mjml" />
```

**Button Styling:**
- Background color: `#0b6b58` (brand green)
- Text color: `#ffffff` (white)
- Border radius: `8px`
- Font size: `16px`
- Padding: `12px 24px`

**What it renders:**
1. Primary button with link
2. Fallback text message: "Or copy this link:"
3. Fallback URL link in case button doesn't render

**Required Twig variables:**
- `buttonUrl` - The destination URL
- `buttonText` - Button label text

---

### 4. footer.mjml
Footer: hairline, muted brand line and the legal links (imprint, privacy, terms; Twig function `legal_links()`, labels `email.footer.<type>`; no line when none is provided).

**Usage:**
```mjml
<mj-include path="./_components/footer.mjml" />
```

**Future expansion options:**
- Unsubscribe links
- Social media links
- Company contact info
- Copyright notice

---

## Full Template Example

Here's how to structure a template using these components:

```mjml
<mjml>
  <mj-head>
    <mj-title>{{ 'email.reset.subject'|trans }}</mj-title>
    <mj-preview>{{ 'email.reset.subject'|trans }}</mj-preview>
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
        
        <!-- Greeting -->
        <mj-text font-size="18px" font-weight="bold" padding-bottom="8px">
          {{ 'email.reset.greeting'|trans({name: userName}) }}
        </mj-text>
        
        <!-- Body text -->
        <mj-text padding-bottom="24px">
          {{ 'email.reset.body'|trans }}
        </mj-text>
        
        <!-- CTA button component -->
        {% set buttonUrl = resetUrl %}
        {% set buttonText = 'email.reset.button'|trans %}
        <mj-include path="./_components/button.mjml" />
        
        <!-- Additional notes -->
        <mj-text font-size="13px" color="#4a5b55" padding-top="24px">
          {{ 'email.reset.expiry_note'|trans }}
        </mj-text>
        <mj-text font-size="13px" color="#4a5b55">
          {{ 'email.reset.ignore_note'|trans }}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

---

## Build Command

The build process uses MJML CLI with includes support:

```bash
npm run build:mail
```

Each `.mjml` file is compiled to a `.html.twig` template with includes resolved.

---

## Theme Color Reference

Keep these constants consistent across all templates:

| Element | Color | Usage |
|---------|-------|-------|
| Body background | `#f7f8f5` | Page background |
| Section background | `#ffffff` | Content wrapper |
| Primary text | `#14221e` | Body text |
| Muted text | `#4a5b55` | Headers, hints, secondary text |
| Primary/Link | `#0b6b58` | Buttons, links |
| Button text | `#ffffff` | Button label |

---

## Migration Checklist

When refactoring existing templates to use components:

- [ ] Remove hardcoded header "Club Calendar wordmark" lines
- [ ] Replace with `<mj-include path="./_components/header.mjml" />`
- [ ] Extract button definitions into component pattern
- [ ] Set `buttonUrl` and `buttonText` variables before including button component
- [ ] Verify all theme colors remain consistent
- [ ] Test compiled `.html.twig` output
- [ ] Run `npm run build:mail` to rebuild all templates

## New components (redesign)

All use the redesign palette (light only). Set the Twig variable first, then include.

```
{% set code = code %}                      {# optional: code is usually already in the context #}
<mj-include path="./_components/code.mjml" />        <!-- code: big monospace verification code box -->

{% set noticeText = 'email.xyz.note'|trans %}
<mj-include path="./_components/notice.mjml" />          <!-- neutral info box -->
<mj-include path="./_components/notice-warning.mjml" />  <!-- red warning box, same variable -->
```

Recommended page frame: `mj-body` background `#f7f8f5`, `mj-section` background `#ffffff` padding `32px`,
body text `#14221e` 16px/24px, muted text `#4a5b55` 13-14px, headings 24px weight 800. Font stack:
`system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif` (the app's Figtree is not loaded in mails).
