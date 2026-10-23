<?php

declare(strict_types=1);

namespace App\Doctrine;

use App\Entity\CalendarFeedCalendar;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\EventFeature;
use App\Entity\EventProperty;
use App\Entity\EventTargetGroup;
use App\Entity\EventTemplateFeature;
use App\Entity\EventTemplateProperty;
use App\Entity\EventTemplateTargetGroup;
use App\Entity\UpdateAudited;
use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Attribute\AsDoctrineListener;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Event\OnFlushEventArgs;
use Doctrine\ORM\Event\PrePersistEventArgs;
use Doctrine\ORM\Events;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;

/**
 * Sets updated_at/updated_by on every UpdateAudited entity at insert and update. Rows of association entities
 * (e.g. EventTargetGroup) have no audit fields of their own: adding or removing one stamps the owning entity.
 */
#[AsDoctrineListener(event: Events::prePersist)]
#[AsDoctrineListener(event: Events::onFlush)]
final class UpdateAuditListener
{
    private const PARENT_GETTER = [
        EventProperty::class => 'getEvent',
        EventFeature::class => 'getEvent',
        EventTargetGroup::class => 'getEvent',
        EventTemplateProperty::class => 'getTemplate',
        EventTemplateFeature::class => 'getTemplate',
        EventTemplateTargetGroup::class => 'getTemplate',
        CalendarFeedCalendar::class => 'getFeed',
        CalendarFeedTargetGroup::class => 'getFeed',
    ];

    public function __construct(private readonly TokenStorageInterface $tokenStorage)
    {
    }

    public function prePersist(PrePersistEventArgs $args): void
    {
        $entity = $args->getObject();
        if ($entity instanceof UpdateAudited) {
            $entity->stampUpdate(new \DateTimeImmutable(), $this->actor($args->getObjectManager()));
        }
    }

    public function onFlush(OnFlushEventArgs $args): void
    {
        $em = $args->getObjectManager();
        $uow = $em->getUnitOfWork();
        $at = new \DateTimeImmutable();
        $by = $this->actor($em);

        $touch = [];
        foreach ($uow->getScheduledEntityUpdates() as $entity) {
            if ($entity instanceof UpdateAudited) {
                $touch[spl_object_id($entity)] = $entity;
            }
        }
        foreach ([$uow->getScheduledEntityInsertions(), $uow->getScheduledEntityDeletions()] as $entities) {
            foreach ($entities as $entity) {
                $getter = self::PARENT_GETTER[$entity::class] ?? null;
                if (null === $getter) {
                    continue;
                }
                $parent = $entity->$getter();
                if ($parent instanceof UpdateAudited && !$uow->isScheduledForInsert($parent) && !$uow->isScheduledForDelete($parent)) {
                    $touch[spl_object_id($parent)] = $parent;
                }
            }
        }

        foreach ($touch as $entity) {
            $scheduled = $uow->isScheduledForUpdate($entity);
            $entity->stampUpdate($at, $by);
            $meta = $em->getClassMetadata($entity::class);
            if ($scheduled) {
                $uow->recomputeSingleEntityChangeSet($meta, $entity);
            } else {
                $uow->computeChangeSet($meta, $entity);
            }
        }
    }

    private function actor(EntityManagerInterface $em): ?User
    {
        $user = $this->tokenStorage->getToken()?->getUser();

        // A user removed in this request (account deletion) must not be referenced any more.
        return $user instanceof User && $em->contains($user) && !$em->getUnitOfWork()->isScheduledForDelete($user) ? $user : null;
    }
}
