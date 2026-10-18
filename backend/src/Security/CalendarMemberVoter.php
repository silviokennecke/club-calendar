<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\Calendar;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Enum\ClubRole;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * Calendar rights by the role in the calendar's club (see {@see ClubMemberVoter}): CALENDAR_MEMBER (any role),
 * CALENDAR_EDITOR (editor or admin) and CALENDAR_ADMIN (admin).
 *
 * @extends Voter<string, Calendar>
 */
class CalendarMemberVoter extends Voter
{
    public const string CALENDAR_MEMBER = 'CALENDAR_MEMBER';
    public const string CALENDAR_EDITOR = 'CALENDAR_EDITOR';
    public const string CALENDAR_ADMIN = 'CALENDAR_ADMIN';

    private const array REQUIRED = [
        self::CALENDAR_MEMBER => ClubRole::VIEWER,
        self::CALENDAR_EDITOR => ClubRole::EDITOR,
        self::CALENDAR_ADMIN => ClubRole::ADMIN,
    ];

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    protected function supports(string $attribute, mixed $subject): bool
    {
        return isset(self::REQUIRED[$attribute]) && $subject instanceof Calendar;
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null): bool
    {
        $user = $token->getUser();
        if (!$user instanceof User) {
            return false;
        }

        /** @var Calendar $calendar */
        $calendar = $subject;

        $clubUser = $this->em->getRepository(ClubUser::class)->findOneBy([
            'club' => $calendar->getClub(),
            'user' => $user,
        ]);

        return null !== $clubUser && $clubUser->getRole()->atLeast(self::REQUIRED[$attribute]);
    }
}
