<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\EventTemplate;
use App\Entity\Feature;
use App\Entity\Property;
use App\Exception\ApiProblemException;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Resolves ids from request bodies to records of ONE scope: locations and target groups belong to a
 * club (scope: the Club), event templates, properties and features to a calendar (scope: the Calendar). Unknown
 * ids and ids of other clubs/calendars are rejected alike (422), so that nothing about other clubs leaks
 * and no foreign data can be linked. Club-level classes need the Club as scope (no fallback from a calendar).
 * Errors: 422 `code: unknown_reference` with the input `field`.
 */
readonly class CalendarReferences
{
    public const CODE = 'unknown_reference';

    public function __construct(private EntityManagerInterface $em)
    {
    }

    /**
     * @template T of object
     *
     * @param class-string<T> $class
     *
     * @return T|null null for an empty value (null or "")
     */
    public function find(string $class, Club|Calendar $scope, mixed $id, string $field): ?object
    {
        if (null === $id || '' === $id) {
            return null;
        }
        if (!is_string($id) && !is_int($id)) {
            throw Input::invalid($field, sprintf('%s must be an id', $field));
        }

        $found = $this->findAll($class, $scope, [(string) $id], $field);

        return reset($found) ?: null;
    }

    /**
     * @template T of object
     *
     * @param class-string<T> $class
     * @param list<string>    $ids   unique ids (see Input::idList)
     *
     * @return array<string, T> by the stored id (the database compares ids case-insensitively, so
     *                          "ABC…" and "abc…" find the same record and must not be linked twice)
     */
    public function findAll(string $class, Club|Calendar $scope, array $ids, string $field): array
    {
        $found = [];
        $byCalendar = in_array($class, [EventTemplate::class, Property::class, Feature::class], true);
        if ($byCalendar && !$scope instanceof Calendar) {
            throw new \LogicException('Templates, properties and features are resolved within a calendar');
        }
        if (!$byCalendar && !$scope instanceof Club) {
            throw new \LogicException('Club-level records are resolved within a club');
        }
        foreach ($ids as $id) {
            $entity = $this->em->getRepository($class)->find($id);
            $owner = $byCalendar ? $entity?->getCalendar() : $entity?->getClub();
            if (null === $entity || $owner->getId() !== $scope->getId()) {
                throw self::unknown($field, $id, $scope);
            }
            $found[$entity->getId()] = $entity;
        }

        return $found;
    }

    public static function unknown(string $field, string $id, Club|Calendar|null $scope = null): ApiProblemException
    {
        return new ApiProblemException(422, sprintf('%s: unknown id "%s" in this %s', $field, $id, $scope instanceof Club ? 'club' : 'calendar'), self::CODE, $field);
    }
}
