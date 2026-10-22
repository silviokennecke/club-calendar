<?php

declare(strict_types=1);

namespace App\Mcp;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\McpGrant;
use App\Entity\User;
use App\Enum\ClubRole;
use App\OAuth\McpScope;
use App\OAuth\ResolvedAccessToken;
use Doctrine\ORM\EntityManagerInterface;
use Mcp\Exception\ToolCallException;
use Symfony\Component\HttpFoundation\RequestStack;

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
        $club = $subject instanceof Club ? $subject : $subject->getClub();
        $membership = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $this->user()]);
        if (null === $membership) {
            throw new ToolCallException($subject instanceof Club ? 'Club not found.' : 'Calendar not found.');
        }
        if (!$membership->getRole()->atLeast($role)) {
            throw new ToolCallException(sprintf('Forbidden: this action needs the "%s" role in the club.', $role->value));
        }
    }
}
