<?php

declare(strict_types=1);

namespace App\Tests\Helper;

use App\Opaque\Base64Url;
use App\Tests\Opaque\OpaqueTestClient;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;

/** Drives the OPAQUE sign-up and password-reset endpoints for tests that only need an account or a new password. */
final class OpaqueApi
{
    /**
     * Full sign-up (start + finish). Returns the answer of finish; a failing start is returned as is.
     *
     * @return array{status: int, body: mixed, content: string, headers: array<string, list<string>>}
     */
    public static function signup(KernelBrowser $client, string $name, string $email, string $password, mixed $acceptedDocuments = [], ?string $language = null): array
    {
        $opaque = new OpaqueTestClient();
        $reg = $opaque->startRegistration($password);
        $start = TestHelper::jsonRequest($client, 'POST', '/api/auth/opaque/register/start', ['email' => $email, 'registrationRequest' => Base64Url::encode($reg['request'])]);
        if (200 !== $start['status']) {
            return $start;
        }
        $record = $opaque->finishRegistration($password, $reg['blind'], (string) Base64Url::decode($start['body']['registrationResponse']))['record'];
        $body = [
            'registrationState' => $start['body']['registrationState'],
            'registrationRecord' => Base64Url::encode($record),
            'name' => $name,
            'acceptedDocuments' => $acceptedDocuments,
        ];
        if (null !== $language) {
            $body['language'] = $language;
        }

        return TestHelper::jsonRequest($client, 'POST', '/api/auth/opaque/register/finish', $body);
    }

    /** @return array{status: int, body: mixed, content: string, headers: array<string, list<string>>} */
    public static function reset(KernelBrowser $client, string $token, string $password): array
    {
        $opaque = new OpaqueTestClient();
        $reg = $opaque->startRegistration($password);
        $start = TestHelper::jsonRequest($client, 'POST', '/api/auth/opaque/register/start', ['resetToken' => $token, 'registrationRequest' => Base64Url::encode($reg['request'])]);
        if (200 !== $start['status']) {
            return $start;
        }
        $record = $opaque->finishRegistration($password, $reg['blind'], (string) Base64Url::decode($start['body']['registrationResponse']))['record'];

        return TestHelper::jsonRequest($client, 'POST', '/api/auth/opaque/register/finish', [
            'resetToken' => $token,
            'registrationState' => $start['body']['registrationState'],
            'registrationRecord' => Base64Url::encode($record),
        ]);
    }

    /**
     * Full OPAQUE login (start + finish). Answers 401 `invalid_credentials` for a wrong password or an account
     * without a record.
     *
     * @return array{status: int, body: mixed, content: string, headers: array<string, list<string>>}
     */
    public static function login(KernelBrowser $client, string $email, string $password): array
    {
        $opaque = new OpaqueTestClient();
        $ke1 = $opaque->startLogin($password);
        $start = TestHelper::jsonRequest($client, 'POST', '/api/auth/opaque/login/start', ['email' => $email, 'startLoginRequest' => Base64Url::encode($ke1['ke1'])]);
        if (200 !== $start['status']) {
            return $start;
        }
        $result = $opaque->finishLogin($password, $ke1, (string) Base64Url::decode($start['body']['loginResponse']));
        // Wrong password: the client cannot derive the keys; send garbage so the server answers its usual 401.
        $ke3 = null === $result ? random_bytes(64) : $result['ke3'];

        return TestHelper::jsonRequest($client, 'POST', '/api/auth/opaque/login/finish', ['loginState' => $start['body']['loginState'], 'finishLoginRequest' => Base64Url::encode($ke3)]);
    }
}
