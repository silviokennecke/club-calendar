<?php

declare(strict_types=1);

namespace App\Mcp;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\McpGrant;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Exception\ApiProblemException;
use App\OAuth\McpScope;
use App\OAuth\ResolvedAccessToken;
use App\Security\CalendarMemberVoter;
use App\Security\ClubMemberVoter;
use Doctrine\ORM\EntityManagerInterface;
use Mcp\Exception\ToolCallException;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;

/**
 * The authenticated MCP caller of the current request, filled by {@see Security\McpAuthenticator} (kept on the
 * request, so no state survives into the next one). Every tool starts with requireScope() and an access check:
 * access is decided on each call by the same voters as the REST API (club role and CalendarMember rows read from
 * the DB), never from the token, so REST and MCP cannot diverge. For a calendar, VIEWER means read and EDITOR
 * write, both also granted by a CalendarMember row; a club member who may not even read the calendar gets the same
 * "not found" as an outsider.
 */
class McpContext
{
    public const string ATTRIBUTE = '_mcp_access';

    public function __construct(
        private readonly RequestStack $requests,
        private readonly EntityManagerInterface $em,
        private readonly AuthorizationCheckerInterface $authorization,
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
        $this->recordScope($scope);
        if (!$this->token()->allows($scope)) {
            throw new ToolCallException(sprintf('The connection lacks the "%s" scope.', $scope->value));
        }
    }

    /** The strongest scope a tool asked for in this request (`read`|`write`), for telemetry; null if none. */
    public function requiredScope(): ?string
    {
        $scope = $this->requests->getMainRequest()?->attributes->get('_mcp_required_scope');

        return \is_string($scope) ? $scope : null;
    }

    public function resetRequiredScope(): void
    {
        $this->requests->getMainRequest()?->attributes->remove('_mcp_required_scope');
    }

    private function recordScope(McpScope $scope): void
    {
        $attributes = $this->requests->getMainRequest()?->attributes;
        if (null !== $attributes && 'write' !== $attributes->get('_mcp_required_scope')) {
            $attributes->set('_mcp_required_scope', McpScope::Write === $scope ? 'write' : 'read');
        }
    }

    /**
     * Re-checks the caller's current access (voters). No access at all gives "not found" (a non-member and, for a
     * calendar, a member without a permission row are indistinguishable from a missing id); a lower right gives
     * a "forbidden" error. Calendar subjects honour CalendarMember rows for VIEWER and EDITOR.
     *
     * @throws ToolCallException
     */
    public function requireRole(Club|Calendar $subject, ClubRole $role): void
    {
        $isCalendar = $subject instanceof Calendar;
        if (!$this->authorization->isGranted($isCalendar ? CalendarMemberVoter::CALENDAR_MEMBER : ClubMemberVoter::CLUB_ANY_MEMBER, $subject)) {
            throw new ToolCallException($isCalendar ? 'Calendar not found.' : 'Club not found.');
        }
        if (!$this->authorization->isGranted($this->attribute($subject, $role), $subject)) {
            throw new ToolCallException(sprintf('Forbidden: this action needs the "%s" role in the club.', $role->value));
        }
    }

    /**
     * Read access to the club's shared lists (locations, target groups) and the calendar list: staff or a member
     * with a calendar permission in the club (voter CLUB_CALENDAR_ACCESS). Others: "not found" for non-members,
     * "forbidden" for a plain member without any permission.
     */
    public function clubForCalendarAccess(string $id): Club
    {
        $club = $this->em->find(Club::class, $id);
        if (null === $club || !$this->authorization->isGranted(ClubMemberVoter::CLUB_ANY_MEMBER, $club)) {
            throw new ToolCallException('Club not found.');
        }
        if (!$this->authorization->isGranted(ClubMemberVoter::CLUB_CALENDAR_ACCESS, $club)) {
            throw new ToolCallException('Forbidden: this action needs the "viewer" role in the club or a calendar permission.');
        }

        return $club;
    }

    /** True when the caller has at least the staff (viewer) role in the club, i.e. is not limited to own calendars. */
    public function isStaff(Club $club): bool
    {
        return $this->authorization->isGranted(ClubMemberVoter::CLUB_MEMBER, $club);
    }

    private function attribute(Club|Calendar $subject, ClubRole $role): string
    {
        if ($subject instanceof Calendar) {
            return match ($role) {
                ClubRole::MEMBER, ClubRole::VIEWER => CalendarMemberVoter::CALENDAR_MEMBER,
                ClubRole::EDITOR => CalendarMemberVoter::CALENDAR_EDITOR,
                ClubRole::ADMIN => CalendarMemberVoter::CALENDAR_ADMIN,
            };
        }

        return match ($role) {
            ClubRole::MEMBER => ClubMemberVoter::CLUB_ANY_MEMBER,
            ClubRole::VIEWER => ClubMemberVoter::CLUB_MEMBER,
            ClubRole::EDITOR => ClubMemberVoter::CLUB_EDITOR,
            ClubRole::ADMIN => ClubMemberVoter::CLUB_ADMIN,
        };
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

    /** True when the caller currently holds this right (no exception; e.g. to decide whether drafts are visible). */
    public function hasRole(Club|Calendar $subject, ClubRole $role): bool
    {
        return $this->authorization->isGranted($this->attribute($subject, $role), $subject);
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
}
