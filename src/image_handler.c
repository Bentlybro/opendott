/*
 * OpenDOTT - Image Handler
 * SPDX-License-Identifier: MIT
 * 
 * Image format detection, validation, and decoding.
 * 
 * THIS IS THE KEY DIFFERENCE FROM THE ORIGINAL FIRMWARE:
 * We actually validate images BEFORE writing them to flash.
 * Novel concept, I know.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <string.h>

#include "opendott.h"

LOG_MODULE_REGISTER(image_handler, CONFIG_LOG_DEFAULT_LEVEL);

/* Magic byte sequences for format detection */
static const uint8_t gif89a_magic[] = {0x47, 0x49, 0x46, 0x38, 0x39, 0x61}; /* GIF89a */
static const uint8_t gif87a_magic[] = {0x47, 0x49, 0x46, 0x38, 0x37, 0x61}; /* GIF87a */
static const uint8_t png_magic[]    = {0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};
static const uint8_t jpeg_magic[]   = {0xFF, 0xD8, 0xFF};
static const uint8_t bmp_magic[]    = {0x42, 0x4D}; /* BM */

/**
 * Detect image format from magic bytes
 * 
 * Unlike the original firmware, we CHECK this BEFORE accepting the image.
 * Crazy, right?
 */
image_format_t image_detect_format(const uint8_t *data, size_t size)
{
    if (!data || size < 8) {
        return IMAGE_FORMAT_UNKNOWN;
    }

    /* Check GIF (most common for DOTT) */
    if (size >= 6) {
        if (memcmp(data, gif89a_magic, 6) == 0 ||
            memcmp(data, gif87a_magic, 6) == 0) {
            return IMAGE_FORMAT_GIF;
        }
    }

    /* Check PNG */
    if (size >= 8 && memcmp(data, png_magic, 8) == 0) {
        return IMAGE_FORMAT_PNG;
    }

    /* Check JPEG */
    if (size >= 3 && memcmp(data, jpeg_magic, 3) == 0) {
        return IMAGE_FORMAT_JPEG;
    }

    /* Check BMP */
    if (size >= 2 && memcmp(data, bmp_magic, 2) == 0) {
        return IMAGE_FORMAT_BMP;
    }

    LOG_WRN("Unknown format, magic: %02x %02x %02x %02x",
            data[0], data[1], data[2], data[3]);
    return IMAGE_FORMAT_UNKNOWN;
}

const char *image_format_to_string(image_format_t format)
{
    switch (format) {
    case IMAGE_FORMAT_GIF:     return "GIF";
    case IMAGE_FORMAT_PNG:     return "PNG";
    case IMAGE_FORMAT_JPEG:    return "JPEG";
    case IMAGE_FORMAT_BMP:     return "BMP";
    default:                   return "UNKNOWN";
    }
}

/**
 * Validate image data
 * 
 * This function does what the original firmware SHOULD have done:
 * Actually check if the data is valid before trying to use it.
 */
bool image_validate(const uint8_t *data, size_t size)
{
    if (!data || size == 0) {
        LOG_ERR("Null or empty data");
        return false;
    }

    if (size > MAX_IMAGE_SIZE) {
        LOG_ERR("Image too large: %zu > %d", size, MAX_IMAGE_SIZE);
        return false;
    }

    /* Detect format */
    image_format_t format = image_detect_format(data, size);
    if (format == IMAGE_FORMAT_UNKNOWN) {
        LOG_ERR("Unknown/unsupported image format");
        LOG_ERR("Expected: GIF, PNG, JPEG, or BMP");
        LOG_ERR("Got magic bytes: %02x %02x %02x %02x %02x %02x",
                data[0], data[1], data[2], data[3], data[4], data[5]);
        return false;
    }

    LOG_INF("Detected format: %s", image_format_to_string(format));

    /* Format-specific validation */
    switch (format) {
    case IMAGE_FORMAT_GIF:
        return validate_gif(data, size);
    case IMAGE_FORMAT_PNG:
        return validate_png(data, size);
    case IMAGE_FORMAT_JPEG:
        return validate_jpeg(data, size);
    case IMAGE_FORMAT_BMP:
        return validate_bmp(data, size);
    default:
        return false;
    }
}

/* GIF validation */
static bool validate_gif(const uint8_t *data, size_t size)
{
    /* Minimum GIF size: header(6) + LSD(7) + trailer(1) = 14 bytes */
    if (size < 14) {
        LOG_ERR("GIF too small: %zu bytes", size);
        return false;
    }

    /* Check for trailer byte (0x3B) */
    if (data[size - 1] != 0x3B) {
        LOG_WRN("GIF missing trailer byte, may be truncated");
        /* Still allow it - some GIFs are malformed but displayable */
    }

    /* Read Logical Screen Descriptor */
    uint16_t width = data[6] | (data[7] << 8);
    uint16_t height = data[8] | (data[9] << 8);

    LOG_INF("GIF dimensions: %dx%d", width, height);

    /* Sanity check dimensions */
    if (width == 0 || height == 0 || width > 4096 || height > 4096) {
        LOG_ERR("Invalid GIF dimensions: %dx%d", width, height);
        return false;
    }

    return true;
}

/* PNG validation */
static bool validate_png(const uint8_t *data, size_t size)
{
    /* Minimum PNG size */
    if (size < 33) {  /* 8 header + 25 minimum IHDR chunk */
        LOG_ERR("PNG too small: %zu bytes", size);
        return false;
    }

    /* Check IHDR chunk type at offset 12-15 */
    if (memcmp(data + 12, "IHDR", 4) != 0) {
        LOG_ERR("PNG missing IHDR chunk");
        return false;
    }

    /* Read dimensions from IHDR (big-endian) */
    uint32_t width = (data[16] << 24) | (data[17] << 16) | 
                     (data[18] << 8) | data[19];
    uint32_t height = (data[20] << 24) | (data[21] << 16) | 
                      (data[22] << 8) | data[23];

    LOG_INF("PNG dimensions: %dx%d", width, height);

    if (width == 0 || height == 0 || width > 4096 || height > 4096) {
        LOG_ERR("Invalid PNG dimensions: %dx%d", width, height);
        return false;
    }

    return true;
}

/* JPEG validation */
static bool validate_jpeg(const uint8_t *data, size_t size)
{
    /* Check for proper JPEG structure */
    if (size < 10) {
        LOG_ERR("JPEG too small: %zu bytes", size);
        return false;
    }

    /* Should start with FFD8FF */
    if (data[0] != 0xFF || data[1] != 0xD8 || data[2] != 0xFF) {
        LOG_ERR("Invalid JPEG header");
        return false;
    }

    /* Look for end marker FFD9 */
    if (data[size - 2] != 0xFF || data[size - 1] != 0xD9) {
        LOG_WRN("JPEG missing end marker, may be truncated");
    }

    LOG_INF("JPEG appears valid, size: %zu bytes", size);
    return true;
}

/* BMP validation */
static bool validate_bmp(const uint8_t *data, size_t size)
{
    if (size < 54) {  /* Minimum BMP header size */
        LOG_ERR("BMP too small: %zu bytes", size);
        return false;
    }

    /* Read dimensions from header */
    int32_t width = data[18] | (data[19] << 8) | 
                    (data[20] << 16) | (data[21] << 24);
    int32_t height = data[22] | (data[23] << 8) | 
                     (data[24] << 16) | (data[25] << 24);

    /* Height can be negative (top-down BMP) */
    if (height < 0) height = -height;

    LOG_INF("BMP dimensions: %dx%d", width, height);

    if (width <= 0 || height == 0 || width > 4096 || height > 4096) {
        LOG_ERR("Invalid BMP dimensions: %dx%d", width, height);
        return false;
    }

    return true;
}

/**
 * Decode and display an image
 * 
 * This handles the actual image decoding and rendering to the display.
 */
int image_decode_and_display(const uint8_t *data, size_t size)
{
    /* First, validate */
    if (!image_validate(data, size)) {
        LOG_ERR("Image validation failed - NOT displaying");
        LOG_ERR("(This is what the original firmware should have done)");
        return OPENDOTT_ERR_INVALID_FORMAT;
    }

    image_format_t format = image_detect_format(data, size);

    switch (format) {
    case IMAGE_FORMAT_GIF:
        return decode_and_display_gif(data, size);
    case IMAGE_FORMAT_PNG:
        LOG_WRN("PNG decoding not yet implemented");
        return OPENDOTT_ERR_DECODE_FAILED;
    case IMAGE_FORMAT_JPEG:
        LOG_WRN("JPEG decoding not yet implemented");
        return OPENDOTT_ERR_DECODE_FAILED;
    case IMAGE_FORMAT_BMP:
        LOG_WRN("BMP decoding not yet implemented");
        return OPENDOTT_ERR_DECODE_FAILED;
    default:
        return OPENDOTT_ERR_INVALID_FORMAT;
    }
}

/* GIF decoder (simplified - needs full implementation) */
static int decode_and_display_gif(const uint8_t *data, size_t size)
{
    LOG_INF("Decoding GIF (%zu bytes)...", size);

    /* TODO: Implement proper GIF decoder
     * Options:
     * 1. Port AnimatedGIF library (what original uses)
     * 2. Use gifdec or similar lightweight decoder
     * 3. Write our own minimal decoder
     * 
     * For now, this is a placeholder
     */

    /* Read basic GIF info */
    uint16_t width = data[6] | (data[7] << 8);
    uint16_t height = data[8] | (data[9] << 8);
    uint8_t packed = data[10];
    bool has_gct = (packed & 0x80) != 0;
    int gct_size = 1 << ((packed & 0x07) + 1);

    LOG_INF("GIF: %dx%d, global color table: %s (%d colors)",
            width, height, has_gct ? "yes" : "no", gct_size);

    /* TODO: Actually decode frames and display them */
    LOG_WRN("Full GIF decoding not yet implemented");

    return 0;
}
