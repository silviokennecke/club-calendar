<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class EventTemplateProperty
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: EventTemplate::class, inversedBy: 'properties')]
    #[ORM\JoinColumn(name: 'template_id', onDelete: 'CASCADE')]
    private EventTemplate $template;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: Property::class, inversedBy: 'templates')]
    #[ORM\JoinColumn(name: 'property_id', onDelete: 'CASCADE')]
    private Property $property;

    public function getTemplate(): EventTemplate
    {
        return $this->template;
    }

    public function setTemplate(EventTemplate $template): static
    {
        $this->template = $template;

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
