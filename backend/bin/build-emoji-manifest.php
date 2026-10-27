#!/usr/bin/env php
<?php

declare(strict_types=1);

// Regenerates assets/pdf/emoji/manifest.json: sorted keys of the bundled emoji_u<key>.png files.
$dir = dirname(__DIR__).'/assets/pdf/emoji';
$keys = [];
foreach (glob($dir.'/emoji_u*.png') ?: [] as $file) {
    $keys[] = substr(basename($file), 7, -4);
}
sort($keys, SORT_STRING);
file_put_contents($dir.'/manifest.json', json_encode($keys, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)."\n");
echo count($keys)." entries\n";
