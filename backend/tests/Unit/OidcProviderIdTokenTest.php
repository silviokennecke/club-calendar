<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\OAuth\OidcProvider;
use App\Tests\Helper\TestJwks;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use League\OAuth2\Client\Token\AccessToken;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class OidcProviderIdTokenTest extends TestCase
{
    private const string CLIENT = 'client-123';
    private const string NONCE = 'nonce-abc';
    private const string TID = '11111111-2222-3333-4444-555555555555';

    /** @return iterable<string, array{string, array<string, mixed>}> */
    public static function validTokens(): iterable
    {
        yield 'google' => ['https://accounts.google.com', ['iss' => 'https://accounts.google.com']];
        yield 'google without scheme' => ['https://accounts.google.com', ['iss' => 'accounts.google.com']];
        yield 'apple' => ['https://appleid.apple.com', ['iss' => 'https://appleid.apple.com']];
        yield 'microsoft common' => [
            'https://login.microsoftonline.com/common/v2.0',
            ['iss' => 'https://login.microsoftonline.com/'.self::TID.'/v2.0', 'tid' => self::TID],
        ];
        yield 'microsoft fixed tenant' => [
            'https://login.microsoftonline.com/'.self::TID.'/v2.0',
            ['iss' => 'https://login.microsoftonline.com/'.self::TID.'/v2.0', 'tid' => self::TID],
        ];
        yield 'several audiences with azp' => [
            'https://appleid.apple.com',
            ['iss' => 'https://appleid.apple.com', 'aud' => [self::CLIENT, 'other'], 'azp' => self::CLIENT],
        ];
    }

    /** @param array<string, mixed> $overrides */
    #[DataProvider('validTokens')]
    public function testValidToken(string $issuer, array $overrides): void
    {
        $provider = $this->provider($issuer);
        $provider->expectNonce(self::NONCE);
        $owner = $provider->getResourceOwner($this->token($overrides));

        self::assertSame('sub-1', $owner->getId());
        self::assertSame('a@example.com', $owner->getEmail());
    }

    /** @return iterable<string, array{string, array<string, mixed>}> */
    public static function invalidTokens(): iterable
    {
        $g = 'https://accounts.google.com';
        yield 'wrong iss' => [$g, ['iss' => 'https://evil.example']];
        yield 'missing iss' => [$g, ['iss' => null]];
        yield 'wrong aud' => [$g, ['iss' => $g, 'aud' => 'someone-else']];
        yield 'aud list without client' => [$g, ['iss' => $g, 'aud' => ['a', 'b']]];
        yield 'several aud without azp' => [$g, ['iss' => $g, 'aud' => [self::CLIENT, 'other']]];
        yield 'expired' => [$g, ['iss' => $g, 'exp' => time() - 3600]];
        yield 'missing exp' => [$g, ['iss' => $g, 'exp' => null]];
        yield 'iat in the future' => [$g, ['iss' => $g, 'iat' => time() + 3600]];
        yield 'missing sub' => [$g, ['iss' => $g, 'sub' => null]];
        yield 'empty sub' => [$g, ['iss' => $g, 'sub' => '']];
        yield 'microsoft iss for other tid' => [
            'https://login.microsoftonline.com/common/v2.0',
            ['iss' => 'https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0', 'tid' => self::TID],
        ];
        yield 'microsoft missing tid' => [
            'https://login.microsoftonline.com/common/v2.0',
            ['iss' => 'https://login.microsoftonline.com/common/v2.0'],
        ];
        yield 'microsoft fixed tenant, foreign tenant' => [
            'https://login.microsoftonline.com/'.self::TID.'/v2.0',
            ['iss' => 'https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0'],
        ];
    }

    /** @param array<string, mixed> $overrides */
    #[DataProvider('invalidTokens')]
    public function testInvalidTokenIsRejected(string $issuer, array $overrides): void
    {
        $this->expectException(\UnexpectedValueException::class);
        $provider = $this->provider($issuer);
        $provider->expectNonce(self::NONCE);
        $provider->getResourceOwner($this->token($overrides));
    }

    /** @return iterable<string, array{string|null, array<string, mixed>}> */
    public static function nonceCases(): iterable
    {
        yield 'missing claim' => [self::NONCE, ['nonce' => null]];
        yield 'wrong claim' => [self::NONCE, ['nonce' => 'other']];
        yield 'non-string claim' => [self::NONCE, ['nonce' => 123]];
        yield 'nothing expected' => [null, []];
        yield 'empty expected' => ['', ['nonce' => '']];
    }

    /** @param array<string, mixed> $overrides */
    #[DataProvider('nonceCases')]
    public function testNonceIsRequiredAndMustMatch(?string $expected, array $overrides): void
    {
        $provider = $this->provider('https://accounts.google.com');
        if (null !== $expected) {
            $provider->expectNonce($expected);
        }
        $this->expectException(\UnexpectedValueException::class);
        $this->expectExceptionMessage('nonce');
        $provider->getResourceOwner($this->token($overrides));
    }

    public function testExpectedNonceIsSingleUse(): void
    {
        $provider = $this->provider('https://accounts.google.com');
        $provider->expectNonce(self::NONCE);
        $provider->getResourceOwner($this->token([]));
        $this->expectException(\UnexpectedValueException::class);
        $provider->getResourceOwner($this->token([]));
    }

    public function testMissingIdTokenIsRejected(): void
    {
        $this->expectException(\UnexpectedValueException::class);
        $this->provider('https://accounts.google.com')->getResourceOwner(new AccessToken(['access_token' => 'x']));
    }

    public function testErrorMessageDoesNotContainTheToken(): void
    {
        $token = $this->token(['iss' => 'https://evil.example']);
        try {
            $this->provider('https://accounts.google.com')->getResourceOwner($token);
            self::fail('Expected exception');
        } catch (\UnexpectedValueException $e) {
            self::assertStringNotContainsString((string) $token->getValues()['id_token'], $e->getMessage());
        }
    }

    private function provider(string $issuer): OidcProvider
    {
        $mock = new MockHandler([new Response(200, [], json_encode(TestJwks::document(), JSON_THROW_ON_ERROR))]);

        return new OidcProvider(
            ['issuer' => $issuer, 'clientId' => self::CLIENT, 'clientSecret' => 's', 'jwksUri' => 'https://keys.example/jwks'],
            ['httpClient' => new Client(['handler' => HandlerStack::create($mock)])],
        );
    }

    /** @param array<string, mixed> $overrides null removes a claim */
    private function token(array $overrides): AccessToken
    {
        $claims = array_filter(array_merge([
            'iss' => 'https://accounts.google.com',
            'aud' => self::CLIENT,
            'sub' => 'sub-1',
            'email' => 'a@example.com',
            'exp' => time() + 3600,
            'iat' => time(),
            'nonce' => self::NONCE,
        ], $overrides), static fn ($v) => null !== $v);

        return new AccessToken(['access_token' => 'x', 'id_token' => TestJwks::sign($claims)]);
    }
}
