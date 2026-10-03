<?php

declare(strict_types=1);

namespace Deployer;

/*
 * Deployer (https://deployer.org) config. For now it only builds the project;
 * the deployment itself is done by hand.
 *
 *     npm run deploy:build        (= backend/vendor/bin/dep build)
 *
 * Settings come from ./.env (see .env.example) or from real environment
 * variables, so the same file works locally and in a pipeline.
 *
 * Result: backend/ with compiled mail templates and the built SPA in
 * backend/public (next to index.php and .htaccess), ready to be shipped.
 * Composer dependencies are not touched: `composer install --no-dev` would
 * remove Deployer itself from the local vendor dir, so run it on the target.
 */

const ROOT = __DIR__;

/** Load KEY=VALUE pairs from .env; variables that are already set win. */
function loadDotenv(string $file): void
{
    if (!is_file($file)) {
        return;
    }
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ('' === $line || '#' === $line[0] || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key = trim(preg_replace('/^export\s+/', '', trim($key)));
        $value = trim($value);
        if (preg_match('/^(["\'])(.*)\1$/', $value, $m)) {
            $value = $m[2];
        } else {
            $value = trim(preg_replace('/\s+#.*$/', '', $value));
        }
        if (false === getenv($key)) {
            putenv("$key=$value");
        }
    }
}

loadDotenv(ROOT.'/.env');

localhost('local');

desc('Compiles mail templates and builds the frontend into backend/public');
task('build', function () {
    if (!is_dir(ROOT.'/node_modules')) {
        runLocally('npm ci', cwd: ROOT, timeout: null);
    }

    info('Compiling mail templates');
    runLocally('npm run build:mail -w backend', cwd: ROOT);

    info('Building frontend');
    // VITE_API_URL (public URL of the deployment) from .env overrides frontend/.env*
    $api = getenv('VITE_API_URL');
    runLocally(
        'npm run build -w frontend',
        cwd: ROOT,
        timeout: null,
        env: false !== $api && '' !== $api ? ['VITE_API_URL' => rtrim($api, '/')] : null,
    );

    foreach (['index.html', '.htaccess', 'index.php'] as $file) {
        if (!is_file(ROOT."/backend/public/$file")) {
            throw error("backend/public/$file is missing after the build");
        }
    }
    info('Build ready in backend/public');
});
