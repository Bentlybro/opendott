/*
 * OpenDOTT - Display Driver
 * SPDX-License-Identifier: MIT
 * 
 * GC9A01 240x240 round display driver
 * 
 * Note: Using minimal direct SPI implementation due to Zephyr driver bug
 * with display-inversion boolean property handling.
 */

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/spi.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/pwm.h>
#include <zephyr/logging/log.h>
#include <string.h>

#include "opendott.h"

LOG_MODULE_REGISTER(display, CONFIG_LOG_DEFAULT_LEVEL);

/* Backlight PWM */
static const struct pwm_dt_spec backlight = PWM_DT_SPEC_GET(DT_ALIAS(pwm_led0));

/* Display SPI and control GPIOs */
static const struct spi_dt_spec spi_dev = SPI_DT_SPEC_GET(DT_NODELABEL(gc9a01), 
    SPI_OP_MODE_MASTER | SPI_WORD_SET(8), 0);
static const struct gpio_dt_spec dc_gpio = GPIO_DT_SPEC_GET(DT_NODELABEL(gc9a01), cmd_data_gpios);
static const struct gpio_dt_spec reset_gpio = GPIO_DT_SPEC_GET(DT_NODELABEL(gc9a01), reset_gpios);

/* Current brightness (0-100) */
static uint8_t current_brightness = 100;
static bool display_initialized = false;

/* Send command to display */
static int display_send_cmd(uint8_t cmd)
{
    gpio_pin_set_dt(&dc_gpio, 0);  /* Command mode */
    
    struct spi_buf buf = { .buf = &cmd, .len = 1 };
    struct spi_buf_set bufs = { .buffers = &buf, .count = 1 };
    
    return spi_write_dt(&spi_dev, &bufs);
}

/* Send data to display */
static int display_send_data(const uint8_t *data, size_t len)
{
    gpio_pin_set_dt(&dc_gpio, 1);  /* Data mode */
    
    struct spi_buf buf = { .buf = (void *)data, .len = len };
    struct spi_buf_set bufs = { .buffers = &buf, .count = 1 };
    
    return spi_write_dt(&spi_dev, &bufs);
}

int display_init(void)
{
    int ret;

    /* Check SPI device */
    if (!spi_is_ready_dt(&spi_dev)) {
        LOG_ERR("SPI device not ready");
        return -ENODEV;
    }

    /* Configure DC GPIO */
    if (!gpio_is_ready_dt(&dc_gpio)) {
        LOG_ERR("DC GPIO not ready");
        return -ENODEV;
    }
    ret = gpio_pin_configure_dt(&dc_gpio, GPIO_OUTPUT_ACTIVE);
    if (ret < 0) {
        LOG_ERR("Failed to configure DC GPIO: %d", ret);
        return ret;
    }

    /* Configure and pulse reset GPIO */
    if (!gpio_is_ready_dt(&reset_gpio)) {
        LOG_ERR("Reset GPIO not ready");
        return -ENODEV;
    }
    ret = gpio_pin_configure_dt(&reset_gpio, GPIO_OUTPUT_ACTIVE);
    if (ret < 0) {
        LOG_ERR("Failed to configure reset GPIO: %d", ret);
        return ret;
    }

    /* Reset sequence */
    gpio_pin_set_dt(&reset_gpio, 0);
    k_msleep(10);
    gpio_pin_set_dt(&reset_gpio, 1);
    k_msleep(120);

    /* Basic GC9A01 initialization sequence */
    display_send_cmd(0xEF);  /* Inter register enable 2 */
    display_send_cmd(0xEB);
    uint8_t data_14[] = {0x14};
    display_send_data(data_14, 1);
    
    display_send_cmd(0xFE);  /* Inter register enable 1 */
    display_send_cmd(0xEF);  /* Inter register enable 2 */
    
    display_send_cmd(0x36);  /* Memory access control */
    uint8_t madctl = 0x48;   /* MX + BGR */
    display_send_data(&madctl, 1);
    
    display_send_cmd(0x3A);  /* Pixel format */
    uint8_t pixfmt = 0x55;   /* RGB565 */
    display_send_data(&pixfmt, 1);
    
    display_send_cmd(0x21);  /* Display inversion on */
    
    display_send_cmd(0x11);  /* Sleep out */
    k_msleep(120);
    
    display_send_cmd(0x29);  /* Display on */
    k_msleep(20);

    /* Initialize backlight */
    if (pwm_is_ready_dt(&backlight)) {
        opendott_set_brightness(100);
    } else {
        LOG_WRN("Backlight PWM not ready");
    }

    display_initialized = true;
    LOG_INF("Display initialized: %dx%d", DISPLAY_WIDTH, DISPLAY_HEIGHT);
    return 0;
}

void display_clear(uint16_t color)
{
    if (!display_initialized) {
        return;
    }

    /* Set column address (0-239) */
    display_send_cmd(0x2A);
    uint8_t col_data[] = {0x00, 0x00, 0x00, 0xEF};
    display_send_data(col_data, 4);

    /* Set row address (0-239) */
    display_send_cmd(0x2B);
    uint8_t row_data[] = {0x00, 0x00, 0x00, 0xEF};
    display_send_data(row_data, 4);

    /* Write to RAM */
    display_send_cmd(0x2C);

    /* Fill with color (RGB565, big-endian) */
    uint8_t color_be[2] = { (color >> 8) & 0xFF, color & 0xFF };
    
    gpio_pin_set_dt(&dc_gpio, 1);  /* Data mode */
    
    /* Write line by line to avoid large buffers */
    uint8_t line_buf[DISPLAY_WIDTH * 2];
    for (int i = 0; i < DISPLAY_WIDTH; i++) {
        line_buf[i * 2] = color_be[0];
        line_buf[i * 2 + 1] = color_be[1];
    }
    
    for (int y = 0; y < DISPLAY_HEIGHT; y++) {
        struct spi_buf buf = { .buf = line_buf, .len = sizeof(line_buf) };
        struct spi_buf_set bufs = { .buffers = &buf, .count = 1 };
        spi_write_dt(&spi_dev, &bufs);
    }
}

int opendott_set_brightness(uint8_t brightness)
{
    if (brightness > 100) {
        brightness = 100;
    }

    current_brightness = brightness;

    if (!pwm_is_ready_dt(&backlight)) {
        return -ENODEV;
    }

    uint32_t pulse = (backlight.period * brightness) / 100;
    
    int ret = pwm_set_pulse_dt(&backlight, pulse);
    if (ret < 0) {
        LOG_ERR("Failed to set backlight: %d", ret);
        return ret;
    }

    LOG_DBG("Brightness set to %d%%", brightness);
    return 0;
}

int display_draw_buffer(uint16_t x, uint16_t y, uint16_t width, uint16_t height,
                        const uint8_t *buf)
{
    if (!display_initialized) {
        return -ENODEV;
    }

    /* Bounds check */
    if (x + width > DISPLAY_WIDTH || y + height > DISPLAY_HEIGHT) {
        LOG_ERR("Draw bounds exceeded");
        return -EINVAL;
    }

    /* Set column address */
    display_send_cmd(0x2A);
    uint8_t col_data[] = {
        (x >> 8) & 0xFF, x & 0xFF,
        ((x + width - 1) >> 8) & 0xFF, (x + width - 1) & 0xFF
    };
    display_send_data(col_data, 4);

    /* Set row address */
    display_send_cmd(0x2B);
    uint8_t row_data[] = {
        (y >> 8) & 0xFF, y & 0xFF,
        ((y + height - 1) >> 8) & 0xFF, (y + height - 1) & 0xFF
    };
    display_send_data(row_data, 4);

    /* Write to RAM */
    display_send_cmd(0x2C);
    display_send_data(buf, width * height * DISPLAY_BPP);

    return 0;
}

int display_show_image(const char *path)
{
    uint8_t *data = NULL;
    size_t size = 0;

    int ret = storage_load_image(path, &data, &size);
    if (ret < 0) {
        LOG_ERR("Failed to load image '%s': %d", path, ret);
        return ret;
    }

    ret = image_decode_and_display(data, size);
    k_free(data);

    return ret;
}

void display_gif(const uint8_t *data, size_t size)
{
    if (!data || size == 0) {
        LOG_ERR("Invalid GIF data");
        return;
    }

    int ret = image_decode_and_display(data, size);
    if (ret < 0) {
        LOG_ERR("Failed to display GIF: %d", ret);
    }
}
