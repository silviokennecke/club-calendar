<?php

declare(strict_types=1);

namespace App\Ics;

use Eluceo\iCal\Domain\Entity\Event;
use Eluceo\iCal\Presentation\Component\Property;
use Eluceo\iCal\Presentation\Component\Property\Parameter;
use Eluceo\iCal\Presentation\Component\Property\Value\AppleLocationGeoValue;
use Eluceo\iCal\Presentation\Component\Property\Value\IntegerValue;
use Eluceo\iCal\Presentation\Component\Property\Value\TextValue;
use Eluceo\iCal\Presentation\Factory\EventFactory as BaseEventFactory;

/**
 * The library writes the X-APPLE-STRUCTURED-LOCATION parameters X-TITLE and X-ADDRESS as unquoted text, so a
 * location name with `;`, `:` or `"` could add parameters or end the parameter list. They are replaced by
 * properties with quoted, sanitized parameter values; everything else is rendered (escaped, folded) by the library.
 */
final class EventFactory extends BaseEventFactory
{
    private const APPLE_PROPERTY = 'X-APPLE-STRUCTURED-LOCATION';

    protected function getProperties(Event $event): \Generator
    {
        foreach (parent::getProperties($event) as $property) {
            if (!str_starts_with((string) $property, self::APPLE_PROPERTY)) {
                yield $property;
                continue;
            }
            $location = $event->getLocation();
            if (null === $location || !$location->hasGeographicalPosition()) {
                continue;
            }
            yield new Property(
                self::APPLE_PROPERTY,
                new AppleLocationGeoValue($location->getGeographicPosition()),
                [
                    new Parameter('VALUE', new TextValue('URI')),
                    new Parameter('X-ADDRESS', new QuotedParameterValue(str_replace("\n", '\\n', (string) $location))),
                    new Parameter('X-APPLE-RADIUS', new IntegerValue(100)),
                    new Parameter('X-TITLE', new QuotedParameterValue($location->getTitle())),
                ],
            );
        }
    }
}
