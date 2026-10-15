<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Routing\RouterInterface;
use Symfony\Component\Yaml\Yaml;

/**
 * Drift guard for the hand-written API reference `docs/api/openapi.yaml`: every Symfony route under `/api`
 * must be documented with the same method and path (path parameter names do not matter), every documented
 * operation must exist, and the document must be structurally sound (OpenAPI 3.1, responses everywhere,
 * resolvable `$ref`s, declared path parameters).
 */
class OpenApiSpecTest extends KernelTestCase
{
    private const string SPEC = __DIR__.'/../../../docs/api/openapi.yaml';
    private const array HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

    /** @var array<string, mixed>|null */
    private static ?array $spec = null;

    /** @return array<string, mixed> */
    private static function spec(): array
    {
        if (null === self::$spec) {
            self::assertFileExists(self::SPEC);
            $parsed = Yaml::parseFile(self::SPEC);
            self::assertIsArray($parsed);
            self::$spec = $parsed;
        }

        return self::$spec;
    }

    /** `/api/clubs/{clubId}` → `/api/clubs/{}` */
    private static function normalize(string $path): string
    {
        return (string) preg_replace('/\{[^}]+\}/', '{}', $path);
    }

    /** @return list<string> "METHOD /path" of the documented operations */
    private static function documentedOperations(): array
    {
        $operations = [];
        foreach (self::spec()['paths'] as $path => $item) {
            foreach (array_keys($item) as $method) {
                if (in_array($method, self::HTTP_METHODS, true)) {
                    $operations[] = strtoupper($method).' '.self::normalize($path);
                }
            }
        }

        return $operations;
    }

    /** @return list<string> "METHOD /path" of the Symfony routes under /api */
    private static function routedOperations(): array
    {
        self::bootKernel();
        /** @var RouterInterface $router */
        $router = static::getContainer()->get('router');
        $operations = [];
        foreach ($router->getRouteCollection() as $name => $route) {
            $path = $route->getPath();
            if ('/api' !== $path && !str_starts_with($path, '/api/')) {
                continue;
            }
            $methods = $route->getMethods();
            self::assertNotSame([], $methods, sprintf('Route "%s" (%s) accepts any method; restrict it so that it can be documented', $name, $path));
            foreach ($methods as $method) {
                $operations[] = $method.' '.self::normalize($path);
            }
        }

        return $operations;
    }

    public function testEveryApiRouteIsDocumented(): void
    {
        $missing = array_values(array_diff(self::routedOperations(), self::documentedOperations()));

        self::assertSame([], $missing, "Routes missing in docs/api/openapi.yaml:\n".implode("\n", $missing));
    }

    public function testEveryDocumentedOperationIsARoute(): void
    {
        $unknown = array_values(array_diff(self::documentedOperations(), self::routedOperations()));

        self::assertSame([], $unknown, "Operations in docs/api/openapi.yaml without a Symfony route:\n".implode("\n", $unknown));
    }

    public function testNoOperationIsDocumentedTwice(): void
    {
        $operations = self::documentedOperations();
        $duplicates = array_keys(array_filter(array_count_values($operations), fn (int $n) => $n > 1));

        self::assertSame([], $duplicates, 'Operations documented under two paths (same path, other parameter names)');
    }

    public function testDocumentStructure(): void
    {
        $spec = self::spec();
        self::assertMatchesRegularExpression('/^3\.1\.\d+$/', (string) ($spec['openapi'] ?? ''), 'openapi must be 3.1.x');
        self::assertNotEmpty($spec['info']['title'] ?? null);
        self::assertNotEmpty($spec['info']['version'] ?? null);
        self::assertNotEmpty($spec['paths'] ?? null);

        $operationIds = [];
        foreach ($spec['paths'] as $path => $item) {
            self::assertStringStartsWith('/api', $path);
            foreach ($item as $method => $operation) {
                if (!in_array($method, self::HTTP_METHODS, true)) {
                    continue;
                }
                $label = strtoupper($method).' '.$path;
                self::assertNotEmpty($operation['summary'] ?? null, "$label: summary missing");
                self::assertNotEmpty($operation['tags'] ?? null, "$label: tags missing");
                self::assertNotEmpty($operation['operationId'] ?? null, "$label: operationId missing");
                $operationIds[] = $operation['operationId'];
                self::assertIsArray($operation['responses'] ?? null, "$label: responses missing");
                self::assertNotEmpty($operation['responses'], "$label: responses missing");
                foreach (array_keys($operation['responses']) as $status) {
                    self::assertMatchesRegularExpression('/^([1-5]\d\d|[1-5]XX|default)$/', (string) $status, "$label: invalid status $status");
                }
                $this->assertPathParametersDeclared($spec, $path, $item, $operation, $label);
            }
        }
        self::assertSame(array_unique($operationIds), $operationIds, 'operationId must be unique');
    }

    public function testAllReferencesResolve(): void
    {
        $spec = self::spec();
        $unresolved = [];
        array_walk_recursive($spec, function (mixed $value, int|string $key) use ($spec, &$unresolved): void {
            if ('$ref' !== $key) {
                return;
            }
            if (!is_string($value) || null === self::resolve($spec, $value)) {
                $unresolved[] = (string) $value;
            }
        });

        self::assertSame([], array_values(array_unique($unresolved)), 'Unresolvable $ref');
    }

    public function testErrorSchemaCarriesCodeAndField(): void
    {
        $problem = self::spec()['components']['schemas']['Problem'] ?? null;
        self::assertIsArray($problem);
        self::assertArrayHasKey('code', $problem['properties']);
        self::assertArrayHasKey('field', $problem['properties']);
        self::assertSame(['type', 'title', 'status', 'detail'], $problem['required']);
    }

    /**
     * The `ErrorCode` enum of the spec and the codes of the code base stay in step: every enum value occurs as a
     * string literal in `src/` (no stale entries) and every literal code of `new ApiProblemException(…)` and of the
     * `…CODE` class constants is part of the enum (no undocumented code).
     */
    public function testErrorCodeEnumMatchesCodebase(): void
    {
        $enum = self::spec()['components']['schemas']['ErrorCode']['enum'] ?? null;
        self::assertIsArray($enum);
        self::assertSame(array_unique($enum), $enum, 'ErrorCode enum has duplicates');

        $literals = [];
        $codes = [];
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(__DIR__.'/../../src', \FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if ('php' !== $file->getExtension()) {
                continue;
            }
            $tokens = array_values(array_filter(
                \PhpToken::tokenize((string) file_get_contents($file->getPathname())),
                static fn (\PhpToken $t) => !$t->isIgnorable(),
            ));
            foreach ($tokens as $i => $token) {
                if ($token->is(T_CONSTANT_ENCAPSED_STRING)) {
                    $literals[trim($token->text, '\'"')] = true;
                }
                // const FOO_CODE = 'code';
                if ($token->is(T_CONST)) {
                    for ($j = $i + 1; $j < $i + 5 && isset($tokens[$j + 2]); ++$j) {
                        if ($tokens[$j]->is(T_STRING) && str_ends_with($tokens[$j]->text, 'CODE') && '=' === $tokens[$j + 1]->text && $tokens[$j + 2]->is(T_CONSTANT_ENCAPSED_STRING)) {
                            $codes[trim($tokens[$j + 2]->text, '\'"')] = $file->getFilename();
                        }
                    }
                }
                // new ApiProblemException(status, message, 'code', …)
                if ($token->is(T_NEW) && isset($tokens[$i + 2]) && 'ApiProblemException' === $tokens[$i + 1]->text && '(' === $tokens[$i + 2]->text) {
                    $depth = 0;
                    $arg = 0;
                    $third = [];
                    for ($j = $i + 2; isset($tokens[$j]); ++$j) {
                        $text = $tokens[$j]->text;
                        if (in_array($text, ['(', '[', '{'], true) || $tokens[$j]->is(T_CURLY_OPEN)) {
                            ++$depth;
                            if (1 === $depth) {
                                continue;
                            }
                        } elseif (in_array($text, [')', ']', '}'], true)) {
                            --$depth;
                            if (0 === $depth) {
                                break;
                            }
                        } elseif (',' === $text && 1 === $depth) {
                            ++$arg;
                            continue;
                        }
                        if (2 === $arg) {
                            $third[] = $tokens[$j];
                        }
                    }
                    if (1 === count($third) && $third[0]->is(T_CONSTANT_ENCAPSED_STRING)) {
                        $codes[trim($third[0]->text, '\'"')] = $file->getFilename();
                    }
                }
            }
        }

        $stale = array_values(array_filter($enum, static fn (string $code) => !isset($literals[$code])));
        self::assertSame([], $stale, 'ErrorCode values that no longer occur in src/: '.implode(', ', $stale));
        $undocumented = array_values(array_diff(array_keys($codes), $enum));
        self::assertSame([], $undocumented, 'Error codes used in src/ but missing in the ErrorCode enum of docs/api/openapi.yaml: '.implode(', ', $undocumented));
        self::assertNotEmpty($codes, 'No error codes found in src/ (scanner broken?)');
    }

    /** Every `{param}` of the path is declared as `in: path` at path or operation level (and nothing else). */
    private function assertPathParametersDeclared(array $spec, string $path, array $item, array $operation, string $label): void
    {
        preg_match_all('/\{([^}]+)\}/', $path, $matches);
        $declared = [];
        foreach (array_merge($item['parameters'] ?? [], $operation['parameters'] ?? []) as $parameter) {
            if (isset($parameter['$ref'])) {
                $parameter = self::resolve($spec, $parameter['$ref']);
                self::assertIsArray($parameter, "$label: unresolvable parameter");
            }
            if ('path' === ($parameter['in'] ?? null)) {
                self::assertTrue($parameter['required'] ?? false, "$label: path parameter {$parameter['name']} must be required");
                $declared[] = $parameter['name'];
            }
        }
        sort($declared);
        $expected = $matches[1];
        sort($expected);

        self::assertSame($expected, $declared, "$label: path parameters");
    }

    /** @return array<mixed>|null the target of a local `#/…` reference */
    private static function resolve(array $spec, string $ref): ?array
    {
        if (!str_starts_with($ref, '#/')) {
            return null;
        }
        $node = $spec;
        foreach (explode('/', substr($ref, 2)) as $part) {
            $part = str_replace(['~1', '~0'], ['/', '~'], $part);
            if (!is_array($node) || !array_key_exists($part, $node)) {
                return null;
            }
            $node = $node[$part];
        }

        return is_array($node) ? $node : null;
    }
}
