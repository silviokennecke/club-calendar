# Email Template Components Usage Guide

This directory contains reusable MJML components for the Club Calendar email templates.

## Components Overview

### 1. header.mjml
Renders the brand header with the "📅 Club Calendar" logo and styling.

**Usage:**
```mjml
<mj-include path="./_components/header.mjml" />
```

**Output:**
- Brand name with emoji icon
- Consistent styling across all templates
- Font size: 14px, Color: #888888

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
- Body background: `#f4f4f4` (light gray)
- Text color: `#333333` (dark)
- Muted text: `#888888` (light gray)
- Primary/link color: `#2563eb` (blue)
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
- Background color: `#2563eb` (primary blue)
- Text color: `#ffffff` (white)
- Border radius: `6px`
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
Placeholder for footer content (currently minimal).

**Usage:**
```mjml
<mj-include path="./_components/footer.mjml" />
```

**Future expansion options:**
- Unsubscribe links
- Social media links
- Company contact info
- Legal/privacy links
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
      <mj-all font-family="Arial, sans-serif" />
      <mj-text font-size="16px" color="#333333" line-height="1.6" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f4">
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
        <mj-text font-size="13px" color="#888888" padding-top="24px">
          {{ 'email.reset.expiry_note'|trans }}
        </mj-text>
        <mj-text font-size="13px" color="#888888">
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
| Body background | `#f4f4f4` | Page background |
| Section background | `#ffffff` | Content wrapper |
| Primary text | `#333333` | Body text |
| Muted text | `#888888` | Headers, hints, secondary text |
| Primary/Link | `#2563eb` | Buttons, links |
| Button text | `#ffffff` | Button label |

---

## Migration Checklist

When refactoring existing templates to use components:

- [ ] Remove hardcoded header "📅 Club Calendar" lines
- [ ] Replace with `<mj-include path="./_components/header.mjml" />`
- [ ] Extract button definitions into component pattern
- [ ] Set `buttonUrl` and `buttonText` variables before including button component
- [ ] Verify all theme colors remain consistent
- [ ] Test compiled `.html.twig` output
- [ ] Run `npm run build:mail` to rebuild all templates
