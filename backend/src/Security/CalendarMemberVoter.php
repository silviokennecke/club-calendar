<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\Calendar;
use App\Entity\ClubUser;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * @extends Voter<string, Calendar>
 */
class CalendarMemberVoter extends Voter
{
    public const string CALENDAR_MEMBER = 'CALENDAR_MEMBER';

    public function __construct(private readonly EntityManagerInterface $em) {}

    protected function supports(string $attribute, mixed $subject): bool
    {
        return $attribute === self::CALENDAR_MEMBER && $subject instanceof Calendar;
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null): bool
    {
        $user = $token->getUser();
        if (!$user instanceof User) {
            return false;
        }

        /** @var Calendar $calendar */
        $calendar = $subject;

        // Check that this user is a member of the calendar's club
        $clubUser = $this->em->getRepository(ClubUser::class)->findOneBy([
            'club' => $calendar->getClub(),
            'user' => $user,
        ]);

        return $clubUser !== null;
    }
}
