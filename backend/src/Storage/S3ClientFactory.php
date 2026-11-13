<?php

declare(strict_types=1);

namespace App\Storage;

use Aws\S3\S3Client;

/**
 * Builds the S3 client of the S3 storage from the S3_* settings. It is only created when the S3 source is used,
 * a malformed SSE-C key therefore fails at first use. `create()` adds the SSE-C parameters to every operation;
 * `createRaw()` does not (the key rotation sets old and new keys per request).
 */
final class S3ClientFactory
{
    public function __construct(
        private readonly string $endpoint,
        private readonly string $region,
        private readonly string $accessKey,
        #[\SensitiveParameter] private readonly string $secretKey,
        private readonly bool $pathStyle,
        #[\SensitiveParameter] private readonly string $sseCKey,
    ) {
    }

    public function create(): S3Client
    {
        return $this->build(true);
    }

    public function createRaw(): S3Client
    {
        return $this->build(false);
    }

    /** @param array<string, mixed> $overrides extra S3Client options (tests: handler, credentials) */
    public function build(bool $withSseC, array $overrides = []): S3Client
    {
        $config = [
            'version' => '2006-03-01',
            'region' => '' !== trim($this->region) ? trim($this->region) : 'us-east-1',
            'use_path_style_endpoint' => $this->pathStyle,
        ];
        if ('' !== trim($this->endpoint)) {
            $config['endpoint'] = trim($this->endpoint);
        }
        // Without explicit credentials the SDK's default chain applies (instance or task role, AWS_* variables)
        if ('' !== $this->accessKey && '' !== $this->secretKey) {
            $config['credentials'] = ['key' => $this->accessKey, 'secret' => $this->secretKey];
        }

        $sseC = $withSseC && '' !== trim($this->sseCKey) ? SseCKey::fromBase64($this->sseCKey) : null;
        $client = new S3Client($overrides + $config);
        if (null !== $sseC) {
            $client->getHandlerList()->prependInit(SseCMiddleware::create($sseC), 'app.sse_c');
        }

        return $client;
    }
}
