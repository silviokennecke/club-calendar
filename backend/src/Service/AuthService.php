<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\OAuthAccount;
use App\Entity\User;
use App\Exception\EmailNotVerifiedException;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Exception\ORMException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\UnauthorizedHttpException;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

readonly class AuthService
{
    public function __construct(
        private EntityManagerInterface $em,
        private UserPasswordHasherInterface $hasher,
        private TokenService $tokens,
        private EmailVerificationMailer $verificationMailer,
    ) {
    }

    public function register(string $name, string $email, string $password, ?string $language = null): void
    {
        $existing = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if ($existing) {
            throw new BadRequestHttpException('Email already in use');
        }
        $user = new User();
        $user->setName($name);
        $user->setEmail($email);
        $user->setPassword($this->hasher->hashPassword($user, $password));
        if (null !== $language && '' !== $language) {
            $user->setLanguage($language);
        }
        $this->em->persist($user);
        $this->em->flush();
        $this->verificationMailer->send($user);
    }

    public function login(string $email, string $password): array
    {
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if (!$user || !$user->getPassword()) {
            throw new UnauthorizedHttpException('Bearer', 'Invalid credentials');
        }
        if (!$this->hasher->isPasswordValid($user, $password)) {
            throw new UnauthorizedHttpException('Bearer', 'Invalid credentials');
        }
        if (!$user->isEmailVerified()) {
            throw new EmailNotVerifiedException();
        }

        return $this->tokens->tokenResponse($user);
    }

    public function sendVerificationEmail(User $user): void
    {
        $this->verificationMailer->send($user);
    }

    public function refresh(string $refreshToken): array
    {
        try {
            $payload = $this->tokens->decodeRefreshToken($refreshToken);
        } catch (\InvalidArgumentException $e) {
            throw new UnauthorizedHttpException('Bearer', $e->getMessage());
        }
        $user = $this->em->getRepository(User::class)->find($payload['sub']);
        if (!$user) {
            throw new UnauthorizedHttpException('Bearer', 'User not found');
        }

        return $this->tokens->tokenResponse($user);
    }

    public function getMe(User $user): array
    {
        // Reload with relations (ignore if entity is detached)
        try {
            $this->em->refresh($user);
        } catch (ORMException) {
            // entity already managed or detached; continue with current state
        }

        return [
            'id' => $user->getId(),
            'name' => $user->getName(),
            'email' => $user->getEmail(),
            'dateFormat' => $user->getDateFormat(),
            'firstDayOfWeek' => $user->getFirstDayOfWeek(),
            'lastClubId' => $user->getLastClubId(),
            'lastCalendarId' => $user->getLastCalendarId(),
            'language' => $user->getLanguage(),
            'passkeys' => $user->getPasskeys()->map(fn ($p) => [
                'id' => $p->getId(),
                'deviceName' => $p->getDeviceName(),
                'createdAt' => $p->getCreatedAt()->format(\DateTimeInterface::ATOM),
            ])->toArray(),
            'oauthAccounts' => $user->getOauthAccounts()->map(fn ($a) => [
                'provider' => $a->getProvider(),
            ])->toArray(),
        ];
    }

    public function updateMe(User $user, array $data): array
    {
        if (array_key_exists('dateFormat', $data)) {
            $user->setDateFormat($data['dateFormat']);
        }
        if (array_key_exists('firstDayOfWeek', $data)) {
            $user->setFirstDayOfWeek($data['firstDayOfWeek']);
        }
        if (array_key_exists('language', $data)) {
            $user->setLanguage($data['language']);
        }
        if (array_key_exists('lastClubId', $data)) {
            $user->setLastClubId($data['lastClubId']);
        }
        if (array_key_exists('lastCalendarId', $data)) {
            $user->setLastCalendarId($data['lastCalendarId']);
        }
        $this->em->flush();

        return [
            'id' => $user->getId(),
            'name' => $user->getName(),
            'email' => $user->getEmail(),
            'dateFormat' => $user->getDateFormat(),
            'firstDayOfWeek' => $user->getFirstDayOfWeek(),
            'language' => $user->getLanguage(),
            'lastClubId' => $user->getLastClubId(),
            'lastCalendarId' => $user->getLastCalendarId(),
        ];
    }

    public function deleteMe(User $user): void
    {
        $this->em->remove($user);
        $this->em->flush();
    }

    public function findOrCreateOAuthUser(string $provider, string $providerId, string $email, string $name): array
    {
        $existing = $this->em->getRepository(OAuthAccount::class)->findOneBy([
            'provider' => $provider,
            'providerId' => $providerId,
        ]);
        if ($existing) {
            $oauthUser = $existing->getUser();
            // Only remove orphaned accounts (where getUser() is null)
            if (null === $oauthUser) {
                $this->em->remove($existing);
                $this->em->flush();
            } else {
                // Valid OAuth account found, return tokens for the associated user
                return $this->tokens->tokenResponse($oauthUser);
            }
        }
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if (!$user) {
            $user = new User();
            $user->setName($name);
            $user->setEmail($email);
            $user->setIsEmailVerified(true);
            $this->em->persist($user);
        }
        $account = new OAuthAccount();
        $account->setUser($user);
        $account->setProvider($provider);
        $account->setProviderId($providerId);
        $account->setEmail($email);
        $this->em->persist($account);
        $this->em->flush();

        return $this->tokens->tokenResponse($user);
    }
}
