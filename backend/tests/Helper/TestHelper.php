<?php
declare(strict_types=1);

namespace App\Tests\Helper;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\Event;
use App\Entity\EventTemplate;
use App\Entity\User;
use App\Service\TokenService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use DateMalformedStringException;
use DateTimeImmutable;

class TestHelper
{
    public static function createUser(
        EntityManagerInterface $em,
        UserPasswordHasherInterface $hasher,
        ?string $email = null,
        string $password = 'password123',
    ): User {
        $email ??= 'user' . uniqid() . '@example.com';
        $user = new User();
        $user->setName('Test User');
        $user->setEmail($email);
        $user->setPassword($hasher->hashPassword($user, $password));
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
        $user  = self::createUser($em, $hasher);
        $club  = self::createClub($em, $user);
        $cal   = self::createCalendar($em, $club);
        return ['user' => $user, 'club' => $club, 'calendar' => $cal];
    }

    /**
     * @param array<string, mixed> $overrides
     * @throws DateMalformedStringException
     */
    public static function createEvent(EntityManagerInterface $em, Calendar $calendar, array $overrides = []): Event
    {
        $event = new Event();
        $event->setCalendar($calendar);
        $event->setName($overrides['name'] ?? 'Test Event');
        $event->setDate(new DateTimeImmutable($overrides['date'] ?? '2026-07-01'));
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

    public static function authHeader(User $user, TokenService $tokens): string
    {
        return 'Bearer ' . $tokens->createAccessToken($user);
    }

    /**
     * @param array<string, mixed> $data
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
        return [
            'status'  => $response->getStatusCode(),
            'body'    => json_decode((string) $response->getContent(), true),
            'content' => (string) $response->getContent(),
            'headers' => $response->headers->all(),
        ];
    }
}
