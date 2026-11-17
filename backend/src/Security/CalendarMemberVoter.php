<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\Calendar;
use App\Entity\CalendarMember;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Enum\ClubRole;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * Calendar rights by the role in the calendar's club (see {@see ClubMemberVoter}): CALENDAR_MEMBER (staff: viewer or above; a plain `member` is always denied),
 * CALENDAR_EDITOR (editor or admin) and CALENDAR_ADMIN (admin). A club member with a {@see CalendarMember} row for
 * the calendar also passes CALENDAR_MEMBER and CALENDAR_EDITOR (whatever the club role). CALENDAR_STAFF_EDITOR is
 * the editor role only (no row): for settings that a calendar member must not change, e.g. holiday calendars.
 *
 * @extends Voter<string, Calendar>
 */
class CalendarMemberVoter extends Voter
{
    public const string CALENDAR_MEMBER = 'CALENDAR_MEMBER';
    public const string CALENDAR_EDITOR = 'CALENDAR_EDITOR';
    public const string CALENDAR_ADMIN = 'CALENDAR_ADMIN';
    public const string CALENDAR_STAFF_EDITOR = 'CALENDAR_STAFF_EDITOR';

    private const array REQUIRED = [
        self::CALENDAR_MEMBER => ClubRole::VIEWER,
        self::CALENDAR_EDITOR => ClubRole::EDITOR,
        self::CALENDAR_ADMIN => ClubRole::ADMIN,
        self::CALENDAR_STAFF_EDITOR => ClubRole::EDITOR,
    ];

    /** Attributes a CalendarMember row grants. */
    private const array GRANTED_BY_ROW = [self::CALENDAR_MEMBER, self::CALENDAR_EDITOR];

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

        if (null === $clubUser) {
            return false;
        }
        if ($clubUser->getRole()->atLeast(self::REQUIRED[$attribute])) {
            return true;
        }

        return in_array($attribute, self::GRANTED_BY_ROW, true)
            && null !== $this->em->getRepository(CalendarMember::class)->findOneBy(['calendar' => $calendar, 'user' => $user]);
    }
}
