/*
 * OpenDOTT - Display Driver
 * SPDX-License-Identifier: MIT
 * 
 * GC9A01 240x240 round display driver
 */

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/display.h>
#include <zephyr/drivers/pwm.h>
#include <zephyr/logging/log.h>

#include "opendott.h"

LOG_MODULE_REGISTER(display, CONFIG_LOG_DEFAULT_LEVEL);

/* Display device */
static const struct device *display_dev;

/* Backlight PWM */
static const struct pwm_dt_spec backlight = PWM_DT_SPEC_GET(DT_ALIAS(pwm_led0));

/* Frame buffer for double-buffering (optional, memory intensive) */
/* static uint16_t frame_buffer[DISPLAY_WIDTH * DISPLAY_HEIGHT]; */

/* Current brightness (0-100) */
static uint8_t current_brightness = 100;

int display_init(void)
{
    /* Get display device */
    display_dev = DEVICE_DT_GET(DT_CHOSEN(zephyr_display));
    if (!device_is_ready(display_dev)) {
        LOG_ERR("Display device not ready");
        return -ENODEV;
    }

    /* Initialize backlight */
    if (!pwm_is_ready_dt(&backlight)) {
        LOG_WRN("Backlight PWM not ready, skipping");
    } else {
        display_set_brightness(100);
    }

    /* Blanking off (turn on display) */
    display_blanking_off(display_dev);

    LOG_INF("Display initialized: %dx%d", DISPLAY_WIDTH, DISPLAY_HEIGHT);
    return 0;
}

int display_clear(void)
{
    if (!display_dev) {
        return -ENODEV;
    }

    /* Fill with black */
    struct display_buffer_descriptor desc = {
        .buf_size = DISPLAY_WIDTH * DISPLAY_HEIGHT * DISPLAY_BPP,
        .width = DISPLAY_WIDTH,
        .height = DISPLAY_HEIGHT,
        .pitch = DISPLAY_WIDTH,
    };

    /* Create a line buffer and write line by line to save memory */
    static uint16_t line_buffer[DISPLAY_WIDTH];
    memset(line_buffer, 0, sizeof(line_buffer));

    for (int y = 0; y < DISPLAY_HEIGHT; y++) {
        desc.height = 1;
        desc.buf_size = DISPLAY_WIDTH * DISPLAY_BPP;
        int ret = display_write(display_dev, 0, y, &desc, line_buffer);
        if (ret < 0) {
            LOG_ERR("Display write failed at y=%d: %d", y, ret);
            return ret;
        }
    }

    return 0;
}

int display_set_brightness(uint8_t brightness)
{
    if (brightness > 100) {
        brightness = 100;
    }

    current_brightness = brightness;

    if (!pwm_is_ready_dt(&backlight)) {
        return -ENODEV;
    }

    /* PWM period is 20ms, duty cycle based on brightness */
    uint32_t pulse = (backlight.period * brightness) / 100;
    
    int ret = pwm_set_pulse_dt(&backlight, pulse);
    if (ret < 0) {
        LOG_ERR("Failed to set backlight: %d", ret);
        return ret;
    }

    LOG_DBG("Brightness set to %d%%", brightness);
    return 0;
}

int display_draw_buffer(uint16_t *buffer, uint16_t x, uint16_t y,
                        uint16_t width, uint16_t height)
{
    if (!display_dev) {
        return -ENODEV;
    }

    /* Bounds check */
    if (x + width > DISPLAY_WIDTH || y + height > DISPLAY_HEIGHT) {
        LOG_ERR("Draw bounds exceeded: %d+%d > %d or %d+%d > %d",
                x, width, DISPLAY_WIDTH, y, height, DISPLAY_HEIGHT);
        return -EINVAL;
    }

    struct display_buffer_descriptor desc = {
        .buf_size = width * height * DISPLAY_BPP,
        .width = width,
        .height = height,
        .pitch = width,
    };

    int ret = display_write(display_dev, x, y, &desc, buffer);
    if (ret < 0) {
        LOG_ERR("Display write failed: %d", ret);
        return ret;
    }

    return 0;
}

int display_show_image(const char *path)
{
    uint8_t *data = NULL;
    size_t size = 0;

    /* Load image from storage */
    int ret = storage_load_image(path, &data, &size);
    if (ret < 0) {
        LOG_ERR("Failed to load image '%s': %d", path, ret);
        return ret;
    }

    /* Decode and display */
    ret = image_decode_and_display(data, size);

    /* Free the loaded data */
    k_free(data);

    return ret;
}
