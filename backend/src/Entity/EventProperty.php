<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class EventProperty
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: Event::class, inversedBy: 'properties')]
    #[ORM\JoinColumn(name: 'event_id', onDelete: 'CASCADE')]
    private Event $event;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: Property::class, inversedBy: 'events')]
    #[ORM\JoinColumn(name: 'property_id', onDelete: 'CASCADE')]
    private Property $property;

    public function getEvent(): Event
    {
        return $this->event;
    }

    public function setEvent(Event $event): static
    {
        $this->event = $event;

        return $this;
    }

    public function getProperty(): Property
    {
        return $this->property;
    }

    public function setProperty(Property $property): static
    {
        $this->property = $property;

        return $this;
    }
}
