<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\OAuth\IdTokenSignatureVerifier;
use App\Tests\Helper\TestJwks;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Cache\Adapter\ArrayAdapter;

final class IdTokenSignatureVerifierTest extends TestCase
{
    private const array CLAIMS = ['iss' => 'https://accounts.google.com', 'sub' => 's', 'exp' => 4102444800];

    private int $requests = 0;
    private MockHandler $mock;

    /** @param list<Response|\Throwable> $responses */
    private function verifier(array $responses, ?ArrayAdapter $cache = null): IdTokenSignatureVerifier
    {
        $this->mock = new MockHandler($responses);
        $stack = HandlerStack::create($this->mock);
        $stack->push(function (callable $next): callable {
            return function ($request, array $options) use ($next) {
                ++$this->requests;

                return $next($request, $options);
            };
        });

        return new IdTokenSignatureVerifier(new Client(['handler' => $stack]), $cache ?? new ArrayAdapter(), 'https://keys.example/jwks');
    }

    private static function jwks(?\OpenSSLAsymmetricKey $key = null, string $kid = TestJwks::KID): Response
    {
        return new Response(200, [], json_encode(TestJwks::document($key, $kid), JSON_THROW_ON_ERROR));
    }

    private function assertRejected(IdTokenSignatureVerifier $v, string $token): void
    {
        try {
            $v->verify($token);
            self::fail('Expected rejection');
        } catch (\UnexpectedValueException $e) {
            self::assertStringNotContainsString($token, $e->getMessage());
        }
    }

    public function testValidSignaturePasses(): void
    {
        $this->verifier([self::jwks()])->verify(TestJwks::sign(self::CLAIMS));
        self::assertSame(1, $this->requests);
    }

    public function testKeysAreCached(): void
    {
        $v = $this->verifier([self::jwks()]);
        $v->verify(TestJwks::sign(self::CLAIMS));
        $v->verify(TestJwks::sign(self::CLAIMS));
        self::assertSame(1, $this->requests);
    }

    public function testWrongKeyFails(): void
    {
        $this->assertRejected($this->verifier([self::jwks()]), TestJwks::sign(self::CLAIMS, TestJwks::generate()));
    }

    public function testTamperedPayloadFails(): void
    {
        [$h, , $s] = explode('.', TestJwks::sign(self::CLAIMS));
        $forged = $h.'.'.TestJwks::b64(json_encode(['sub' => 'admin'] + self::CLAIMS)).'.'.$s;
        $this->assertRejected($this->verifier([self::jwks()]), $forged);
    }

    public function testAlgNoneFails(): void
    {
        $token = TestJwks::b64('{"alg":"none","kid":"'.TestJwks::KID.'"}').'.'.TestJwks::b64(json_encode(self::CLAIMS)).'.';
        $this->assertRejected($this->verifier([self::jwks()]), $token);
    }

    public function testHs256WithPublicKeyAsSecretFails(): void
    {
        $header = TestJwks::b64('{"alg":"HS256","kid":"'.TestJwks::KID.'"}');
        $input = $header.'.'.TestJwks::b64(json_encode(self::CLAIMS));
        $token = $input.'.'.TestJwks::b64(hash_hmac('sha256', $input, TestJwks::jwk()['n'], true));
        $this->assertRejected($this->verifier([self::jwks()]), $token);
        self::assertSame(0, $this->requests);
    }

    public function testEmbeddedJwkHeaderIsIgnored(): void
    {
        $attacker = TestJwks::generate();
        $token = TestJwks::sign(self::CLAIMS, $attacker, ['jwk' => TestJwks::jwk($attacker), 'jku' => 'https://evil.example/jwks']);
        $this->assertRejected($this->verifier([self::jwks()]), $token);
        self::assertSame(1, $this->requests);
    }

    public function testJwkWithOtherAlgorithmIsNotUsed(): void
    {
        $doc = TestJwks::document();
        $doc['keys'][0]['alg'] = 'RS512';
        $this->assertRejected($this->verifier([new Response(200, [], json_encode($doc))]), TestJwks::sign(self::CLAIMS));
    }

    public function testUnknownKidRefetchesExactlyOnceAndThrottles(): void
    {
        $old = TestJwks::generate();
        $v = $this->verifier([self::jwks($old, 'old'), self::jwks(null, 'new'), self::jwks(null, 'new')]);
        $v->verify(TestJwks::sign(self::CLAIMS, $old, ['kid' => 'old']));
        self::assertSame(1, $this->requests);

        $v->verify(TestJwks::sign(self::CLAIMS, null, ['kid' => 'new']));
        self::assertSame(2, $this->requests);

        // Forged kids inside the throttle window cause no further fetch
        for ($i = 0; $i < 3; ++$i) {
            $this->assertRejected($v, TestJwks::sign(self::CLAIMS, null, ['kid' => 'forged'.$i]));
        }
        self::assertSame(2, $this->requests);
    }

    public function testUnknownKidOnColdCacheDoesNotFetchTwice(): void
    {
        $this->assertRejected($this->verifier([self::jwks(), self::jwks()]), TestJwks::sign(self::CLAIMS, null, ['kid' => 'nope']));
        self::assertSame(1, $this->requests);
    }

    public function testFetchFailureFails(): void
    {
        $this->assertRejected($this->verifier([new Response(500, [], 'x')]), TestJwks::sign(self::CLAIMS));
        $this->assertRejected($this->verifier([new Response(200, [], 'not json')]), TestJwks::sign(self::CLAIMS));
    }

    public function testMissingKidFails(): void
    {
        $header = TestJwks::b64('{"alg":"RS256"}');
        $this->assertRejected($this->verifier([self::jwks()]), $header.'.'.TestJwks::b64('{}').'.AAAA');
    }

    public function testNonHttpsJwksUriIsRejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new IdTokenSignatureVerifier(new Client(), new ArrayAdapter(), 'http://keys.example/jwks');
    }
}
