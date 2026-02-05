/*
 * OpenDOTT - Button Handler
 * SPDX-License-Identifier: MIT
 * 
 * Button input with short/medium/long press detection
 */

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/logging/log.h>

#include "opendott.h"

LOG_MODULE_REGISTER(button, CONFIG_LOG_DEFAULT_LEVEL);

/* Button timing thresholds (ms) */
#define SHORT_PRESS_MAX_MS    500
#define MEDIUM_PRESS_MAX_MS   3000
/* Long press is anything longer than MEDIUM_PRESS_MAX_MS */

/* Button GPIO */
static const struct gpio_dt_spec button = GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios);
static struct gpio_callback button_cb_data;

/* State tracking */
static button_callback_t user_callback = NULL;
static int64_t press_start_time = 0;
static struct k_work_delayable button_work;

/* Work handler for button release processing */
static void button_work_handler(struct k_work *work)
{
    int64_t press_duration = k_uptime_get() - press_start_time;

    button_event_t event;
    if (press_duration < SHORT_PRESS_MAX_MS) {
        event = BUTTON_EVENT_SHORT_PRESS;
        LOG_INF("Short press (%lld ms)", press_duration);
    } else if (press_duration < MEDIUM_PRESS_MAX_MS) {
        event = BUTTON_EVENT_MEDIUM_PRESS;
        LOG_INF("Medium press (%lld ms)", press_duration);
    } else {
        event = BUTTON_EVENT_LONG_PRESS;
        LOG_INF("Long press (%lld ms)", press_duration);
    }

    if (user_callback) {
        user_callback(event);
    }
}

/* GPIO interrupt callback */
static void button_pressed(const struct device *dev, struct gpio_callback *cb,
                           uint32_t pins)
{
    int state = gpio_pin_get_dt(&button);

    if (state) {
        /* Button pressed */
        press_start_time = k_uptime_get();
        LOG_DBG("Button pressed");
    } else {
        /* Button released - schedule work to process */
        k_work_schedule(&button_work, K_MSEC(10));  /* Small debounce */
        LOG_DBG("Button released");
    }
}

int button_init(button_callback_t callback)
{
    int ret;

    user_callback = callback;

    /* Check if button device is ready */
    if (!gpio_is_ready_dt(&button)) {
        LOG_ERR("Button GPIO not ready");
        return -ENODEV;
    }

    /* Configure as input with pull-up */
    ret = gpio_pin_configure_dt(&button, GPIO_INPUT);
    if (ret < 0) {
        LOG_ERR("Failed to configure button: %d", ret);
        return ret;
    }

    /* Configure interrupt on both edges */
    ret = gpio_pin_interrupt_configure_dt(&button, GPIO_INT_EDGE_BOTH);
    if (ret < 0) {
        LOG_ERR("Failed to configure button interrupt: %d", ret);
        return ret;
    }

    /* Set up callback */
    gpio_init_callback(&button_cb_data, button_pressed, BIT(button.pin));
    ret = gpio_add_callback(button.port, &button_cb_data);
    if (ret < 0) {
        LOG_ERR("Failed to add button callback: %d", ret);
        return ret;
    }

    /* Initialize work item */
    k_work_init_delayable(&button_work, button_work_handler);

    LOG_INF("Button initialized on GPIO %s pin %d",
            button.port->name, button.pin);
    return 0;
}
