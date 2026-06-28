<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\EmailVerification;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Random\RandomException;

readonly class EmailVerificationService
{
    public function __construct(
        private EntityManagerInterface $em,
    ) {
    }

    /**
     * Invalidates all prior tokens for this user, creates a new one, and returns
     * the EmailVerification entity plus the raw (unhashed) verifier string.
     *
     * @return array{EmailVerification, string}
     *
     * @throws RandomException
     */
    public function createVerification(User $user): array
    {
        $this->em->createQueryBuilder()
            ->update(EmailVerification::class, 'ev')
            ->set('ev.invalidatedAt', ':now')
            ->where('ev.user = :user')
            ->andWhere('ev.invalidatedAt IS NULL')
            ->setParameter('now', new \DateTimeImmutable())
            ->setParameter('user', $user)
            ->getQuery()
            ->execute();

        $rawVerifier = bin2hex(random_bytes(32));
        $ev = new EmailVerification();
        $ev->setUser($user);
        $ev->setTokenHash(password_hash($rawVerifier, PASSWORD_BCRYPT));
        $this->em->persist($ev);
        $this->em->flush();

        return [$ev, $rawVerifier];
    }

    /**
     * Verifies a split-token. Returns 'success', 'invalid', 'expired', or 'already_used'.
     */
    public function verify(string $id, string $rawVerifier): string
    {
        $ev = $this->em->getRepository(EmailVerification::class)->find($id);
        if (!$ev) {
            return 'invalid';
        }
        if (!password_verify($rawVerifier, $ev->getTokenHash())) {
            return 'invalid';
        }
        if (null !== $ev->getInvalidatedAt()) {
            return 'invalid';
        }
        if ($ev->getExpiresAt() < new \DateTimeImmutable()) {
            return 'expired';
        }
        if (null !== $ev->getUsedAt()) {
            return 'already_used';
        }

        $ev->setUsedAt(new \DateTimeImmutable());
        $user = $ev->getUser();
        $user->setIsEmailVerified(true);
        $this->em->flush();

        return 'success';
    }
}
