<?php

declare(strict_types=1);

namespace App\Tests\Telemetry;

use App\Telemetry\McpCallMetrics;
use App\Telemetry\McpCallMetricsHandler;
use App\Telemetry\Telemetry;
use App\Telemetry\TelemetryConfig;
use Mcp\Capability\Attribute\McpTool;
use OpenTelemetry\SDK\Metrics\MetricExporter\InMemoryExporter;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

final class McpCallMetricsTest extends KernelTestCase
{
    /** @return array<string, string> tool => access, from the container (what the pass collected) */
    private function containerTools(): array
    {
        self::bootKernel();
        $service = self::getContainer()->get(McpCallMetrics::class);
        $p = new \ReflectionProperty($service, 'tools');

        return $p->getValue($service);
    }

    public function testEveryRegisteredToolIsSeededWithItsAccess(): void
    {
        $expected = [];
        foreach (glob(__DIR__.'/../../src/Mcp/Tool/*Tool.php') as $file) {
            $class = 'App\\Mcp\\Tool\\'.basename($file, '.php');
            $attr = (new \ReflectionClass($class))->getAttributes(McpTool::class)[0]->newInstance();
            $src = (string) file_get_contents($file);
            $expected[$attr->name] = str_contains($src, 'requireScope(McpScope::Write)') ? 'write' : 'read';
        }
        $this->assertNotEmpty($expected);
        $this->assertEqualsCanonicalizing($expected, $this->containerTools());
    }

    public function testInitializeSendsZeroForEveryToolAndOutcome(): void
    {
        $config = new TelemetryConfig('http://x');
        $storage = new \ArrayObject();
        $telemetry = new Telemetry($config, null, new InMemoryExporter($storage, $config->temporality));
        (new McpCallMetrics($telemetry, ['list_clubs' => 'read', 'create_feed' => 'write']))->initialize();
        $telemetry->flush();

        $seen = [];
        foreach ($storage as $metric) {
            if (McpCallMetricsHandler::NAME !== $metric->name) {
                continue;
            }
            foreach ($metric->data->dataPoints as $p) {
                $a = $p->attributes->toArray();
                $seen[] = $a['tool'].'/'.$a['access'].'/'.$a['outcome'].'='.$p->value;
            }
        }
        sort($seen);
        $this->assertSame(['create_feed/write/error=0', 'create_feed/write/ok=0', 'list_clubs/read/error=0', 'list_clubs/read/ok=0'], $seen);
    }

    public function testFeedCounterIsSeededForEveryValidCombination(): void
    {
        $config = new TelemetryConfig('http://x');
        $storage = new \ArrayObject();
        $telemetry = new Telemetry($config, null, new InMemoryExporter($storage, $config->temporality));
        (new \App\Telemetry\FeedRequestMetrics($telemetry))->initialize();
        $telemetry->flush();

        $n = 0;
        foreach ($storage as $metric) {
            if (\App\Telemetry\FeedRequestMetrics::NAME === $metric->name) {
                foreach ($metric->data->dataPoints as $p) {
                    $this->assertSame(0, $p->value);
                    ++$n;
                }
            }
        }
        $this->assertSame(3 * 5 + 2, $n);
    }
}
