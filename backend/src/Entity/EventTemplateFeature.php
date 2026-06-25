<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class EventTemplateFeature
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: EventTemplate::class, inversedBy: 'features')]
    #[ORM\JoinColumn(name: 'template_id', onDelete: 'CASCADE')]
    private EventTemplate $template;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: Feature::class, inversedBy: 'templates')]
    #[ORM\JoinColumn(name: 'feature_id', onDelete: 'CASCADE')]
    private Feature $feature;

    public function getTemplate(): EventTemplate
    {
        return $this->template;
    }

    public function setTemplate(EventTemplate $template): static
    {
        $this->template = $template;

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
