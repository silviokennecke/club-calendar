<?php

declare(strict_types=1);

namespace App\DataFixtures;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Enum\FeedVisibility;
use Doctrine\Bundle\FixturesBundle\Fixture;
use Doctrine\Persistence\ObjectManager;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class AppFixtures extends Fixture
{
    public function __construct(private readonly UserPasswordHasherInterface $hasher)
    {
    }

    public function load(ObjectManager $manager): void
    {
        $user = new User();
        $user->setName('Admin');
        $user->setEmail('admin@example.com');
        $user->setPassword($this->hasher->hashPassword($user, 'password123'));
        $manager->persist($user);

        $club = new Club();
        $club->setName('Schützenverein');
        $manager->persist($club);

        $membership = new ClubUser();
        $membership->setClub($club);
        $membership->setUser($user);
        $manager->persist($membership);

        $calendar = new Calendar();
        $calendar->setClub($club);
        $calendar->setName('Vereinskalender');
        $manager->persist($calendar);

        $publicFeed = new CalendarFeed();
        $publicFeed->setCalendar($calendar);
        $publicFeed->setName('Öffentlicher Kalender');
        $publicFeed->setVisibility(FeedVisibility::PUBLIC);
        $publicFeed->setSharedSecret('00000000-0000-0000-0000-000000000001');
        $manager->persist($publicFeed);

        $privateFeed = new CalendarFeed();
        $privateFeed->setCalendar($calendar);
        $privateFeed->setName('Privater Kalender');
        $privateFeed->setVisibility(FeedVisibility::PRIVATE);
        $privateFeed->setSharedSecret('00000000-0000-0000-0000-000000000002');
        $manager->persist($privateFeed);

        $manager->flush();
    }
}
