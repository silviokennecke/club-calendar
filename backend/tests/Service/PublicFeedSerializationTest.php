<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\Event;
use App\Entity\EventFeature;
use App\Entity\EventProperty;
use App\Entity\EventTargetGroup;
use App\Entity\Feature;
use App\Entity\Property;
use App\Entity\TargetGroup;
use App\Enum\FeedVisibility;
use App\Service\PublicFeedService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * The public feed lists an event's properties, features and target groups as JSON arrays even when the
 * Doctrine collections have gaps in their keys (an element removed in the same unit of work): `toArray()`
 * keeps the keys and json_encode would turn `[1 => …]` into an object.
 */
class PublicFeedSerializationTest extends KernelTestCase
{
    public function testAssignmentsAreListsEvenWithNonSequentialCollectionKeys(): void
    {
        self::bootKernel();
        $container = static::getContainer();
        $em = $container->get(EntityManagerInterface::class);
        DatabaseResetter::reset($em);
        ['calendar' => $cal] = TestHelper::createCalendarWithClub($em, $container->get(UserPasswordHasherInterface::class));

        $feed = TestHelper::createFeed($em, $cal->getClub(), [$cal], FeedVisibility::PUBLIC, 'Alle', 'secret-'.$cal->getId());

        $event = TestHelper::createEvent($em, $cal, ['isDraft' => false]);
        foreach (['A', 'B'] as $name) {
            $property = (new Property())->setCalendar($cal)->setName("Eigenschaft $name");
            $feature = (new Feature())->setCalendar($cal)->setName("Zusatz $name");
            $group = (new TargetGroup())->setClub($cal->getClub())->setName("Gruppe $name");
            $em->persist($property);
            $em->persist($feature);
            $em->persist($group);
            $event->getProperties()->add((new EventProperty())->setEvent($event)->setProperty($property));
            $event->getFeatures()->add((new EventFeature())->setEvent($event)->setFeature($feature));
            $event->getTargetGroups()->add((new EventTargetGroup())->setEvent($event)->setTargetGroup($group));
        }
        $em->flush();

        // Remove the first link of each collection (not flushed): the remaining one keeps key 1
        foreach ([$event->getProperties(), $event->getFeatures(), $event->getTargetGroups()] as $links) {
            $links->removeElement($links->first());
            $this->assertSame([1], $links->getKeys());
        }

        $service = $container->get(PublicFeedService::class);
        $single = $service->getFeedEvent($feed->getId(), $event->getId(), null)['event'];
        $list = $service->getFeedEvents($feed->getId(), null, null)['events'];
        $this->assertCount(1, $list);

        foreach ([$single, $list[0]] as $serialized) {
            foreach (['properties', 'features', 'targetGroups'] as $key) {
                $this->assertTrue(array_is_list($serialized[$key]), $key);
                $this->assertStringStartsWith('[', (string) json_encode($serialized[$key]), $key);
                $this->assertCount(1, $serialized[$key], $key);
            }
            $this->assertSame('Eigenschaft B', $serialized['properties'][0]['property']['name']);
        }
        $this->assertInstanceOf(Event::class, $event);
    }
}
