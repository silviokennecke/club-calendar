<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Club;
use App\Entity\ClubInvitation;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Security\AuthRateLimiter;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;

/**
 * Club invitations (security audit M8). Nobody is added to a club without consent, and inviting reveals
 * nothing about accounts:
 *
 * - {@see invite()} accepts any address and answers the same for unknown, registered and already-member
 *   addresses (the caller always answers 204). Only the mail goes out after the response; no lookup of the
 *   address in the user table decides anything the inviter can observe.
 * - An invitation is valid for 7 days. Expired ones stay listed to the club and can be re-sent only after
 *   the expiry (new token, new 7 days); until then 422 `invitation_not_expired`.
 * - The token is 32 random bytes (hex), stored as SHA-256 hash; it only identifies an invitation. To see,
 *   accept or decline one the signed-in user needs a VERIFIED address equal to the invited one, otherwise the
 *   answer is the generic 404 `invitation_not_found` (a stolen token is useless to another account).
 * - Accepting runs in a transaction under the club row lock (like removing a member): the invitation is
 *   claimed once, the member quota is respected, the membership is created.
 */
readonly class ClubInvitationService
{
    public const string NOT_FOUND_CODE = 'invitation_not_found';
    public const string EXPIRED_CODE = 'invitation_expired';
    public const string NOT_EXPIRED_CODE = 'invitation_not_expired';

    /** Days after which finished (accepted, declined) and long expired invitations are deleted. */
    public const int PRUNE_AFTER_DAYS = 30;

    public function __construct(
        private EntityManagerInterface $em,
        private Quota $quota,
        private ClockInterface $clock,
        private ClubInvitationMailer $mailer,
        private DeferredMailer $deferred,
        private AuthRateLimiter $limiter,
    ) {
    }

    /**
     * Invites an address. Idempotent: an open invitation of the club for the address is kept (no second mail);
     * an expired one is renewed and mailed again; an address that already is a member is ignored silently.
     *
     * @throws ApiProblemException 422 `quota_exceeded` (the club's open invitations; independent of the address)
     */
    public function invite(Club $club, User $inviter, string $email): void
    {
        $email = AuthRateLimiter::normalize($email);
        $now = $this->now();

        /** @var array{0: ClubInvitation, 1: string}|null $created */
        $created = $this->em->wrapInTransaction(function () use ($club, $inviter, $email, $now): ?array {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
            $this->quota->assertRoom(Quota::PENDING_INVITATIONS_PER_CLUB, $club);
            if ($this->isMember($club, $email)) {
                return null;
            }
            $open = $this->em->getRepository(ClubInvitation::class)->findOneBy([
                'club' => $club, 'email' => $email, 'status' => ClubInvitation::PENDING,
            ]);
            $token = self::newToken();
            if (null === $open) {
                $open = new ClubInvitation($club, $inviter, $email, PasswordResetService::hash($token), $now);
                $this->em->persist($open);
            } elseif ($open->isExpired($now)) {
                $open->renew($inviter, PasswordResetService::hash($token), $now);
            } else {
                return null;
            }
            $this->em->flush();

            return [$open, $token];
        });

        if (null !== $created) {
            $this->queueMail($created[0], $created[1]);
        }
    }

    /**
     * Open and expired invitations of the club, newest first.
     *
     * @return list<array{id: string, email: string, status: string, invitedByName: ?string, createdAt: string, expiresAt: string}>
     */
    public function listForClub(Club $club): array
    {
        $now = $this->now();
        /** @var list<ClubInvitation> $rows */
        $rows = $this->em->createQueryBuilder()
            ->select('i', 'u')
            ->from(ClubInvitation::class, 'i')
            ->leftJoin('i.invitedBy', 'u')
            ->where('i.club = :club')
            ->andWhere('i.status = :pending')
            ->orderBy('i.createdAt', 'DESC')
            ->addOrderBy('i.id', 'DESC')
            ->setParameter('club', $club)
            ->setParameter('pending', ClubInvitation::PENDING)
            ->getQuery()
            ->getResult();

        return array_map(fn (ClubInvitation $i) => [
            'id' => $i->getId(),
            'email' => $i->getEmail(),
            'status' => $i->isExpired($now) ? 'expired' : 'pending',
            'invitedByName' => $i->getInvitedBy()?->getName(),
            'createdAt' => self::iso($i->getCreatedAt()),
            'expiresAt' => self::iso($i->getExpiresAt()),
        ], $rows);
    }

    /**
     * Re-send of an EXPIRED invitation: new token, new 7 days, new mail.
     *
     * @throws ApiProblemException 404 `invitation_not_found` (also accepted/declined ones), 422 `invitation_not_expired`
     */
    public function resend(Club $club, User $by, string $invitationId): void
    {
        $now = $this->now();
        /** @var array{0: ClubInvitation, 1: string} $renewed */
        $renewed = $this->em->wrapInTransaction(function () use ($club, $by, $invitationId, $now): array {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
            $invitation = $this->findOpenOfClub($club, $invitationId);
            if (!$invitation->isExpired($now)) {
                throw new ApiProblemException(422, 'The invitation is still valid and can be re-sent after it expired', self::NOT_EXPIRED_CODE);
            }
            $token = self::newToken();
            $invitation->renew($by, PasswordResetService::hash($token), $now);
            $this->em->flush();

            return [$invitation, $token];
        });
        $this->queueMail($renewed[0], $renewed[1]);
    }

    /** @throws ApiProblemException 404 `invitation_not_found` (also accepted/declined ones) */
    public function revoke(Club $club, string $invitationId): void
    {
        $this->em->remove($this->findOpenOfClub($club, $invitationId));
        $this->em->flush();
    }

    /**
     * The open, not expired invitations for the verified address of the user. An unverified user sees none.
     *
     * @return list<array{id: string, clubName: string, invitedByName: ?string, expiresAt: string}>
     */
    public function listForUser(User $user): array
    {
        if (!$user->isEmailVerified()) {
            return [];
        }
        /** @var list<ClubInvitation> $rows */
        $rows = $this->em->createQueryBuilder()
            ->select('i', 'c', 'u')
            ->from(ClubInvitation::class, 'i')
            ->join('i.club', 'c')
            ->leftJoin('i.invitedBy', 'u')
            ->where('i.email = :email')
            ->andWhere('i.status = :pending')
            ->andWhere('i.expiresAt > :now')
            ->orderBy('i.createdAt', 'DESC')
            ->addOrderBy('i.id', 'DESC')
            ->setParameter('email', AuthRateLimiter::normalize($user->getEmail()))
            ->setParameter('pending', ClubInvitation::PENDING)
            ->setParameter('now', $this->now())
            ->getQuery()
            ->getResult();

        return array_map(fn (ClubInvitation $i) => [
            'id' => $i->getId(),
            'clubName' => $i->getClub()->getName(),
            'invitedByName' => $i->getInvitedBy()?->getName(),
            'expiresAt' => self::iso($i->getExpiresAt()),
        ], $rows);
    }

    /**
     * Accepts an invitation, identified by its id or by the token from the mail. Returns the joined club.
     *
     * @return array{id: string, name: string, timezone: string}
     *
     * @throws ApiProblemException 404 `invitation_not_found` (unknown, not for this verified address, already
     *                             answered), 422 `invitation_expired`, 422 `quota_exceeded` (members)
     */
    public function accept(User $user, ?string $id, ?string $token): array
    {
        $invitation = $this->findForUser($user, $id, $token);
        $club = $invitation->getClub();

        return $this->em->wrapInTransaction(function () use ($user, $invitation, $club): array {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
            $this->em->refresh($invitation); // claimed by a parallel request in the meantime?
            $this->assertAnswerable($user, $invitation);
            if (null === $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $user])) {
                $this->quota->assertRoom(Quota::MEMBERS_PER_CLUB, $club);
                $this->em->persist((new ClubUser())->setClub($club)->setUser($user));
            }
            $invitation->resolve(ClubInvitation::ACCEPTED, $this->now());
            $this->em->flush();

            return ['id' => $club->getId(), 'name' => $club->getName(), 'timezone' => $club->getTimezone()];
        });
    }

    /**
     * Declines an invitation (same identification and errors as {@see accept()}, without the quota).
     */
    public function decline(User $user, ?string $id, ?string $token): void
    {
        $invitation = $this->findForUser($user, $id, $token);
        $this->em->wrapInTransaction(function () use ($user, $invitation): void {
            $this->em->lock($invitation->getClub(), LockMode::PESSIMISTIC_WRITE);
            $this->em->refresh($invitation);
            $this->assertAnswerable($user, $invitation);
            $invitation->resolve(ClubInvitation::DECLINED, $this->now());
            $this->em->flush();
        });
    }

    /** Deletes accepted/declined invitations answered, and open ones expired, more than 30 days ago. */
    public function pruneOld(): int
    {
        $limit = $this->now()->modify('-'.self::PRUNE_AFTER_DAYS.' days')->format('Y-m-d H:i:s');

        return (int) $this->em->getConnection()->executeStatement(
            "DELETE FROM club_invitation WHERE (status = 'pending' AND expires_at < ?) OR (status <> 'pending' AND resolved_at < ?)",
            [$limit, $limit],
        );
    }

    /** The invitation for this signed-in, verified user; every other case is the same generic 404. */
    private function findForUser(User $user, ?string $id, ?string $token): ClubInvitation
    {
        $invitation = null;
        if (null !== $token && '' !== $token) {
            $hash = PasswordResetService::hash($token);
            $invitation = $this->em->getRepository(ClubInvitation::class)->findOneBy(['tokenHash' => $hash]);
            if (null !== $invitation && !hash_equals($invitation->getTokenHash(), $hash)) {
                $invitation = null;
            }
        } elseif (null !== $id && '' !== $id) {
            $invitation = $this->em->getRepository(ClubInvitation::class)->find($id);
        }
        if (null === $invitation || !self::isFor($user, $invitation) || ClubInvitation::PENDING !== $invitation->getStatus()) {
            throw self::notFound();
        }
        if ($invitation->isExpired($this->now())) {
            throw new ApiProblemException(422, 'The invitation has expired; ask the club to send it again', self::EXPIRED_CODE);
        }

        return $invitation;
    }

    /** Re-check under the lock (state may have changed since the lookup). */
    private function assertAnswerable(User $user, ClubInvitation $invitation): void
    {
        if (ClubInvitation::PENDING !== $invitation->getStatus() || !self::isFor($user, $invitation)) {
            throw self::notFound();
        }
        if ($invitation->isExpired($this->now())) {
            throw new ApiProblemException(422, 'The invitation has expired; ask the club to send it again', self::EXPIRED_CODE);
        }
    }

    private static function isFor(User $user, ClubInvitation $invitation): bool
    {
        return $user->isEmailVerified() && AuthRateLimiter::normalize($user->getEmail()) === $invitation->getEmail();
    }

    private function findOpenOfClub(Club $club, string $id): ClubInvitation
    {
        $invitation = $this->em->getRepository(ClubInvitation::class)->findOneBy([
            'id' => $id, 'club' => $club, 'status' => ClubInvitation::PENDING,
        ]);
        if (null === $invitation) {
            throw self::notFound();
        }

        return $invitation;
    }

    private function isMember(Club $club, string $email): bool
    {
        return (int) $this->em->createQuery('SELECT COUNT(cu.user) FROM '.ClubUser::class.' cu JOIN cu.user u WHERE cu.club = :club AND u.email = :email')
            ->setParameter('club', $club)
            ->setParameter('email', $email)
            ->getSingleScalarResult() > 0;
    }

    /** The mail goes out after the response, and not at all above the per-address limit (answer unchanged). */
    private function queueMail(ClubInvitation $invitation, string $token): void
    {
        $this->deferred->defer(function () use ($invitation, $token): void {
            if ($this->limiter->allowInvitationMail($invitation->getEmail())) {
                $this->mailer->send($invitation, $token);
            }
        });
    }

    private static function newToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    private static function notFound(): ApiProblemException
    {
        return new ApiProblemException(404, 'Invitation not found', self::NOT_FOUND_CODE);
    }

    private static function iso(\DateTimeImmutable $at): string
    {
        return $at->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }

    private function now(): \DateTimeImmutable
    {
        return $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
    }
}
