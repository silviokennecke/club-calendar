<?php

declare(strict_types=1);

// Test-only OPAQUE server harness for the serenity interop test (frontend/scripts/opaque/interop.mjs).
// Line-delimited JSON over stdin/stdout; binary values are unpadded base64url. Not shipped, not a Symfony command.

use App\Opaque\OpaqueServer;
use App\Opaque\RegistrationRecord;
use App\Opaque\ServerLoginState;

require dirname(__DIR__, 3).'/vendor/autoload.php';

$dec = static fn (string $s): string => (string) base64_decode(strtr($s, '-_', '+/'), true);
$enc = static fn (string $b): string => rtrim(strtr(base64_encode($b), '+/', '-_'), '=');
$server = null;

while (false !== ($line = fgets(STDIN))) {
    $m = json_decode($line, true, flags: JSON_THROW_ON_ERROR);
    try {
        $reply = match ($m['op']) {
            'init' => (static function () use (&$server, $m, $dec, $enc): array {
                $server = new OpaqueServer($dec($m['serverPrivateKey']), $dec($m['oprfSeed']), '', $m['serverIdentity'] ?? null);

                return ['serverPublicKey' => $enc($server->serverPublicKey())];
            })(),
            'register' => ['response' => $enc($server->createRegistrationResponse($dec($m['request']), $m['id']))],
            'login-start' => (static function () use ($server, $m, $dec, $enc): array {
                $start = null === ($m['record'] ?? null)
                    ? $server->generateFakeKE2($dec($m['ke1']), 'fake:'.$m['id'], $m['clientIdentity'] ?? null)
                    : $server->generateKE2($dec($m['ke1']), RegistrationRecord::fromBytes($dec($m['record'])), $m['id'], $m['clientIdentity'] ?? null);

                return ['ke2' => $enc($start->ke2), 'state' => $enc($start->state->toBytes())];
            })(),
            'login-finish' => ['sessionKey' => $enc($server->serverFinish(ServerLoginState::fromBytes($dec($m['state'])), $dec($m['ke3'])))],
            default => throw new RuntimeException('unknown op'),
        };
        $out = ['ok' => true] + $reply;
    } catch (Throwable $e) {
        $out = ['ok' => false, 'error' => (new ReflectionClass($e))->getShortName()];
    }
    fwrite(STDOUT, json_encode($out, JSON_THROW_ON_ERROR)."\n");
}
