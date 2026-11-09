<?php

declare(strict_types=1);

namespace App\Opaque;

/**
 * OPAQUE-3DH server (RFC 9807), suite ristretto255-SHA512, internal envelope mode, identity key stretching on the
 * client side only. Pure computation: no storage, no I/O. Identities default to the static public keys.
 *
 * Fake path (§6.4.2 / §10.9): for an unknown account or one without a record, {@see generateFakeKE2()} answers with a
 * record whose masking key is fresh random per call, whose envelope is zero and whose client public key is a fixed
 * group element hashed from the OPRF seed, so nobody (not even a seed holder) knows its discrete log. The returned
 * state additionally expects a random client MAC, so no KE3 can ever verify. The caller passes a stable fake
 * credential identifier ("fake:" || e-mail) so the OPRF output stays constant per address, like for real accounts.
 */
final class OpaqueServer
{
    private const string KEYPAIR_INFO = 'OPAQUE-DeriveDiffieHellmanKeyPair';
    private const string FAKE_PK_DST = 'ClubCalendar-FakeClientPublicKey-HashToGroup';

    private string $serverPublicKey;
    private string $dummyClientPublicKey;

    /** @param RandomSource $random @internal test injection only; production uses the default */
    public function __construct(
        #[\SensitiveParameter] private string $serverPrivateKey,
        #[\SensitiveParameter] private string $oprfSeed,
        private string $context = '',
        private ?string $serverIdentity = null,
        private RandomSource $random = new SystemRandom(),
    ) {
        if (OpaqueKeys::SEED_LENGTH !== strlen($oprfSeed) || strlen($context) > 65535) {
            throw new OpaqueException('Invalid OPAQUE server configuration.');
        }
        if (null !== $serverIdentity && strlen($serverIdentity) > 65535) {
            throw new OpaqueException('Server identity too long.');
        }
        Ristretto::assertScalar($serverPrivateKey);
        $this->serverPublicKey = Ristretto::baseMult($serverPrivateKey);

        $fakeInput = Hkdf::expand($oprfSeed, 'ClubCalendar-FakeClientPublicKey', 64);
        $this->dummyClientPublicKey = Oprf::hashToGroup($fakeInput, self::FAKE_PK_DST);
        sodium_memzero($fakeInput);
    }

    public static function fromKeys(OpaqueKeys $keys, string $context = '', ?string $serverIdentity = null, RandomSource $random = new SystemRandom()): self
    {
        return new self($keys->serverPrivateKey(), $keys->oprfSeed(), $context, $serverIdentity, $random);
    }

    public function serverPublicKey(): string
    {
        return $this->serverPublicKey;
    }

    public function dummyClientPublicKey(): string
    {
        return $this->dummyClientPublicKey;
    }

    /** RFC 9807 §5.2.1: per-credential OPRF key from the seed. */
    public static function deriveOprfKey(#[\SensitiveParameter] string $oprfSeed, string $credentialIdentifier): string
    {
        if ('' === $credentialIdentifier) {
            throw new OpaqueException('Empty credential identifier.');
        }
        $seed = Hkdf::expand($oprfSeed, $credentialIdentifier.'OprfKey', 32);
        [$oprfKey] = Oprf::deriveKeyPair($seed, 'OPAQUE-DeriveKeyPair');
        sodium_memzero($seed);

        return $oprfKey;
    }

    /** RFC 9807 §5.2.1 CreateRegistrationResponse: evaluated_element (32) | server_public_key (32). */
    public function createRegistrationResponse(string $request, string $credentialIdentifier): string
    {
        $evaluated = $this->evaluate($request, $credentialIdentifier);

        return $evaluated.$this->serverPublicKey;
    }

    /** RFC 9807 §6.4.3 GenerateKE2 for an existing record. */
    public function generateKE2(string $ke1, RegistrationRecord $record, string $credentialIdentifier, ?string $clientIdentity = null): LoginStart
    {
        return $this->respond($ke1, $record, $credentialIdentifier, $clientIdentity, false);
    }

    private function respond(string $ke1, RegistrationRecord $record, string $credentialIdentifier, ?string $clientIdentity, bool $fake): LoginStart
    {
        $parsed = Ke1::fromBytes($ke1);
        $evaluated = $this->evaluate($parsed->blindedElement, $credentialIdentifier);

        // §6.4.2 CreateCredentialResponse
        $maskingNonce = $this->randomBytes(32);
        $pad = Hkdf::expand($record->maskingKey(), $maskingNonce.'CredentialResponsePad', 128);
        $masked = Bytes::xor($pad, $this->serverPublicKey.$record->envelope);
        sodium_memzero($pad);
        $credentialResponse = $evaluated.$maskingNonce.$masked;

        // §6.4.3 AuthServerRespond
        $serverNonce = $this->randomBytes(32);
        $keyshareSeed = $this->randomBytes(32);
        [$esk, $epk] = Oprf::deriveKeyPair($keyshareSeed, self::KEYPAIR_INFO);
        sodium_memzero($keyshareSeed);

        $ikm = Ristretto::mult($esk, $parsed->clientKeyshare)
            .Ristretto::mult($this->serverPrivateKey, $parsed->clientKeyshare)
            .Ristretto::mult($esk, $record->clientPublicKey);
        sodium_memzero($esk);

        $preamble = KeySchedule::preamble(
            $this->context,
            $clientIdentity ?? $record->clientPublicKey,
            $parsed->bytes,
            $this->serverIdentity ?? $this->serverPublicKey,
            $credentialResponse,
            $serverNonce,
            $epk,
        );
        $keys = KeySchedule::deriveKeys($ikm, $preamble);
        sodium_memzero($ikm);

        $serverMac = KeySchedule::serverMac($keys);
        $expectedClientMac = $fake ? $this->randomBytes(Mac::LENGTH) : KeySchedule::clientMac($keys, $preamble, $serverMac);
        $state = new ServerLoginState($keys->sessionKey(), $expectedClientMac);

        return new LoginStart($credentialResponse.$serverNonce.$epk.$serverMac, $state);
    }

    /** Same as {@see generateKE2()} with a fake record; the state expects a random client MAC, so no KE3 verifies. */
    public function generateFakeKE2(string $ke1, string $fakeCredentialIdentifier, ?string $clientIdentity = null): LoginStart
    {
        $record = RegistrationRecord::fake($this->dummyClientPublicKey, $this->randomBytes(RegistrationRecord::MASKING_KEY_LENGTH));

        return $this->respond($ke1, $record, $fakeCredentialIdentifier, $clientIdentity, true);
    }

    /** RFC 9807 §6.4.3 ServerFinish: returns the session key or throws; the caller must discard the state (single use). */
    public function serverFinish(ServerLoginState $state, string $ke3): string
    {
        if (Mac::LENGTH !== strlen($ke3)) {
            throw new InvalidMessageException('KE3 must be 64 bytes.');
        }
        if (!hash_equals($state->expectedClientMac(), $ke3)) {
            throw new AuthenticationFailedException('Client MAC mismatch.');
        }

        return $state->sessionKey();
    }

    /** @return array<string, never> */
    public function __debugInfo(): array
    {
        return [];
    }

    /** @return never */
    public function __serialize(): array
    {
        throw new \LogicException('OpaqueServer must not be serialized.');
    }

    public function __unserialize(array $data): void
    {
        throw new \LogicException('OpaqueServer must not be unserialized.');
    }

    private function evaluate(string $blinded, string $credentialIdentifier): string
    {
        try {
            Ristretto::assertElement($blinded);
        } catch (OpaqueException $e) {
            throw new InvalidMessageException('Invalid blinded element.', 0, $e);
        }
        $oprfKey = self::deriveOprfKey($this->oprfSeed, $credentialIdentifier);
        $evaluated = Oprf::blindEvaluate($oprfKey, $blinded);
        sodium_memzero($oprfKey);

        return $evaluated;
    }

    private function randomBytes(int $length): string
    {
        $bytes = $this->random->bytes($length);
        if (strlen($bytes) !== $length) {
            throw new OpaqueException('Random source returned the wrong length.');
        }

        return $bytes;
    }
}
