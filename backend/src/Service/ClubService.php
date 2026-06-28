<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class ClubService
{
    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    public function listClubs(User $user): array
    {
        $clubUsers = $this->em->getRepository(ClubUser::class)->findBy(['user' => $user]);

        return array_map(function (ClubUser $cu) {
            $club = $cu->getClub();

            return [
                'id' => $club->getId(),
                'name' => $club->getName(),
                'timezone' => $club->getTimezone(),
                '_count' => ['calendars' => $club->getCalendars()->count()],
            ];
        }, $clubUsers);
    }

    public function createClub(User $user, string $name, string $timezone = 'Europe/Berlin'): array
    {
        $club = new Club();
        $club->setName($name);
        $club->setTimezone($timezone);
        $this->em->persist($club);

        $cu = new ClubUser();
        $cu->setClub($club);
        $cu->setUser($user);
        $this->em->persist($cu);
        $this->em->flush();

        return $this->serializeClub($club);
    }

    public function getClub(Club $club): array
    {
        return $this->serializeClub($club);
    }

    public function updateClub(Club $club, array $data): array
    {
        if (isset($data['name'])) {
            $club->setName($data['name']);
        }
        if (isset($data['timezone'])) {
            $club->setTimezone($data['timezone']);
        }
        $this->em->flush();

        return $this->serializeClub($club);
    }

    public function deleteClub(Club $club): void
    {
        $this->em->remove($club);
        $this->em->flush();
    }

    public function listMembers(Club $club): array
    {
        $members = $this->em->getRepository(ClubUser::class)->findBy(['club' => $club]);

        return array_map(fn (ClubUser $cu) => [
            'id' => $cu->getUser()->getId(),
            'name' => $cu->getUser()->getName(),
            'email' => $cu->getUser()->getEmail(),
        ], $members);
    }

    public function addMember(Club $club, string $email): array
    {
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if (!$user) {
            throw new NotFoundHttpException('User not found');
        }
        $existing = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $user]);
        if ($existing) {
            return ['id' => $user->getId(), 'name' => $user->getName(), 'email' => $user->getEmail()];
        }
        $cu = new ClubUser();
        $cu->setClub($club);
        $cu->setUser($user);
        $this->em->persist($cu);
        $this->em->flush();

        return ['id' => $user->getId(), 'name' => $user->getName(), 'email' => $user->getEmail()];
    }

    public function removeMember(Club $club, string $memberId): void
    {
        $member = $this->em->getRepository(User::class)->find($memberId);
        if (!$member) {
            return;
        }
        $cu = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $member]);
        if ($cu) {
            $this->em->remove($cu);
            $this->em->flush();
        }
    }

    private function serializeClub(Club $club): array
    {
        return [
            'id' => $club->getId(),
            'name' => $club->getName(),
            'timezone' => $club->getTimezone(),
        ];
    }
}
