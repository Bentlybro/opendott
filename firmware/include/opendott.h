/*
 * OpenDOTT - Header File
 * SPDX-License-Identifier: MIT
 */

#ifndef OPENDOTT_H
#define OPENDOTT_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

/* Display constants */
#define DISPLAY_WIDTH  240
#define DISPLAY_HEIGHT 240
#define DISPLAY_BPP    2  /* RGB565 = 2 bytes per pixel */

/* Maximum image size (16MB external flash) */
#define MAX_IMAGE_SIZE (16 * 1024 * 1024)

/* Error codes */
enum opendott_error {
    OPENDOTT_OK = 0,
    OPENDOTT_ERR_INVALID_FORMAT = -1,
    OPENDOTT_ERR_FILE_TOO_LARGE = -2,
    OPENDOTT_ERR_FLASH_WRITE = -3,
    OPENDOTT_ERR_FLASH_READ = -4,
    OPENDOTT_ERR_NO_MEMORY = -5,
    OPENDOTT_ERR_DECODE_FAILED = -6,
};

/* Image format detection */
typedef enum {
    IMAGE_FORMAT_UNKNOWN = 0,
    IMAGE_FORMAT_GIF,
    IMAGE_FORMAT_PNG,
    IMAGE_FORMAT_JPEG,
    IMAGE_FORMAT_BMP,
} image_format_t;

/* Transfer states */
typedef enum {
    TRANSFER_IDLE,
    TRANSFER_TRIGGERED,
    TRANSFER_RECEIVING,
    TRANSFER_COMPLETE,
    TRANSFER_FAILED
} transfer_state_t;

/* Button events */
typedef enum {
    BUTTON_EVENT_SHORT_PRESS,
    BUTTON_EVENT_MEDIUM_PRESS,
    BUTTON_EVENT_LONG_PRESS,
} button_event_t;

/* Button callback function type */
typedef void (*button_callback_t)(button_event_t event);

/* BLE Service API */
int ble_service_init(uint8_t *rx_buffer, size_t rx_buffer_size);
transfer_state_t ble_get_transfer_state(void);
size_t ble_get_received_size(void);
void ble_transfer_complete(bool success);

/* Display API */
int display_init(void);
void display_clear(uint16_t color);
int opendott_set_brightness(uint8_t brightness);
int display_draw_buffer(uint16_t x, uint16_t y, uint16_t width, uint16_t height, const uint8_t *buf);
int display_show_image(const char *path);
void display_gif(const uint8_t *data, size_t size);

/* Storage API */
int storage_init(void);
int storage_save_gif(const uint8_t *data, size_t size, uint8_t slot);
int storage_load_gif(uint8_t *data, size_t max_size, uint8_t slot);
int storage_save_image(const uint8_t *data, size_t size, const char *name);
int storage_load_image(const char *name, uint8_t **data, size_t *size);
int storage_delete_image(const char *name);
int storage_get_free_space(size_t *free_bytes);
int storage_format(void);

/* Image Handler API */
image_format_t image_detect_format(const uint8_t *data, size_t size);
const char *image_format_to_string(image_format_t format);
bool image_validate(const uint8_t *data, size_t size);
int image_decode_and_display(const uint8_t *data, size_t size);

/* Button API */
int button_init(button_callback_t callback);

#endif /* OPENDOTT_H */
