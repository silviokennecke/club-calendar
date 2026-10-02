<?php

declare(strict_types=1);

namespace App\Service;

use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Brings a link collection (link entities with composite ids, e.g. event + target group) in line
 * with the wanted target ids: removes links that are no longer wanted and adds only new ones.
 * Removing and re-adding an unchanged link within one flush collides in Doctrine's identity map
 * (EntityIdentityCollisionException), so unchanged links are kept.
 */
final class LinkCollectionSync
{
    /**
     * @template T of object
     *
     * @param Collection<int, T>   $links
     * @param array<int, mixed>    $wantedIds
     * @param callable(T): string  $idOf      target id of an existing link
     * @param callable(string): ?T $create    new (unpersisted) link for a target id, null if the id is unknown/not allowed
     */
    public static function sync(EntityManagerInterface $em, Collection $links, array $wantedIds, callable $idOf, callable $create): void
    {
        $wanted = array_values(array_unique(array_map('strval', $wantedIds)));
        foreach ($links->toArray() as $link) {
            $id = $idOf($link);
            if (in_array($id, $wanted, true)) {
                $wanted = array_values(array_diff($wanted, [$id]));
            } else {
                $links->removeElement($link);
                $em->remove($link);
            }
        }
        foreach ($wanted as $id) {
            $link = $create($id);
            if (null !== $link) {
                $em->persist($link);
                $links->add($link);
            }
        }
    }
}
