<?php

declare(strict_types=1);

/*
 * Generates assets/map-unavailable.png: the blurred, text-free map shown instead of a location map
 * while no map service is configured (MAPBOX_TOKEN empty, MapController answers 503 with this image).
 * Deterministic (fixed seed, no external input); needs ext-gd only when (re)generating:
 *
 *   php assets/generate-map-unavailable.php
 */

const WIDTH = 400;   // half of map.image.width/height (800x288): the image is blurred anyway
const HEIGHT = 144;
const SKETCH_SCALE = 4; // drawn at 1/4 size and scaled up (bilinear) = the blur

mt_srand(20261015, MT_RAND_MT19937);

$w = intdiv(WIDTH, SKETCH_SCALE);
$h = intdiv(HEIGHT, SKETCH_SCALE);
$img = imagecreatetruecolor($w, $h);
$color = static fn (int $rgb): int => (int) imagecolorallocate($img, ($rgb >> 16) & 0xFF, ($rgb >> 8) & 0xFF, $rgb & 0xFF);

$land = $color(0xECE8E1);
$block = $color(0xE2DDD4);
$park = $color(0xD3E2C6);
$water = $color(0xB9D3E6);
$road = $color(0xFAF8F5);
$major = $color(0xF3E3B5);

imagefilledrectangle($img, 0, 0, $w - 1, $h - 1, $land);

// building blocks
for ($i = 0; $i < 40; ++$i) {
    $x = mt_rand(0, $w);
    $y = mt_rand(0, $h);
    imagefilledrectangle($img, $x, $y, $x + mt_rand(3, 9), $y + mt_rand(2, 6), $block);
}

// two parks
imagefilledellipse($img, 18, 26, 22, 14, $park);
imagefilledellipse($img, 80, 8, 18, 12, $park);

// river from left to right
$points = [];
for ($x = -2; $x <= $w + 2; $x += 4) {
    $points[] = [$x, (int) round(30 + 4 * sin($x / 9))];
}
imagesetthickness($img, 4);
for ($i = 1, $n = count($points); $i < $n; ++$i) {
    imageline($img, $points[$i - 1][0], $points[$i - 1][1], $points[$i][0], $points[$i][1], $water);
}

// street grid, slightly tilted, and two main roads
imagesetthickness($img, 1);
for ($x = 4; $x < $w + 10; $x += mt_rand(7, 12)) {
    imageline($img, $x, 0, $x - 6, $h, $road);
}
for ($y = 3; $y < $h; $y += mt_rand(6, 9)) {
    imageline($img, 0, $y, $w, $y + 2, $road);
}
imagesetthickness($img, 2);
imageline($img, 0, 12, $w, 20, $major);
imageline($img, 58, 0, 46, $h, $major);

$scaled = imagescale($img, WIDTH, HEIGHT, IMG_BILINEAR_FIXED);
if (false === $scaled) {
    throw new RuntimeException('Scaling failed');
}
for ($i = 0; $i < 14; ++$i) {
    imagefilter($scaled, IMG_FILTER_GAUSSIAN_BLUR);
}

// palette + no metadata keeps the file small (a few KB)
imagetruecolortopalette($scaled, false, 48);
imagepng($scaled, __DIR__.'/map-unavailable.png', 9);
echo 'Written '.__DIR__.'/map-unavailable.png ('.filesize(__DIR__.'/map-unavailable.png')." bytes)\n";
