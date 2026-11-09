<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\OpaqueException;
use App\Opaque\OpaqueRollout;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Uid\Uuid;

class OpaqueRolloutTest extends TestCase
{
    private static function rollout(string $percent = '0', string $cutoff = '', bool $enabled = true, string $secret = 'secret'): OpaqueRollout
    {
        return new OpaqueRollout($enabled, $percent, $cutoff, $secret);
    }

    public function testBucketIsDeterministicAndKeyed(): void
    {
        $id = Uuid::v7()->toRfc4122();

        self::assertSame(self::rollout()->bucket($id), self::rollout('50')->bucket($id));
        $differs = false;
        for ($i = 0; $i < 20 && !$differs; ++$i) {
            $id = Uuid::v7()->toRfc4122();
            $differs = self::rollout()->bucket($id) !== self::rollout(secret: 'other')->bucket($id);
        }
        self::assertTrue($differs, 'the bucket depends on APP_SECRET');
    }

    public function testBucketIsRoughlyUniform(): void
    {
        $rollout = self::rollout();
        $deciles = array_fill(0, 10, 0);
        $n = 20000;
        for ($i = 0; $i < $n; ++$i) {
            $bucket = $rollout->bucket(Uuid::v7()->toRfc4122());
            self::assertGreaterThanOrEqual(0, $bucket);
            self::assertLessThan(100, $bucket);
            ++$deciles[intdiv($bucket, 10)];
        }
        foreach ($deciles as $count) {
            self::assertEqualsWithDelta($n / 10, $count, $n / 10 * 0.1);
        }
    }

    public function testEveryoneIsOfferedTheUpgradeOnceACutoffIsSet(): void
    {
        $ids = array_map(static fn () => Uuid::v7()->toRfc4122(), range(1, 200));

        self::assertCount(200, array_filter($ids, self::rollout('0', '2026-12-31')->offersUpgrade(...)));
        self::assertCount(0, array_filter($ids, self::rollout('0', '2026-12-31', false)->offersUpgrade(...)));
        self::assertTrue(OpaqueRollout::cutoffNeedsFullRollout('99', '2026-12-31'));
        self::assertFalse(OpaqueRollout::cutoffNeedsFullRollout('100', '2026-12-31'));
        self::assertFalse(OpaqueRollout::cutoffNeedsFullRollout('0', ''));
    }

    public function testOfferShareFollowsPercentageAndOnlyGrows(): void
    {
        $ids = array_map(static fn () => Uuid::v7()->toRfc4122(), range(1, 5000));
        $previous = [];
        foreach ([0, 10, 50, 100] as $percent) {
            $rollout = self::rollout((string) $percent);
            $in = array_filter($ids, $rollout->offersUpgrade(...));
            self::assertEqualsWithDelta($percent / 100 * count($ids), count($in), 150);
            self::assertSame([], array_diff($previous, $in), 'accounts stay in when the percentage rises');
            $previous = $in;
        }
        self::assertCount(0, array_filter($ids, self::rollout('0')->offersUpgrade(...)));
        self::assertCount(5000, array_filter($ids, self::rollout('100')->offersUpgrade(...)));
    }

    public function testNothingIsOfferedWhenDisabled(): void
    {
        self::assertFalse(self::rollout('100', '', false)->offersUpgrade(Uuid::v7()->toRfc4122()));
    }

    public function testCutoffStartsAtMidnightUtc(): void
    {
        $rollout = self::rollout('0', '2026-12-31');
        $utc = new \DateTimeZone('UTC');

        self::assertFalse($rollout->cutoffReached(new \DateTimeImmutable('2026-12-30 23:59:59', $utc)));
        self::assertTrue($rollout->cutoffReached(new \DateTimeImmutable('2026-12-31 00:00:00', $utc)));
        self::assertFalse(self::rollout()->cutoffReached(new \DateTimeImmutable('2999-01-01', $utc)));
    }

    /** @return iterable<string, array{string, string}> */
    public static function invalid(): iterable
    {
        yield 'empty percent' => ['', ''];
        yield 'percent 101' => ['101', ''];
        yield 'leading zero' => ['05', ''];
        yield 'signed' => ['+5', ''];
        yield 'text' => ['abc', ''];
        yield 'cutoff dd.mm.yyyy' => ['0', '31.12.2026'];
        yield 'cutoff month 13' => ['0', '2026-13-01'];
        yield 'cutoff trailing' => ['0', '2026-12-31 '];
    }

    #[DataProvider('invalid')]
    public function testInvalidValuesAreRejected(string $percent, string $cutoff): void
    {
        $this->expectException(OpaqueException::class);
        self::rollout($percent, $cutoff);
    }
}
