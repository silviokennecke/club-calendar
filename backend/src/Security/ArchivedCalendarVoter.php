<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\Calendar;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * @extends Voter<string, Calendar>
 */
class ArchivedCalendarVoter extends Voter
{
    public const string NOT_ARCHIVED = 'NOT_ARCHIVED';

    protected function supports(string $attribute, mixed $subject): bool
    {
        return self::NOT_ARCHIVED === $attribute && $subject instanceof Calendar;
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null): bool
    {
        /** @var Calendar $calendar */
        $calendar = $subject;

        return null === $calendar->getArchivedAt();
    }
}
