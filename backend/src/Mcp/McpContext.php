<?php

declare(strict_types=1);

namespace App\Mcp;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\McpGrant;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Exception\ApiProblemException;
use App\OAuth\McpScope;
use App\OAuth\ResolvedAccessToken;
use Doctrine\ORM\EntityManagerInterface;
use Mcp\Exception\ToolCallException;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * The authenticated MCP caller of the current request, filled by {@see Security\McpAuthenticator} (kept on the
 * request, so no state survives into the next one). Every tool starts with requireScope() and requireRole():
 * the role is read from the DB on each call (same rule as the club/calendar voters), never from the token.
 */
class McpContext
{
    public const string ATTRIBUTE = '_mcp_access';

    public function __construct(
        private readonly RequestStack $requests,
        private readonly EntityManagerInterface $em,
    ) {
    }

    public function token(): ResolvedAccessToken
    {
        $token = $this->requests->getMainRequest()?->attributes->get(self::ATTRIBUTE);
        if (!$token instanceof ResolvedAccessToken) {
            throw new ToolCallException('Not authenticated.');
        }

        return $token;
    }

    public function user(): User
    {
        return $this->token()->user;
    }

    public function grant(): McpGrant
    {
        return $this->token()->grant;
    }

    /** @throws ToolCallException when the grant does not carry the scope (`mcp:write` implies `mcp:read`) */
    public function requireScope(McpScope $scope): void
    {
        if (!$this->token()->allows($scope)) {
            throw new ToolCallException(sprintf('The connection lacks the "%s" scope.', $scope->value));
        }
    }

    /**
     * Re-checks the caller's current role in the club (of the calendar). A non-member gets the same "not found" as
     * for a missing id; a member with a lower role gets a "forbidden" error.
     *
     * @throws ToolCallException
     */
    public function requireRole(Club|Calendar $subject, ClubRole $role): void
    {
        $membership = $this->membership($subject);
        if (null === $membership) {
            throw new ToolCallException($subject instanceof Club ? 'Club not found.' : 'Calendar not found.');
        }
        if (!$membership->getRole()->atLeast($role)) {
            throw new ToolCallException(sprintf('Forbidden: this action needs the "%s" role in the club.', $role->value));
        }
    }

    /** Looks the club up by id and checks the role; a missing id and a non-member are the same "not found". */
    public function club(string $id, ClubRole $role): Club
    {
        $club = $this->em->find(Club::class, $id);
        if (null === $club) {
            throw new ToolCallException('Club not found.');
        }
        $this->requireRole($club, $role);

        return $club;
    }

    public function calendar(string $id, ClubRole $role): Calendar
    {
        $calendar = $this->em->find(Calendar::class, $id);
        if (null === $calendar) {
            throw new ToolCallException('Calendar not found.');
        }
        $this->requireRole($calendar, $role);

        return $calendar;
    }

    /** Like calendar(), for writes: an archived calendar is read-only (same rule as ArchivedCalendarVoter). */
    public function writableCalendar(string $id, ClubRole $role): Calendar
    {
        $calendar = $this->calendar($id, $role);
        if (null !== $calendar->getArchivedAt()) {
            throw new ToolCallException('Calendar is archived and read-only.');
        }

        return $calendar;
    }

    /** True when the caller is a member with at least this role (no exception; for optional content such as drafts). */
    public function hasRole(Club|Calendar $subject, ClubRole $role): bool
    {
        return $this->membership($subject)?->getRole()->atLeast($role) ?? false;
    }

    /**
     * Runs a service call and turns the API's HTTP errors into tool errors (code and field kept in the message).
     *
     * @template T
     *
     * @param callable(): T $call
     *
     * @return T
     *
     * @throws ToolCallException
     */
    public function run(callable $call): mixed
    {
        try {
            return $call();
        } catch (ApiProblemException $e) {
            throw new ToolCallException(sprintf('%s [%s%s]', $e->getMessage(), $e->getErrorCode(), $e->getField() ? ', field '.$e->getField() : ''), 0, $e);
        } catch (HttpExceptionInterface $e) {
            throw new ToolCallException(404 === $e->getStatusCode() ? $e->getMessage() : sprintf('Request failed (%d).', $e->getStatusCode()), 0, $e);
        }
    }

    private function membership(Club|Calendar $subject): ?ClubUser
    {
        $club = $subject instanceof Club ? $subject : $subject->getClub();

        return $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $this->user()]);
    }
}
