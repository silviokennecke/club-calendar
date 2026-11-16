<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\ResourceType;
use App\Enum\ResourceVisibility;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_resource_location', columns: ['location_id'])]
class Resource implements UpdateAudited
{
    use Trait\HasUpdateAudit;

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Club::class)]
    #[ORM\JoinColumn(name: 'club_id', nullable: false, onDelete: 'CASCADE')]
    private Club $club;

    #[ORM\Column(length: 20, enumType: ResourceType::class)]
    private ResourceType $type = ResourceType::LOCATION;

    #[ORM\Column(length: 255)]
    private string $name;

    #[ORM\OneToOne(targetEntity: Location::class)]
    #[ORM\JoinColumn(name: 'location_id', nullable: false, onDelete: 'CASCADE')]
    private Location $location;

    #[ORM\Column(length: 20, enumType: ResourceVisibility::class)]
    private ResourceVisibility $visibility = ResourceVisibility::STAFF;

    #[ORM\Column]
    private bool $allowDoubleBooking = false;

    #[ORM\Column]
    private int $bufferMinutes = 0;

    public function __construct()
    {
        $this->id = Uuid::v7()->toRfc4122();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getClub(): Club
    {
        return $this->club;
    }

    public function setClub(Club $club): static
    {
        $this->club = $club;

        return $this;
    }

    public function getType(): ResourceType
    {
        return $this->type;
    }

    public function setType(ResourceType $type): static
    {
        $this->type = $type;

        return $this;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): static
    {
        $this->name = $name;

        return $this;
    }

    public function getLocation(): Location
    {
        return $this->location;
    }

    public function setLocation(Location $location): static
    {
        $this->location = $location;

        return $this;
    }

    public function getVisibility(): ResourceVisibility
    {
        return $this->visibility;
    }

    public function setVisibility(ResourceVisibility $visibility): static
    {
        $this->visibility = $visibility;

        return $this;
    }

    public function isAllowDoubleBooking(): bool
    {
        return $this->allowDoubleBooking;
    }

    public function setAllowDoubleBooking(bool $allowDoubleBooking): static
    {
        $this->allowDoubleBooking = $allowDoubleBooking;

        return $this;
    }

    public function getBufferMinutes(): int
    {
        return $this->bufferMinutes;
    }

    public function setBufferMinutes(int $bufferMinutes): static
    {
        $this->bufferMinutes = $bufferMinutes;

        return $this;
    }
}
