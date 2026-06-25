<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\Calendar;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * @extends Voter<string, Calendar>
 */
class ArchivedCalendarVoter extends Voter
{
    public const string NOT_ARCHIVED = 'NOT_ARCHIVED';

    public function __construct(private readonly RequestStack $requestStack) {}

    protected function supports(string $attribute, mixed $subject): bool
    {
        return $attribute === self::NOT_ARCHIVED && $subject instanceof Calendar;
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null): bool
    {
        /** @var Calendar $calendar */
        $calendar = $subject;

        if ($calendar->getArchivedAt() === null) {
            return true; // not archived, allow
        }

        // Archived: allow GET (reads), block writes
        $request = $this->requestStack->getCurrentRequest();
        if ($request === null) {
            return false;
        }

        return $request->isMethod('GET');
    }
}
