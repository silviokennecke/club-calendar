#!/usr/bin/env node

/**
 * Mail template builder: compiles all MJML templates to HTML Twig templates
 *
 * Features:
 * - Loads theme from config/mail-theme.js
 * - Discovers .mjml files (excludes _components/ and _*.mjml files)
 * - Replaces theme variable placeholders (e.g., {{ THEME.colors.primary }})
 * - Compiles to HTML using MJML CLI
 * - Validates for hardcoded colors
 * - Supports watch mode with --watch flag
 *
 * Usage:
 *   node backend/build/mail-builder.js          # Compile once
 *   node backend/build/mail-builder.js --watch  # Watch mode
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

// Configuration
const SCRIPT_DIR = __dirname;
const BACKEND_DIR = path.dirname(SCRIPT_DIR);
const PROJECT_ROOT = path.dirname(BACKEND_DIR);
const TEMPLATE_DIR = path.join(BACKEND_DIR, 'templates', 'email');
const THEME_FILE = path.join(BACKEND_DIR, 'config', 'mail-theme.js');

// Common hardcoded color patterns to warn about (hex colors, rgb values)
const HARDCODED_COLOR_PATTERNS = [
  /#[0-9a-fA-F]{6}/g,  // #RRGGBB
  /#[0-9a-fA-F]{3}/g,  // #RGB
  /rgb\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/gi,  // rgb(r, g, b)
];

// State
let theme = null;
let watchMode = false;
let watcher = null;

/**
 * Load and parse the mail theme configuration
 */
function loadTheme() {
  try {
    if (!fs.existsSync(THEME_FILE)) {
      console.error(`✗ Theme file not found: ${THEME_FILE}`);
      process.exit(1);
    }

    // Clear require cache to reload fresh theme
    delete require.cache[require.resolve(THEME_FILE)];
    theme = require(THEME_FILE);

    return theme;
  } catch (error) {
    console.error(`✗ Failed to load theme: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Get nested value from theme object using dot notation
 * e.g., "colors.primary" -> theme.colors.primary
 */
function getThemeValue(path) {
  return path.split('.').reduce((obj, key) => obj?.[key], theme);
}

/**
 * Replace theme variables in template content
 * Supports: {{ THEME.colors.primary }}, {{ THEME.fonts.size.body }}, etc.
 */
function replaceThemeVariables(content) {
  if (!theme) return content;

  // Find all {{ THEME.* }} placeholders
  const themeVarPattern = /\{\{\s*THEME\.([a-zA-Z0-9._]+)\s*\}\}/g;

  return content.replace(themeVarPattern, (match, path) => {
    const value = getThemeValue(path);

    if (value === undefined) {
      console.warn(`  ⚠ Theme variable not found: THEME.${path}`);
      return match; // Keep original if not found
    }

    // Convert value to string if it's not already
    return String(value);
  });
}

/**
 * Inline MJML component includes by replacing <mj-include path="..." /> with component content
 * Handles relative paths and logs results
 */
function inlineComponents(content, templateDir) {
  const includePattern = /<mj-include\s+path="([^"]+)"\s*\/>/g;
  const inlinedComponents = [];
  const skippedIncludes = [];

  // MJML drops raw text between components, so `{% set name = expr %}` lines of the including template
  // would never reach the Twig output. Take them out and substitute the variables into the components.
  const setPattern = /^[ \t]*\{%\s*set\s+(\w+)\s*=\s*(.+?)\s*%\}[ \t]*\r?\n?/gm;
  const variables = {};
  content = content.replace(setPattern, (match, name, expression) => {
    variables[name] = expression;
    return '';
  });
  const bindVariables = component =>
    component.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
      name in variables ? `{{ (${variables[name]}) }}` : match,
    );

  let processed = content.replace(includePattern, (match, includePath) => {
    // Resolve relative path (relative to template directory)
    const resolvedPath = path.join(templateDir, includePath);

    try {
      if (!fs.existsSync(resolvedPath)) {
        skippedIncludes.push(includePath);
        console.warn(`  ⚠ Component file not found: ${includePath}`);
        return match; // Keep original include if file not found
      }

      // Read component file
      const componentContent = fs.readFileSync(resolvedPath, 'utf8');
      inlinedComponents.push(includePath);
      return bindVariables(componentContent);
    } catch (error) {
      skippedIncludes.push(includePath);
      console.warn(`  ⚠ Failed to read component ${includePath}: ${error.message}`);
      return match; // Keep original include on error
    }
  });

  // Log inlined components
  if (inlinedComponents.length > 0) {
    console.log(`    → inlined ${inlinedComponents.length} component(s): ${inlinedComponents.join(', ')}`);
  }

  return processed;
}

/**
 * Validate template for hardcoded colors and return warnings
 */
function validateTemplate(filename, content) {
  const warnings = [];

  // Skip validation for component files
  if (filename.startsWith('_')) {
    return warnings;
  }

  // Look for hardcoded colors outside of Twig variables and comments
  // This is a simple check - real validation would need HTML parsing
  const lines = content.split('\n');

  lines.forEach((line, lineNum) => {
    // Skip Twig expressions and comments
    if (line.includes('{{') || line.includes('{#') || line.includes('<!--')) {
      return;
    }

    // Check for hardcoded color patterns
    HARDCODED_COLOR_PATTERNS.forEach(pattern => {
      const matches = line.match(pattern);
      if (matches) {
        matches.forEach(match => {
          warnings.push({
            line: lineNum + 1,
            match,
            message: `Hardcoded color found (consider using theme variables): ${match}`,
          });
        });
      }
    });
  });

  return warnings;
}

/**
 * Discover all compilable MJML templates
 * Excludes: _components/ directory and _*.mjml files
 */
function discoverTemplates() {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    console.error(`✗ Template directory not found: ${TEMPLATE_DIR}`);
    process.exit(1);
  }

  try {
    const entries = fs.readdirSync(TEMPLATE_DIR, { withFileTypes: true });

    return entries
      .filter(entry => {
        // Skip directories
        if (entry.isDirectory()) {
          return entry.name !== '_components';
        }

        // Only .mjml files, exclude _*.mjml
        return entry.isFile() &&
               entry.name.endsWith('.mjml') &&
               !entry.name.startsWith('_');
      })
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    console.error(`✗ Failed to discover templates: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Compile a single MJML template
 */
function compileTemplate(filename) {
  const mjmlPath = path.join(TEMPLATE_DIR, filename);
  const htmlPath = path.join(TEMPLATE_DIR, filename.replace('.mjml', '.html.twig'));
  const relMjmlPath = path.relative(PROJECT_ROOT, mjmlPath);
  const relHtmlPath = path.relative(PROJECT_ROOT, htmlPath);

  try {
    // Read MJML file
    let content = fs.readFileSync(mjmlPath, 'utf8');

    // Replace theme variables
    content = replaceThemeVariables(content);

    // Inline MJML components (must happen after theme replacement, before MJML compilation)
    content = inlineComponents(content, TEMPLATE_DIR);

    // Validate for hardcoded colors
    const colorWarnings = validateTemplate(filename, content);
    if (colorWarnings.length > 0) {
      colorWarnings.forEach(warning => {
        console.warn(`  ⚠ ${filename}:${warning.line} - ${warning.message}`);
      });
    }

    // Write processed content to temp file for mjml to compile
    const tempPath = mjmlPath + '.processed';
    fs.writeFileSync(tempPath, content);

    try {
      // Compile with MJML CLI
      const result = spawnSync('mjml', [tempPath, '-o', htmlPath], {
        cwd: PROJECT_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Clean up temp file
      fs.unlinkSync(tempPath);

      if (result.status !== 0) {
        const stderr = result.stderr.toString();
        throw new Error(stderr || 'MJML compilation failed');
      }

      console.log(`  ✓ ${relMjmlPath} → ${relHtmlPath}`);
      return true;
    } catch (error) {
      // Clean up temp file on error
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
  } catch (error) {
    console.error(`  ✗ ${relMjmlPath} - ${error.message}`);
    return false;
  }
}

/**
 * Compile all templates
 */
function compileAll() {
  const templates = discoverTemplates();

  if (templates.length === 0) {
    console.log('No email templates found to compile.');
    return true;
  }

  console.log(`\nCompiling ${templates.length} email template(s)...`);

  let failed = 0;
  templates.forEach(template => {
    if (!compileTemplate(template)) {
      failed++;
    }
  });

  if (failed > 0) {
    console.error(`\n✗ ${failed}/${templates.length} template(s) failed to compile`);
    return false;
  }

  console.log(`✓ Successfully compiled ${templates.length} template(s)\n`);
  return true;
}

/**
 * Watch mode: monitor templates and recompile on changes
 */
function setupWatchMode() {
  console.log(`\nWatching for changes in ${TEMPLATE_DIR}...`);

  // Use fs.watch for file system monitoring
  watcher = fs.watch(TEMPLATE_DIR, { recursive: false }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.mjml') || filename.startsWith('_')) {
      return;
    }

    // Debounce: wait a bit for write to complete
    setTimeout(() => {
      console.log(`\nDetected change: ${filename}`);
      compileTemplate(filename);
    }, 100);
  });

  // Handle exit gracefully
  process.on('SIGINT', () => {
    console.log('\n\nStopping watch mode...');
    if (watcher) {
      watcher.close();
    }
    process.exit(0);
  });
}

/**
 * Main entry point
 */
function main() {
  // Check for --watch flag
  watchMode = process.argv.includes('--watch');

  console.log('Club Calendar - Mail Template Builder');
  console.log('=====================================');

  // Load theme first
  loadTheme();
  console.log(`✓ Theme loaded from config/mail-theme.js`);

  // Compile all templates
  const success = compileAll();

  // Set up watch mode if requested
  if (watchMode) {
    setupWatchMode();
  } else if (!success) {
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for programmatic use
module.exports = {
  loadTheme,
  discoverTemplates,
  compileTemplate,
  compileAll,
  replaceThemeVariables,
  inlineComponents,
  validateTemplate,
};
