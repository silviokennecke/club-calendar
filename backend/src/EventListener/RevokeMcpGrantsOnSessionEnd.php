<?php

declare(strict_types=1);

namespace App\EventListener;

use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Attribute\AsEntityListener;
use Doctrine\ORM\Event\PreUpdateEventArgs;
use Doctrine\ORM\Events;
use Symfony\Component\Clock\ClockInterface;

/**
 * Every bump of the user's token version (sign out everywhere, password change/reset, e-mail change, passkey
 * deletion, SSO takeover) ends all MCP grants of the user too. Plain SQL: this runs inside the flush.
 */
#[AsEntityListener(event: Events::preUpdate, method: 'preUpdate', entity: User::class)]
final readonly class RevokeMcpGrantsOnSessionEnd
{
    public function __construct(private ClockInterface $clock)
    {
    }

    public function preUpdate(User $user, PreUpdateEventArgs $args): void
    {
        if (!$args->hasChangedField('tokenVersion')) {
            return;
        }
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $args->getObjectManager()->getConnection()->executeStatement(
            'UPDATE mcp_grant SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
            [$now, $user->getId()],
        );
    }
}
