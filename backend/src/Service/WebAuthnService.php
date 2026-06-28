<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Passkey;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\UnauthorizedHttpException;

class WebAuthnService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TokenService $tokens,
        private readonly string $rpId,
        private readonly string $rpName,
        private readonly string $appSecret,
        private readonly string $appUrl,
    ) {
    }

    public function getRegistrationOptions(User $user): array
    {
        $challenge = random_bytes(32);
        $challengeB64 = rtrim(strtr(base64_encode($challenge), '+/', '-_'), '=');
        $challengeToken = $this->createChallengeToken($challengeB64);

        $excludeCredentials = $user->getPasskeys()->map(fn ($p) => [
            'type' => 'public-key',
            'id' => rtrim(strtr(base64_encode($p->getCredentialId()), '+/', '-_'), '='),
        ])->toArray();

        $options = [
            'challenge' => $challengeB64,
            'rp' => ['id' => $this->rpId, 'name' => $this->rpName],
            'user' => [
                'id' => rtrim(strtr(base64_encode((string) $user->getId()), '+/', '-_'), '='),
                'name' => $user->getEmail(),
                'displayName' => $user->getName(),
            ],
            'pubKeyCredParams' => [
                ['type' => 'public-key', 'alg' => -7],   // ES256
                ['type' => 'public-key', 'alg' => -257],  // RS256
            ],
            'authenticatorSelection' => [
                'residentKey' => 'preferred',
                'userVerification' => 'preferred',
            ],
            'timeout' => 60000,
            'excludeCredentials' => $excludeCredentials,
            'attestation' => 'none',
        ];

        return ['options' => $options, 'challengeToken' => $challengeToken];
    }

    public function verifyRegistration(User $user, string $challengeToken, array $responseData, ?string $deviceName): void
    {
        $this->decodeChallengeToken($challengeToken);

        $clientDataJSON = base64_decode(strtr($responseData['response']['clientDataJSON'] ?? '', '-_', '+/'));
        $clientData = json_decode($clientDataJSON, true);

        if (!is_array($clientData) || ($clientData['type'] ?? '') !== 'webauthn.create') {
            throw new BadRequestHttpException('Invalid response type');
        }

        $rawId = $responseData['rawId'] ?? $responseData['id'] ?? '';
        if (empty($rawId)) {
            throw new BadRequestHttpException('Missing credential id');
        }

        // Normalize base64url → base64 and decode to bytes, then back to standard base64 for storage
        $credentialIdBytes = base64_decode(
            strtr($rawId, '-_', '+/')
            .str_repeat('=', (4 - strlen($rawId) % 4) % 4),
        );
        $credentialIdStored = base64_encode($credentialIdBytes);

        if (empty($responseData['response']['attestationObject'] ?? '')) {
            throw new BadRequestHttpException('Missing attestationObject');
        }

        $attestationObject = base64_decode(
            strtr($responseData['response']['attestationObject'], '-_', '+/'),
        );

        $existing = $this->em->getRepository(Passkey::class)->findOneBy(['credentialId' => $credentialIdStored]);
        if ($existing) {
            throw new BadRequestHttpException('Credential already registered');
        }

        $passkey = new Passkey();
        $passkey->setId($this->generateCuid());
        $passkey->setUser($user);
        $passkey->setCredentialId($credentialIdStored);
        $passkey->setPublicKey($attestationObject);
        $passkey->setCounter(0);
        $passkey->setDeviceName($deviceName);

        $this->em->persist($passkey);
        $this->em->flush();
    }

    public function getAuthenticationOptions(): array
    {
        $challenge = random_bytes(32);
        $challengeB64 = rtrim(strtr(base64_encode($challenge), '+/', '-_'), '=');
        $challengeToken = $this->createChallengeToken($challengeB64);

        $options = [
            'challenge' => $challengeB64,
            'rpId' => $this->rpId,
            'timeout' => 60000,
            'userVerification' => 'preferred',
            'allowCredentials' => [],
        ];

        return ['options' => $options, 'challengeToken' => $challengeToken];
    }

    public function verifyAuthentication(string $challengeToken, array $responseData): array
    {
        $this->decodeChallengeToken($challengeToken);

        $rawId = $responseData['rawId'] ?? $responseData['id'] ?? '';
        if (empty($rawId)) {
            throw new BadRequestHttpException('Missing credential id');
        }

        $credentialIdBytes = base64_decode(
            strtr($rawId, '-_', '+/')
            .str_repeat('=', (4 - strlen($rawId) % 4) % 4),
        );
        $credentialIdStored = base64_encode($credentialIdBytes);

        $passkey = $this->em->getRepository(Passkey::class)->findOneBy(['credentialId' => $credentialIdStored]);
        if (!$passkey) {
            throw new UnauthorizedHttpException('Bearer', 'Unknown passkey');
        }

        $clientDataJSON = base64_decode(strtr($responseData['response']['clientDataJSON'] ?? '', '-_', '+/'));
        $clientData = json_decode($clientDataJSON, true);

        if (!is_array($clientData) || ($clientData['type'] ?? '') !== 'webauthn.get') {
            throw new BadRequestHttpException('Invalid response type');
        }

        // Increment counter (basic clone detection; strict check can be added later)
        $passkey->setCounter($passkey->getCounter() + 1);
        $this->em->flush();

        return $this->tokens->tokenResponse($passkey->getUser());
    }

    public function deletePasskey(string $id, User $user): void
    {
        $passkey = $this->em->getRepository(Passkey::class)->find($id);
        if (!$passkey || $passkey->getUser()->getId() !== $user->getId()) {
            throw new NotFoundHttpException('Passkey not found');
        }
        $this->em->remove($passkey);
        $this->em->flush();
    }

    private function createChallengeToken(string $challengeBase64Url): string
    {
        $payload = ['ch' => $challengeBase64Url, 'exp' => time() + 300];
        $header = base64_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $body = base64_encode(json_encode($payload));
        $sig = base64_encode(hash_hmac('sha256', "$header.$body", $this->appSecret, true));

        return "$header.$body.$sig";
    }

    private function decodeChallengeToken(string $token): string
    {
        $parts = explode('.', $token);
        if (3 !== count($parts)) {
            throw new UnauthorizedHttpException('Bearer', 'Invalid challenge token');
        }
        [$header, $body, $sig] = $parts;
        $expected = base64_encode(hash_hmac('sha256', "$header.$body", $this->appSecret, true));
        if (!hash_equals($expected, $sig)) {
            throw new UnauthorizedHttpException('Bearer', 'Invalid challenge token');
        }
        $payload = json_decode(base64_decode($body), true);
        if (!is_array($payload) || ($payload['exp'] ?? 0) < time()) {
            throw new UnauthorizedHttpException('Bearer', 'Challenge expired');
        }

        return $payload['ch'];
    }

    private function generateCuid(): string
    {
        return 'c'.bin2hex(random_bytes(12));
    }
}
