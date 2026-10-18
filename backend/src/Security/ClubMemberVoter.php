<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Enum\ClubRole;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * Club rights by role: CLUB_MEMBER (any role: read), CLUB_EDITOR (editor or admin: change content),
 * CLUB_ADMIN (admin: manage the club, members, invitations, calendars and feeds). Non-members get 403 for all.
 *
 * @extends Voter<string, Club>
 */
class ClubMemberVoter extends Voter
{
    public const string CLUB_MEMBER = 'CLUB_MEMBER';
    public const string CLUB_EDITOR = 'CLUB_EDITOR';
    public const string CLUB_ADMIN = 'CLUB_ADMIN';

    private const array REQUIRED = [
        self::CLUB_MEMBER => ClubRole::VIEWER,
        self::CLUB_EDITOR => ClubRole::EDITOR,
        self::CLUB_ADMIN => ClubRole::ADMIN,
    ];

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    protected function supports(string $attribute, mixed $subject): bool
    {
        return isset(self::REQUIRED[$attribute]) && $subject instanceof Club;
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null): bool
    {
        $user = $token->getUser();
        if (!$user instanceof User) {
            return false;
        }

        $clubUser = $this->em->getRepository(ClubUser::class)->findOneBy([
            'club' => $subject,
            'user' => $user,
        ]);

        return null !== $clubUser && $clubUser->getRole()->atLeast(self::REQUIRED[$attribute]);
    }
}
