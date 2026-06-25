<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class EventFeature
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: Event::class, inversedBy: 'features')]
    #[ORM\JoinColumn(name: 'event_id', onDelete: 'CASCADE')]
    private Event $event;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: Feature::class, inversedBy: 'events')]
    #[ORM\JoinColumn(name: 'feature_id', onDelete: 'CASCADE')]
    private Feature $feature;

    public function getEvent(): Event
    {
        return $this->event;
    }

    public function setEvent(Event $event): static
    {
        $this->event = $event;

        return $this;
    }

    public function getFeature(): Feature
    {
        return $this->feature;
    }

    public function setFeature(Feature $feature): static
    {
        $this->feature = $feature;

        return $this;
    }
}
