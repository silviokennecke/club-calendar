<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Club;
use App\Entity\ClubInvitation;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Exception\ApiProblemException;
use App\Security\AuthRateLimiter;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityNotFoundException;
use Psr\Clock\ClockInterface;

/**
 * Club invitations (security audit M8). Nobody is added to a club without consent, and inviting reveals
 * nothing about accounts:
 *
 * - {@see invite()} accepts any address and answers the same for unknown, registered and already-member
 *   addresses (the caller always answers 204). Only the mail goes out after the response; no lookup of the
 *   address in the user table decides anything the inviter can observe.
 * - An invitation is valid for 7 days. Pending and expired ones stay listed to the club and can be re-sent at
 *   any time (new token, the old link dies, new 7 days).
 * - The token is 32 random bytes (hex), stored as SHA-256 hash; it only identifies an invitation. To see,
 *   accept or decline one the signed-in user needs a VERIFIED address equal to the invited one, otherwise the
 *   answer is the generic 404 `invitation_not_found` (a stolen token is useless to another account).
 * - Accepting runs in a transaction under the club row lock (like removing a member; revoking, declining and
 *   re-sending take the same lock): the invitation is claimed once, the member and club quotas are respected,
 *   the membership is created.
 * - Addresses are stored normalized (trimmed, lower case); {@see isFor()} and {@see isMember()} compare exactly.
 */
readonly class ClubInvitationService
{
    public const string NOT_FOUND_CODE = 'invitation_not_found';
    public const string EXPIRED_CODE = 'invitation_expired';

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
    public function invite(Club $club, User $inviter, string $email, ClubRole $role = ClubRole::DEFAULT_INVITED): void
    {
        $email = EmailAddress::normalize($email);
        $now = $this->now();

        /** @var array{0: ClubInvitation, 1: string}|null $created */
        $created = $this->em->wrapInTransaction(function () use ($club, $inviter, $email, $now, $role): ?array {
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
                $open->setRole($role);
                $this->em->persist($open);
            } elseif ($open->isExpired($now)) {
                $open->renew($inviter, PasswordResetService::hash($token), $now);
                $open->setRole($role);
            } else {
                // Idempotent: no second mail, but the latest choice of role wins.
                $open->setRole($role);
                $this->em->flush();

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
     * @return list<array{id: string, email: string, status: string, role: string, invitedByName: ?string, createdAt: string, expiresAt: string}>
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
            'role' => $i->getRole()->value,
            'invitedByName' => $i->getInvitedBy()?->getName(),
            'createdAt' => self::iso($i->getCreatedAt()),
            'expiresAt' => self::iso($i->getExpiresAt()),
        ], $rows);
    }

    /**
     * Re-send of a pending or expired invitation: new token, new 7 days, new mail.
     *
     * @throws ApiProblemException 404 `invitation_not_found` (also accepted/declined ones)
     */
    public function resend(Club $club, User $by, string $invitationId): void
    {
        $now = $this->now();
        /** @var array{0: ClubInvitation, 1: string} $renewed */
        $renewed = $this->em->wrapInTransaction(function () use ($club, $by, $invitationId, $now): array {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
            $invitation = $this->findOpenOfClub($club, $invitationId);
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
        // Same club lock as accept/decline/resend: a parallel answer never refreshes a row that vanishes under it.
        $this->em->wrapInTransaction(function () use ($club, $invitationId): void {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
            $this->em->remove($this->findOpenOfClub($club, $invitationId));
            $this->em->flush();
        });
    }

    /** Whether the address has an open (pending, not expired) invitation to any club. */
    public function hasOpenInvitationFor(string $email): bool
    {
        $email = EmailAddress::normalize($email);
        // The column collation equates look-alikes ("é" = "e"): the exact match is checked on the rows.
        $found = $this->em->createQueryBuilder()
            ->select('i.email')
            ->from(ClubInvitation::class, 'i')
            ->where('i.email = :email')
            ->andWhere('i.status = :pending')
            ->andWhere('i.expiresAt > :now')
            ->setParameter('email', $email)
            ->setParameter('pending', ClubInvitation::PENDING)
            ->setParameter('now', $this->now())
            ->getQuery()
            ->getSingleColumnResult();

        return in_array($email, $found, true);
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
            ->setParameter('email', EmailAddress::normalize($user->getEmail()))
            ->setParameter('pending', ClubInvitation::PENDING)
            ->setParameter('now', $this->now())
            ->getQuery()
            ->getResult();
        $rows = array_values(array_filter($rows, fn (ClubInvitation $i) => self::isFor($user, $i)));

        return array_map(fn (ClubInvitation $i) => [
            'id' => $i->getId(),
            'clubName' => $i->getClub()->getName(),
            'role' => $i->getRole()->value,
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
     *                             answered), 422 `invitation_expired`, 422 `quota_exceeded` (members of the club, clubs of the user)
     */
    public function accept(User $user, ?string $id, ?string $token): array
    {
        $invitation = $this->findForUser($user, $id, $token);
        $club = $invitation->getClub();

        return $this->em->wrapInTransaction(function () use ($user, $invitation, $club): array {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
            $this->refreshLocked($invitation); // claimed by a parallel request in the meantime?
            $this->assertAnswerable($user, $invitation);
            if (null === $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $user])) {
                $this->quota->assertRoom(Quota::MEMBERS_PER_CLUB, $club);
                if ($invitation->getRole()->isStaff()) {
                    $this->quota->assertRoom(Quota::STAFF_PER_CLUB, $club);
                }
                $this->quota->assertRoom(Quota::CLUBS_PER_USER, $user);
                $this->em->persist((new ClubUser())->setClub($club)->setUser($user)->setRole($invitation->getRole()));
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
            $this->refreshLocked($invitation);
            $this->assertAnswerable($user, $invitation);
            $invitation->resolve(ClubInvitation::DECLINED, $this->now());
            $this->em->flush();
        });
    }

    /**
     * Public preview of a pending, not expired invitation by the mail token (no sign-in). Unknown, answered and
     * expired are the same 404, so the token reveals nothing beyond what the mail already said.
     *
     * @return array{email: string, clubName: string, invitedByName: ?string, expiresAt: string}
     *
     * @throws ApiProblemException 404 `invitation_not_found`
     */
    public function preview(string $token): array
    {
        $hash = PasswordResetService::hash($token);
        $invitation = '' === $token ? null : $this->em->getRepository(ClubInvitation::class)->findOneBy(['tokenHash' => $hash]);
        if (null === $invitation || !hash_equals($invitation->getTokenHash(), $hash)
            || ClubInvitation::PENDING !== $invitation->getStatus() || $invitation->isExpired($this->now())) {
            throw self::notFound();
        }

        return [
            'email' => $invitation->getEmail(),
            'clubName' => $invitation->getClub()->getName(),
            'invitedByName' => $invitation->getInvitedBy()?->getName(),
            'expiresAt' => self::iso($invitation->getExpiresAt()),
        ];
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

    /** Reloads the invitation under the club lock; revoked (or deleted with the club) meanwhile is the generic 404. */
    private function refreshLocked(ClubInvitation $invitation): void
    {
        try {
            $this->em->refresh($invitation);
        } catch (EntityNotFoundException) {
            throw self::notFound();
        }
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
        return $user->isEmailVerified() && EmailAddress::normalize($user->getEmail()) === $invitation->getEmail();
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
        // user.email is utf8mb4_unicode_ci (equates "é" and "e"): the exact comparison is done here
        $found = $this->em->getConnection()->fetchFirstColumn(
            'SELECT u.email FROM club_user cu JOIN user u ON u.id = cu.user_id WHERE cu.club_id = ? AND u.email = ?',
            [$club->getId(), $email],
        );

        return in_array($email, $found, true);
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
