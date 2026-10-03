<?php

declare(strict_types=1);

namespace Deployer;

require 'recipe/common.php';

add('recipes', ['vereinbar']);

set('symfony_version', function () {
    $result = run('{{bin/console}} --version');
    preg_match_all('/(\d+\.?)+/', $result, $matches);
    return $matches[0][0] ?? 5.0;
});

set('shared_dirs', [
    'var/log',
    'config/jwt', // JWT keys live on the server only
]);

set('shared_files', [
    '.env.local',
]);

set('writable_dirs', [
    'var',
    'var/cache',
    'var/log',
    'var/sessions',
]);

set('log_files', 'var/log/*.log');

set('migrations_config', '');

set('doctrine_schema_validate_config', '');

set('bin/console', '{{bin/php}} {{release_or_current_path}}/bin/console');

set('console_options', function () {
    return '--no-interaction';
});

desc('Migrates database');
task('database:migrate', function () {
    $options = '--allow-no-migration';
    if (get('migrations_config') !== '') {
        $options = "$options --configuration={{release_or_current_path}}/{{migrations_config}}";
    }

    run("cd {{release_or_current_path}} && {{bin/console}} doctrine:migrations:migrate $options {{console_options}}");
});

desc('Validate the Doctrine mapping files');
task('doctrine:schema:validate', function () {
    run("cd {{release_or_current_path}} && {{bin/console}} doctrine:schema:validate {{doctrine_schema_validate_config}} {{console_options}}");
});

desc('Clears cache');
task('deploy:cache:clear', function () {
    // composer install scripts usually clear and warmup symfony cache
    // so we only need to do it if composer install was run with --no-scripts
    if (false !== strpos(get('composer_options', ''), '--no-scripts')) {
        run('{{bin/console}} cache:clear {{console_options}}');
    }
});

desc('Optimize environment variables');
task('deploy:dump-env', function () {
    within('{{release_or_current_path}}', function () {
        run('{{bin/composer}} dump-env "${APP_ENV:-prod}"');
    });
});

// ── Build (local) ────────────────────────────────────────────────────────────
// Public URL of the deployment, baked into the frontend as VITE_API_URL
set('app_url', function () {
    $url = getenv('APP_URL');
    return false !== $url && '' !== $url ? rtrim($url, '/') : null;
});

set('build_dir', __DIR__.'/.deploy/build');

set('composer_options', '--prefer-dist --no-progress --no-interaction --no-dev --optimize-autoloader --no-scripts');

set('env', ['APP_ENV' => 'prod', 'APP_DEBUG' => '0']);

desc('Checks out the project into .deploy/build (git archive)');
task('build:checkout', function () {
    $dir = escapeshellarg(get('build_dir'));
    $target = escapeshellarg(get('target'));
    runLocally("rm -rf $dir && mkdir -p $dir");
    runLocally("git archive --format=tar $target | tar -x -C $dir", cwd: __DIR__);
    // Symfony's runtime needs a .env (it is gitignored); real config lives in the shared .env.local
    file_put_contents(get('build_dir').'/backend/.env', "APP_ENV=prod\nAPP_DEBUG=0\n");
})->once();

desc('Builds mail templates and the frontend (into backend/public) in .deploy/build');
task('build:frontend', function () {
    $dir = get('build_dir');
    runLocally('npm ci --ignore-scripts', cwd: $dir, timeout: null);
    runLocally('npm run build:mail -w backend', cwd: $dir);
    runLocally(
        'npm run build -w frontend',
        cwd: $dir,
        timeout: null,
        env: null !== get('app_url') ? ['VITE_API_URL' => get('app_url')] : null,
    );
    foreach (['index.html', '.htaccess', 'index.php'] as $file) {
        if (!is_file("$dir/backend/public/$file")) {
            throw error("backend/public/$file is missing after the build");
        }
    }
})->once();

desc('Builds the project locally');
task('build', ['build:checkout', 'build:frontend']);

// ── Deploy ───────────────────────────────────────────────────────────────────
desc('Uploads the built backend as the new release');
task('deploy:update_code', function () {
    upload(get('build_dir').'/backend/', '{{release_path}}/', [
        'options' => ['--delete', '--exclude=/tests/', '--exclude=/node_modules/', '--exclude=/.php-cs-fixer.*', '--exclude=/phpstan*', '--exclude=/phpunit*'],
    ]);
});

desc('Warms up the cache');
task('deploy:cache:warmup', function () {
    run('{{bin/console}} cache:warmup {{console_options}}');
});

desc('Builds, uploads and sets up the project on the server');
task('deploy', [
    'build',
    'deploy:prepare',
    'deploy:vendors',
    'database:migrate',
    'deploy:cache:clear',
    'deploy:cache:warmup',
    'deploy:publish',
]);
