<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class EventTemplateTargetGroup
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: EventTemplate::class, inversedBy: 'targetGroups')]
    #[ORM\JoinColumn(name: 'template_id', onDelete: 'CASCADE')]
    private EventTemplate $template;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: TargetGroup::class, inversedBy: 'templates')]
    #[ORM\JoinColumn(name: 'target_group_id', onDelete: 'CASCADE')]
    private TargetGroup $targetGroup;

    public function getTemplate(): EventTemplate
    {
        return $this->template;
    }

    public function setTemplate(EventTemplate $template): static
    {
        $this->template = $template;

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
