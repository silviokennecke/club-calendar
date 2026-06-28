<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * @extends Voter<string, Club>
 */
class ClubMemberVoter extends Voter
{
    public const string CLUB_MEMBER = 'CLUB_MEMBER';

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    protected function supports(string $attribute, mixed $subject): bool
    {
        return self::CLUB_MEMBER === $attribute && $subject instanceof Club;
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null): bool
    {
        $user = $token->getUser();
        if (!$user instanceof User) {
            return false;
        }

        /** @var Club $club */
        $club = $subject;

        $clubUser = $this->em->getRepository(ClubUser::class)->findOneBy([
            'club' => $club,
            'user' => $user,
        ]);

        return null !== $clubUser;
    }
}
