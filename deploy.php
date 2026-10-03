<?php

declare(strict_types=1);

namespace Deployer;

/*
 * Deployer (https://deployer.org) config.   Run from the repo root:
 *
 *     npm run deploy -- staging            (= backend/vendor/bin/dep deploy staging)
 *     npm run deploy -- production -v
 *     backend/vendor/bin/dep rollback production
 *
 * Targets come from ./.env (see .env.example) or from real environment
 * variables, so the same file works locally and in a pipeline.
 *
 * Flow: build the frontend + mail templates locally into .deploy/<target>,
 * upload backend/ (incl. the built SPA in public/) as a new release, run
 * composer install, migrations and cache warmup on the server, then switch the
 * `current` symlink. Point the web server docroot at {{deploy_path}}/current/public.
 */

require 'recipe/symfony.php';

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

// ── Hosts ────────────────────────────────────────────────────────────────────
// DEPLOY_TARGETS="staging production"; per target DEPLOY_<NAME>_<SETTING>
$targets = preg_split('/\s+/', trim((string) getenv('DEPLOY_TARGETS')), -1, PREG_SPLIT_NO_EMPTY);
foreach ($targets as $name) {
    $prefix = 'DEPLOY_'.strtoupper(str_replace('-', '_', $name)).'_';
    $env = static fn (string $key, ?string $default = null): ?string => (false !== ($v = getenv($prefix.$key)) && '' !== $v) ? $v : $default;
    foreach (['HOST', 'USER', 'PATH', 'URL'] as $required) {
        $env($required) ?? throw new \RuntimeException("{$prefix}{$required} is not set");
    }

    $host = host($name)
        ->setHostname($env('HOST'))
        ->setRemoteUser($env('USER'))
        ->setPort($env('PORT', '22'))
        ->setDeployPath(rtrim($env('PATH'), '/'))
        ->set('url', rtrim($env('URL'), '/'))
        ->set('env_file', $env('ENV_FILE'))
        ->set('migrate', '0' !== $env('MIGRATE', '1'));
    if (null !== $env('KEY')) {
        $host->setIdentityFile($env('KEY'));
    }
    if (null !== $env('PHP')) {
        $host->set('bin/php', $env('PHP'));
    }
}

// ── Config ───────────────────────────────────────────────────────────────────
set('keep_releases', 5);
set('shared_dirs', ['var/log', 'config/jwt']); // JWT keys stay on the server
set('shared_files', ['.env.local']);           // secrets stay on the server
set('composer_options', '--prefer-dist --no-progress --no-interaction --no-dev --optimize-autoloader --no-scripts');
set('env', ['APP_ENV' => 'prod', 'APP_DEBUG' => '0']);
set('stage_dir', ROOT.'/.deploy/{{alias}}');

// ── Local build ──────────────────────────────────────────────────────────────
desc('Builds backend + frontend into .deploy/<target>');
task('build:local', function () {
    $stage = parse('{{stage_dir}}');
    $q = escapeshellarg(...);

    runLocally('rm -rf '.$q($stage).' && mkdir -p '.$q($stage));
    if (!is_dir(ROOT.'/node_modules')) {
        runLocally('npm ci', cwd: ROOT, timeout: null);
    }

    info('Staging backend');
    runLocally(
        'rsync -a --exclude=/.env --exclude=/.env.* --exclude=/var/ --exclude=/vendor/ --exclude=/node_modules/ '
        .'--exclude=/tests/ --exclude=/.phpunit.cache/ --exclude=/.php-cs-fixer.* --exclude=/phpunit* '
        .'--exclude=/phpstan* --exclude=/compose.override.* --exclude=/config/jwt/*.pem '
        .'--exclude=/public/index.html --exclude=/public/assets/ '
        .$q(ROOT.'/backend/').' '.$q($stage.'/backend/'),
    );
    // Symfony's runtime needs a .env; real secrets live in the shared .env.local
    file_put_contents($stage.'/backend/.env', "APP_ENV=prod\nAPP_DEBUG=0\n");

    info('Compiling mail templates');
    runLocally(
        'npx --no-install mjml backend/templates/email/verify_email.mjml -o '.$q($stage.'/backend/templates/email/verify_email.html.twig'),
        cwd: ROOT,
    );

    info('Building frontend');
    runLocally(
        'npm run build -w frontend -- --outDir '.$q($stage.'/frontend-dist').' --emptyOutDir',
        cwd: ROOT,
        timeout: null,
        env: ['VITE_API_URL' => parse('{{url}}')],
    );

    info('Moving frontend into backend/public');
    runLocally('rsync -a '.$q($stage.'/frontend-dist/').' '.$q($stage.'/backend/public/'));
    foreach (['index.html', '.htaccess', 'index.php'] as $file) {
        if (!is_file("$stage/backend/public/$file")) {
            throw error("$file is missing from the built public dir");
        }
    }
});

// Replace the git based code strategy with an upload of the local build
desc('Uploads the local build as the new release');
task('deploy:update_code', function () {
    upload(parse('{{stage_dir}}').'/backend/', '{{release_path}}/', ['options' => ['--delete']]);
});
before('deploy:update_code', 'build:local');

desc('Uploads the configured ENV_FILE as shared .env.local');
task('deploy:env_file', function () {
    $file = get('env_file');
    if (!$file) {
        if (!test('[ -f {{deploy_path}}/shared/.env.local ]')) {
            warning('No .env.local on the server and no ENV_FILE configured: config must come from real env vars.');
        }
        return;
    }
    $file = str_starts_with($file, '/') ? $file : ROOT.'/'.$file;
    if (!is_file($file)) {
        throw error("ENV_FILE not found: $file");
    }
    run('mkdir -p {{deploy_path}}/shared');
    upload($file, '{{deploy_path}}/shared/.env.local', ['options' => ['--chmod=F600']]);
});
after('deploy:update_code', 'deploy:env_file');

desc('Warms up the Symfony cache');
task('cache:warmup', function () {
    run('{{bin/console}} cache:warmup {{console_options}}');
});

desc('Migrates database (unless MIGRATE=0)');
task('database:migrate:maybe', function () {
    if (get('migrate')) {
        invoke('database:migrate');
    }
});

desc('Checks that the server has JWT keys');
task('deploy:check_jwt', function () {
    if (!test('[ -f {{deploy_path}}/shared/config/jwt/private.pem ]')) {
        warning('{{deploy_path}}/shared/config/jwt/private.pem is missing: run lexik:jwt:generate-keypair on the server.');
    }
});

desc('Deploys the project');
task('deploy', [
    'deploy:prepare',
    'deploy:vendors',
    'deploy:check_jwt',
    'database:migrate:maybe',
    'deploy:cache:clear',
    'cache:warmup',
    'deploy:publish',
]);
