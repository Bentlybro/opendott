/*
 * OpenDOTT - Main Header
 * SPDX-License-Identifier: MIT
 */

#ifndef OPENDOTT_H
#define OPENDOTT_H

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

/* Version info */
#define OPENDOTT_VERSION_MAJOR 0
#define OPENDOTT_VERSION_MINOR 1
#define OPENDOTT_VERSION_PATCH 0
#define OPENDOTT_VERSION_STRING "0.1.0"

/* Display dimensions */
#define DISPLAY_WIDTH  240
#define DISPLAY_HEIGHT 240
#define DISPLAY_PIXEL_FORMAT PIXEL_FORMAT_RGB_565
#define DISPLAY_BPP 2  /* Bytes per pixel for RGB565 */

/* Image handling */
#define MAX_IMAGE_SIZE (1024 * 1024)  /* 1MB max per image */
#define IMAGE_CHUNK_SIZE 512          /* BLE transfer chunk size */

/* Supported image formats (magic bytes) */
#define GIF_MAGIC_89A "GIF89a"
#define GIF_MAGIC_87A "GIF87a"
#define PNG_MAGIC "\x89PNG\r\n\x1a\n"
#define JPEG_MAGIC "\xff\xd8\xff"
#define BMP_MAGIC "BM"

/* Image format enumeration */
typedef enum {
    IMAGE_FORMAT_UNKNOWN = 0,
    IMAGE_FORMAT_GIF,
    IMAGE_FORMAT_PNG,
    IMAGE_FORMAT_JPEG,
    IMAGE_FORMAT_BMP,
} image_format_t;

/* Transfer state */
typedef enum {
    TRANSFER_IDLE = 0,
    TRANSFER_IN_PROGRESS,
    TRANSFER_COMPLETE,
    TRANSFER_ERROR,
} transfer_state_t;

/* Error codes */
typedef enum {
    OPENDOTT_OK = 0,
    OPENDOTT_ERR_INVALID_FORMAT = -1,
    OPENDOTT_ERR_FILE_TOO_LARGE = -2,
    OPENDOTT_ERR_FLASH_WRITE = -3,
    OPENDOTT_ERR_FLASH_READ = -4,
    OPENDOTT_ERR_DECODE_FAILED = -5,
    OPENDOTT_ERR_DISPLAY = -6,
    OPENDOTT_ERR_NO_MEMORY = -7,
    OPENDOTT_ERR_BUSY = -8,
} opendott_err_t;

/* Button events */
typedef enum {
    BUTTON_EVENT_SHORT_PRESS,
    BUTTON_EVENT_MEDIUM_PRESS,  /* 1-3 seconds */
    BUTTON_EVENT_LONG_PRESS,    /* >3 seconds */
} button_event_t;

/* Callback types */
typedef void (*button_callback_t)(button_event_t event);
typedef void (*transfer_callback_t)(transfer_state_t state, int progress);

/* Module initialization functions */
int display_init(void);
int storage_init(void);
int ble_service_init(void);
int button_init(button_callback_t callback);

/* Display functions */
int display_show_image(const char *path);
int display_set_brightness(uint8_t brightness);
int display_clear(void);
int display_draw_buffer(uint16_t *buffer, uint16_t x, uint16_t y, 
                        uint16_t width, uint16_t height);

/* Storage functions */
int storage_save_image(const uint8_t *data, size_t size, const char *name);
int storage_load_image(const char *name, uint8_t **data, size_t *size);
int storage_delete_image(const char *name);
int storage_list_images(char *list[], size_t max_count);
int storage_get_free_space(size_t *free_bytes);
int storage_format(void);

/* Image handling functions */
image_format_t image_detect_format(const uint8_t *data, size_t size);
const char *image_format_to_string(image_format_t format);
bool image_validate(const uint8_t *data, size_t size);
int image_decode_and_display(const uint8_t *data, size_t size);

/* BLE functions */
int ble_start_advertising(void);
int ble_stop_advertising(void);
bool ble_is_connected(void);
void ble_set_transfer_callback(transfer_callback_t callback);

#endif /* OPENDOTT_H */
