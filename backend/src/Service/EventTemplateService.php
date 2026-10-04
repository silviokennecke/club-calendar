<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\EventTemplate;
use App\Entity\EventTemplateFeature;
use App\Entity\EventTemplateProperty;
use App\Entity\EventTemplateTargetGroup;
use App\Entity\Feature;
use App\Entity\Location;
use App\Entity\Property;
use App\Entity\TargetGroup;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class EventTemplateService
{
    public function __construct(
        private EntityManagerInterface $em,
        private CalendarReferences $references,
    ) {
    }

    public function listTemplates(Calendar $calendar): array
    {
        $templates = $this->em->getRepository(EventTemplate::class)->findBy(['calendar' => $calendar]);

        return array_map(fn (EventTemplate $t) => $this->serialize($t), $templates);
    }

    public function createTemplate(Calendar $calendar, array $data): array
    {
        $template = new EventTemplate();
        $template->setCalendar($calendar);
        $this->applyInput($template, $calendar, $data, false);
        $this->em->persist($template);
        $this->em->flush();

        return $this->serialize($template);
    }

    public function getTemplate(string $id, Calendar $calendar): array
    {
        $template = $this->findTemplate($id, $calendar);

        return $this->serialize($template);
    }

    public function updateTemplate(string $id, Calendar $calendar, array $data): array
    {
        $template = $this->findTemplate($id, $calendar);
        $this->applyInput($template, $calendar, $data, true);
        $this->em->flush();

        return $this->serialize($template);
    }

    public function deleteTemplate(string $id, Calendar $calendar): void
    {
        $template = $this->findTemplate($id, $calendar);
        $this->em->remove($template);
        $this->em->flush();
    }

    private function findTemplate(string $id, Calendar $calendar): EventTemplate
    {
        $template = $this->em->getRepository(EventTemplate::class)->find($id);
        if (!$template || $template->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Event template not found');
        }

        return $template;
    }

    /**
     * Validates and applies request data; referenced records must belong to the template's calendar (422).
     *
     * @param bool $partial PATCH: only the given keys are applied, nothing is required
     */
    private function applyInput(EventTemplate $template, Calendar $calendar, array $data, bool $partial): void
    {
        $has = fn (string $key) => !$partial || array_key_exists($key, $data);

        if ($has('name')) {
            $template->setName(Input::string($data, 'name'));
        }
        if ($has('timezone')) {
            $template->setTimezone((string) Input::timezone($data, 'timezone', false));
        }
        if ($has('timeBegin')) {
            $template->setTimeBegin(Input::time($data, 'timeBegin'));
        }
        if ($has('timeEnd')) {
            $template->setTimeEnd(Input::time($data, 'timeEnd'));
        }
        if ($has('locationId')) {
            $template->setLocation($this->references->find(Location::class, $calendar, $data['locationId'] ?? null, 'locationId'));
        }

        if ($has('propertyIds')) {
            $properties = $this->references->findAll(Property::class, $calendar, Input::idList($data, 'propertyIds'), 'propertyIds');
            LinkCollectionSync::sync(
                $this->em,
                $template->getProperties(),
                array_keys($properties),
                fn (EventTemplateProperty $etp) => $etp->getProperty()->getId(),
                fn (string $id) => (new EventTemplateProperty())->setTemplate($template)->setProperty($properties[$id]),
            );
        }
        if ($has('featureIds')) {
            $features = $this->references->findAll(Feature::class, $calendar, Input::idList($data, 'featureIds'), 'featureIds');
            LinkCollectionSync::sync(
                $this->em,
                $template->getFeatures(),
                array_keys($features),
                fn (EventTemplateFeature $etf) => $etf->getFeature()->getId(),
                fn (string $id) => (new EventTemplateFeature())->setTemplate($template)->setFeature($features[$id]),
            );
        }
        if ($has('targetGroupIds')) {
            $groups = $this->references->findAll(TargetGroup::class, $calendar, Input::idList($data, 'targetGroupIds'), 'targetGroupIds');
            LinkCollectionSync::sync(
                $this->em,
                $template->getTargetGroups(),
                array_keys($groups),
                fn (EventTemplateTargetGroup $ettg) => $ettg->getTargetGroup()->getId(),
                fn (string $id) => (new EventTemplateTargetGroup())->setTemplate($template)->setTargetGroup($groups[$id]),
            );
        }
    }

    public function serialize(EventTemplate $template): array
    {
        return [
            'id' => $template->getId(),
            'calendarId' => $template->getCalendar()->getId(),
            'locationId' => $template->getLocation()?->getId(),
            'name' => $template->getName(),
            'timezone' => $template->getTimezone(),
            'timeBegin' => $template->getTimeBegin(),
            'timeEnd' => $template->getTimeEnd(),
            'location' => $template->getLocation() ? [
                'id' => $template->getLocation()->getId(),
                'name' => $template->getLocation()->getName(),
                'street' => $template->getLocation()->getStreet(),
                'zip' => $template->getLocation()->getZip(),
                'city' => $template->getLocation()->getCity(),
                'country' => $template->getLocation()->getCountry(),
                'latitude' => $template->getLocation()->getLatitude(),
                'longitude' => $template->getLocation()->getLongitude(),
            ] : null,
            'properties' => $template->getProperties()->map(fn ($etp) => [
                'propertyId' => $etp->getProperty()->getId(),
                'property' => [
                    'id' => $etp->getProperty()->getId(),
                    'name' => $etp->getProperty()->getName(),
                    'icon' => $etp->getProperty()->getIcon(),
                ],
            ])->getValues(),
            'features' => $template->getFeatures()->map(fn ($etf) => [
                'featureId' => $etf->getFeature()->getId(),
                'feature' => [
                    'id' => $etf->getFeature()->getId(),
                    'name' => $etf->getFeature()->getName(),
                ],
            ])->getValues(),
            'targetGroups' => $template->getTargetGroups()->map(fn ($ettg) => [
                'targetGroupId' => $ettg->getTargetGroup()->getId(),
                'targetGroup' => [
                    'id' => $ettg->getTargetGroup()->getId(),
                    'name' => $ettg->getTargetGroup()->getName(),
                ],
            ])->getValues(),
        ];
    }
}
