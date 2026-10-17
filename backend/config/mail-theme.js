/**
 * Mail Theme Configuration
 *
 * Centralized theme variables for email templates.
 * Extracted from: backend/templates/email/*.mjml
 *
 * Usage:
 *   const theme = require('./mail-theme');
 *   // Access: theme.colors.primary, theme.fonts.size.heading, etc.
 */

module.exports = {
  /**
   * Color palette
   * Primary: brand color for CTA and links
   * Background: page/body background
   * Surface: content container background
   * Text colors: hierarchy from dark to muted
   */
  colors: {
    // Primary brand color
    primary: '#2563eb',

    // Backgrounds
    background: '#f4f4f4',    // Page background
    surface: '#ffffff',       // Content container

    // Text colors
    text: '#333333',          // Primary text
    textMuted: '#888888',     // Secondary/disabled text
    textDark: '#111111',      // High contrast (code display)
  },

  /**
   * Typography system
   * Defines font families and size scale
   */
  fonts: {
    // Font family stack
    family: 'Arial, sans-serif',

    // Font sizes for semantic usage
    size: {
      code: '36px',     // Verification codes, large display
      heading: '18px',  // Section headings
      body: '16px',     // Default body text
      small: '13px',    // Fine print, secondary info
      label: '14px',    // Brand name, labels
    },

    // Font weights
    weight: {
      normal: 400,
      bold: 700,
    },

    // Line heights for readability
    lineHeight: {
      tight: 1.4,
      normal: 1.6,
      relaxed: 1.8,
    },
  },

  /**
   * Spacing scale
   * Consistent padding/margin values following the modular scale
   */
  spacing: {
    xs: '8px',        // Small spacing (dividers, tight components)
    sm: '10px',       // Small spacing (letter-spacing, minor padding)
    md: '16px',       // Medium spacing (block padding)
    lg: '24px',       // Large spacing (between content blocks)
    xl: '30px',       // Extra large spacing (horizontal section padding)
    xxl: '40px',      // 2XL spacing (vertical section padding)
  },

  /**
   * Brand elements
   * Identity components for email headers/branding
   */
  brand: {
    name: 'Club Calendar',
    icon: '📅',
  },

  /**
   * Component presets
   * Pre-configured styles for common email components
   */
  components: {
    // Section container
    section: {
      backgroundColor: '#ffffff',
      paddingVertical: '40px',
      paddingHorizontal: '30px',
    },

    // Primary button
    button: {
      backgroundColor: '#2563eb',
      textColor: '#ffffff',
      borderRadius: '6px',
      fontSize: '16px',
      paddingVertical: '12px',
      paddingHorizontal: '24px',
    },

    // Brand header
    header: {
      fontSize: '14px',
      color: '#888888',
      paddingBottom: '16px',
    },

    // Main heading
    heading: {
      fontSize: '18px',
      fontWeight: 'bold',
      paddingBottom: '8px',
    },

    // Body paragraph
    paragraph: {
      fontSize: '16px',
      color: '#333333',
      paddingBottom: '24px',
      lineHeight: 1.6,
    },

    // Small text / fine print
    small: {
      fontSize: '13px',
      color: '#888888',
      paddingTop: '24px',
    },

    // Verification code display
    code: {
      fontSize: '36px',
      fontWeight: 'bold',
      letterSpacing: '10px',
      color: '#111111',
      containerBackgroundColor: '#f4f4f4',
      padding: '16px 24px',
    },
  },
};
