<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class EventTargetGroup
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: Event::class, inversedBy: 'targetGroups')]
    #[ORM\JoinColumn(name: 'event_id', onDelete: 'CASCADE')]
    private Event $event;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: TargetGroup::class, inversedBy: 'events')]
    #[ORM\JoinColumn(name: 'target_group_id', onDelete: 'CASCADE')]
    private TargetGroup $targetGroup;

    public function getEvent(): Event
    {
        return $this->event;
    }

    public function setEvent(Event $event): static
    {
        $this->event = $event;

        return $this;
    }

    public function getTargetGroup(): TargetGroup
    {
        return $this->targetGroup;
    }

    public function setTargetGroup(TargetGroup $targetGroup): static
    {
        $this->targetGroup = $targetGroup;

        return $this;
    }
}
