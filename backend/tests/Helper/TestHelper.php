<?php

declare(strict_types=1);

namespace App\Tests\Helper;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedCalendar;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\Event;
use App\Entity\EventTemplate;
use App\Entity\Feature;
use App\Entity\Location;
use App\Entity\Property;
use App\Entity\TargetGroup;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\FeedVisibility;
use App\Service\TokenService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class TestHelper
{
    public static function createUser(
        EntityManagerInterface $em,
        UserPasswordHasherInterface $hasher,
        ?string $email = null,
        string $password = 'password123',
        bool $isEmailVerified = true,
    ): User {
        $email ??= 'user'.uniqid().'@example.com';
        $user = new User();
        $user->setName('Test User');
        $user->setEmail($email);
        $user->setPassword($hasher->hashPassword($user, $password));
        $user->setIsEmailVerified($isEmailVerified);
        $em->persist($user);
        $em->flush();

        return $user;
    }

    public static function createClub(EntityManagerInterface $em, User $user, string $name = 'Test Club'): Club
    {
        $club = new Club();
        $club->setName($name);
        $club->setTimezone('Europe/Berlin');
        $em->persist($club);

        $cu = new ClubUser();
        $cu->setClub($club);
        $cu->setUser($user);
        $em->persist($cu);
        $em->flush();

        return $club;
    }

    public static function addMember(EntityManagerInterface $em, Club $club, User $user, ClubRole $role): ClubUser
    {
        $cu = (new ClubUser())->setClub($club)->setUser($user)->setRole($role);
        $em->persist($cu);
        $em->flush();

        return $cu;
    }

    public static function createCalendar(EntityManagerInterface $em, Club $club, string $name = 'Test Calendar'): Calendar
    {
        $cal = new Calendar();
        $cal->setClub($club);
        $cal->setName($name);
        $em->persist($cal);
        $em->flush();

        return $cal;
    }

    /**
     * @return array{user: User, club: Club, calendar: Calendar}
     */
    public static function createCalendarWithClub(EntityManagerInterface $em, UserPasswordHasherInterface $hasher): array
    {
        $user = self::createUser($em, $hasher);
        $club = self::createClub($em, $user);
        $cal = self::createCalendar($em, $club);

        return ['user' => $user, 'club' => $club, 'calendar' => $cal];
    }

    /**
     * @param array<string, mixed> $overrides
     *
     * @throws \DateMalformedStringException
     */
    public static function createEvent(EntityManagerInterface $em, Calendar $calendar, array $overrides = []): Event
    {
        $event = new Event();
        $event->setCalendar($calendar);
        $event->setName($overrides['name'] ?? 'Test Event');
        $event->setDate(new \DateTimeImmutable($overrides['date'] ?? '2026-07-01'));
        $event->setTimeBegin($overrides['timeBegin'] ?? '18:00');
        $event->setTimeEnd($overrides['timeEnd'] ?? '20:00');
        $event->setIsDraft($overrides['isDraft'] ?? true);
        $em->persist($event);
        $em->flush();

        return $event;
    }

    /**
     * @param array<string, mixed> $overrides
     */
    public static function createTemplate(EntityManagerInterface $em, Calendar $calendar, array $overrides = []): EventTemplate
    {
        $tmpl = new EventTemplate();
        $tmpl->setCalendar($calendar);
        $tmpl->setName($overrides['name'] ?? 'Test Template');
        $tmpl->setTimezone($overrides['timezone'] ?? 'Europe/Berlin');
        $tmpl->setTimeBegin($overrides['timeBegin'] ?? '18:00');
        $tmpl->setTimeEnd($overrides['timeEnd'] ?? '20:00');
        $em->persist($tmpl);
        $em->flush();

        return $tmpl;
    }

    /** `/api/clubs/{id}` of the club that owns the calendar behind a `/api/calendars/{id}` base URI. */
    public static function clubBase(EntityManagerInterface $em, string $calendarBase): string
    {
        $calendar = $em->find(Calendar::class, basename($calendarBase));

        return '/api/clubs/'.$calendar->getClub()->getId();
    }

    /**
     * A feed stored directly, selecting the given calendars (all of the club).
     *
     * @param list<Calendar> $calendars
     */
    public static function createFeed(EntityManagerInterface $em, Club $club, array $calendars, FeedVisibility $visibility = FeedVisibility::PUBLIC, string $name = 'Test Feed', ?string $secret = null): CalendarFeed
    {
        static $no = 0;
        $feed = (new CalendarFeed())->setClub($club)->setName($name)->setVisibility($visibility);
        $feed->setSharedSecret($secret ?? 'test-feed-secret-'.++$no.'-'.bin2hex(random_bytes(4)));
        $em->persist($feed);
        foreach ($calendars as $calendar) {
            $link = (new CalendarFeedCalendar())->setFeed($feed)->setCalendar($calendar);
            $em->persist($link);
            $feed->getCalendars()->add($link);
        }
        $em->flush();

        return $feed;
    }

    public static function createLocation(EntityManagerInterface $em, Club $club, string $name = 'Test Location'): Location
    {
        $location = (new Location())->setClub($club)->setName($name);
        $em->persist($location);
        $em->flush();

        return $location;
    }

    public static function createProperty(EntityManagerInterface $em, Calendar $calendar, string $name = 'Test Property', ?string $icon = null): Property
    {
        $property = (new Property())->setCalendar($calendar)->setName($name)->setIcon($icon);
        $em->persist($property);
        $em->flush();

        return $property;
    }

    public static function createFeature(EntityManagerInterface $em, Calendar $calendar, string $name = 'Test Feature'): Feature
    {
        $feature = (new Feature())->setCalendar($calendar)->setName($name);
        $em->persist($feature);
        $em->flush();

        return $feature;
    }

    public static function createTargetGroup(EntityManagerInterface $em, Club $club, string $name = 'Test Target Group'): TargetGroup
    {
        $group = (new TargetGroup())->setClub($club)->setName($name);
        $em->persist($group);
        $em->flush();

        return $group;
    }

    public static function authHeader(User $user, TokenService $tokens): string
    {
        return 'Bearer '.$tokens->createAccessToken($user);
    }

    /**
     * @param array<string, mixed> $data
     *
     * @return array{status: int, body: mixed, content: string, headers: array<string, list<string>>}
     */
    public static function jsonRequest(
        KernelBrowser $client,
        string $method,
        string $uri,
        array $data = [],
        string $authHeader = '',
    ): array {
        $headers = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
        if ($authHeader) {
            $headers['HTTP_AUTHORIZATION'] = $authHeader;
        }
        $client->request($method, $uri, [], [], $headers, $data ? json_encode($data) : null);
        $response = $client->getResponse();
        // streamed responses (ICS) only have their body in the internal response
        $content = (string) $client->getInternalResponse()->getContent();

        return [
            'status' => $response->getStatusCode(),
            'body' => json_decode($content, true),
            'content' => $content,
            'headers' => $response->headers->all(),
        ];
    }
}
