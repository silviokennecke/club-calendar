<?php

declare(strict_types=1);

namespace Deployer;

require __DIR__.'/deployer_recipe.php';

/*
 * Deployer (https://deployer.org) config.
 *
 *     npm run deploy:build     only build (.deploy/build)
 *     npm run deploy           build, upload, set up on the server
 *
 * Settings come from ./.env (see .env.example) or from real environment
 * variables, so the same file works locally and in a pipeline.
 * The flow itself lives in deployer_recipe.php.
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

// Target server, from .env: DEPLOY_HOST, DEPLOY_USER, DEPLOY_PATH (docroot = <path>/current/public)
// optional: DEPLOY_PORT, DEPLOY_KEY (identity file), DEPLOY_PHP (remote php binary)
foreach (['DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_PATH'] as $required) {
    if (false === getenv($required) || '' === getenv($required)) {
        throw new \RuntimeException("$required is not set (see .env.example)");
    }
}

$host = host(getenv('DEPLOY_HOST'))
    ->setRemoteUser(getenv('DEPLOY_USER'))
    ->setDeployPath(rtrim(getenv('DEPLOY_PATH'), '/'))
    ->set('writable_mode', 'chmod')
    ->set('writable_recursive', true);
if (false !== getenv('DEPLOY_PORT')) {
    $host->setPort(getenv('DEPLOY_PORT'));
}
if (false !== getenv('DEPLOY_KEY')) {
    $host->setIdentityFile(getenv('DEPLOY_KEY'));
}
// Password auth: Deployer shells out to plain ssh/rsync, so feed the password via SSH_ASKPASS
// (OpenSSH >= 8.4). Prefer keys; this is for servers that only offer passwords.
if (false !== getenv('DEPLOY_PASSWORD') && '' !== getenv('DEPLOY_PASSWORD')) {
    $askpass = ROOT.'/.deploy/askpass.sh';
    @mkdir(dirname($askpass), 0700, true);
    file_put_contents($askpass, "#!/bin/sh\nprintf '%s\\n' \"\$DEPLOY_PASSWORD\"\n");
    chmod($askpass, 0700);
    putenv("SSH_ASKPASS=$askpass");
    putenv('SSH_ASKPASS_REQUIRE=force');
    $_SERVER['SSH_ASKPASS'] = getenv('SSH_ASKPASS');
    $_SERVER['SSH_ASKPASS_REQUIRE'] = getenv('SSH_ASKPASS_REQUIRE');
    $_SERVER['DEPLOY_PASSWORD'] = getenv('DEPLOY_PASSWORD');
    $host->setSshArguments(['-o PreferredAuthentications=password,keyboard-interactive', '-o PubkeyAuthentication=no']);
}
if (false !== getenv('DEPLOY_PHP')) {
    $host->set('bin/php', getenv('DEPLOY_PHP'));
}
