<?php

declare(strict_types=1);

namespace App\Pdf;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Maps a user-chosen property icon to a bundled Noto Emoji PNG. The icon is only reduced to a codepoint key and
 * looked up in the manifest; the returned path is built from the manifest entry, never from the input.
 */
class EmojiImages
{
    private const string KEY_PATTERN = '/^[0-9a-f]{2,6}(_[0-9a-f]{2,6}){0,9}$/';
    private const int MAX_BYTES = 64;

    /** @var array<string, true>|null */
    private ?array $manifest = null;

    public function __construct(
        #[Autowire('%kernel.project_dir%/assets/pdf/emoji')]
        private readonly string $emojiDir,
    ) {
    }

    public function resolve(string $icon): ?string
    {
        if ('' === $icon || \strlen($icon) > self::MAX_BYTES) {
            return null;
        }
        if (class_exists(\Normalizer::class)) {
            $icon = \Normalizer::normalize($icon, \Normalizer::FORM_C);
            if (false === $icon || '' === $icon) {
                return null;
            }
        }
        if (!mb_check_encoding($icon, 'UTF-8')) {
            return null;
        }

        $parts = [];
        foreach (mb_str_split($icon, 1, 'UTF-8') as $char) {
            $parts[] = \sprintf('%04x', mb_ord($char, 'UTF-8'));
        }

        $manifest = $this->manifest();
        foreach ([$parts, array_values(array_filter($parts, static fn (string $p): bool => 'fe0f' !== $p))] as $candidate) {
            if ([] === $candidate) {
                continue;
            }
            $key = implode('_', $candidate);
            if (1 === preg_match(self::KEY_PATTERN, $key) && isset($manifest[$key])) {
                return $this->emojiDir.'/emoji_u'.$key.'.png';
            }
        }

        return null;
    }

    /** @return array<string, true> */
    private function manifest(): array
    {
        if (null === $this->manifest) {
            $this->manifest = [];
            $raw = @file_get_contents($this->emojiDir.'/manifest.json');
            $list = false === $raw ? [] : json_decode($raw, true);
            foreach (\is_array($list) ? $list : [] as $entry) {
                if (\is_string($entry) && 1 === preg_match(self::KEY_PATTERN, $entry)) {
                    $this->manifest[$entry] = true;
                }
            }
        }

        return $this->manifest;
    }
}
