/*
 * OpenDOTT - Main Application
 * SPDX-License-Identifier: MIT
 * 
 * Open-source firmware for the DOTT wearable display
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/drivers/display.h>
#include <zephyr/drivers/gpio.h>

#include "opendott.h"

LOG_MODULE_REGISTER(main, CONFIG_LOG_DEFAULT_LEVEL);

/* Display device */
static const struct device *display_dev;

/* Button */
static const struct gpio_dt_spec button = GPIO_DT_SPEC_GET_OR(DT_ALIAS(sw0), gpios, {0});
static struct gpio_callback button_cb_data;

/* GIF receive buffer (allocate from heap or use static) */
#define GIF_BUFFER_SIZE (256 * 1024)  /* 256KB max GIF size */
static uint8_t gif_buffer[GIF_BUFFER_SIZE];

/* Transfer timeout work */
static struct k_work_delayable transfer_timeout_work;
#define TRANSFER_TIMEOUT_MS 3000  /* 3 second timeout after last data */

/* Last data receive time */
static int64_t last_data_time = 0;

/* Forward declarations */
static void transfer_timeout_handler(struct k_work *work);
static void button_pressed(const struct device *dev, struct gpio_callback *cb, uint32_t pins);

/* Initialize display */
static int init_display(void)
{
    display_dev = DEVICE_DT_GET(DT_CHOSEN(zephyr_display));
    
    if (!device_is_ready(display_dev)) {
        LOG_ERR("Display device not ready");
        return -ENODEV;
    }
    
    LOG_INF("Display initialized: %s", display_dev->name);
    
    /* Clear display */
    display_blanking_off(display_dev);
    
    return 0;
}

/* Initialize button */
static int init_button(void)
{
    if (!gpio_is_ready_dt(&button)) {
        LOG_WRN("Button device not ready");
        return -ENODEV;
    }
    
    int err = gpio_pin_configure_dt(&button, GPIO_INPUT);
    if (err) {
        LOG_ERR("Failed to configure button: %d", err);
        return err;
    }
    
    err = gpio_pin_interrupt_configure_dt(&button, GPIO_INT_EDGE_TO_ACTIVE);
    if (err) {
        LOG_ERR("Failed to configure button interrupt: %d", err);
        return err;
    }
    
    gpio_init_callback(&button_cb_data, button_pressed, BIT(button.pin));
    gpio_add_callback(button.port, &button_cb_data);
    
    LOG_INF("Button initialized");
    
    return 0;
}

/* Button press handler */
static void button_pressed(const struct device *dev, struct gpio_callback *cb, uint32_t pins)
{
    LOG_INF("Button pressed!");
    
    /* TODO: Cycle through stored GIFs, toggle mode, etc. */
}

/* Transfer timeout - called when no data received for a while */
static void transfer_timeout_handler(struct k_work *work)
{
    transfer_state_t state = ble_get_transfer_state();
    
    if (state == TRANSFER_RECEIVING) {
        size_t received = ble_get_received_size();
        LOG_INF("Transfer timeout, received %u bytes", received);
        
        /* Check if we received a complete GIF (ends with 0x3B) */
        if (received > 0 && gif_buffer[received - 1] == 0x3B) {
            LOG_INF("GIF trailer found, transfer successful");
            ble_transfer_complete(true);
            
            /* TODO: Save to flash and display */
            display_gif(gif_buffer, received);
            
        } else {
            LOG_WRN("No GIF trailer, assuming complete anyway");
            ble_transfer_complete(true);
            display_gif(gif_buffer, received);
        }
    }
}

/* Display a GIF on screen */
void display_gif(const uint8_t *data, size_t size)
{
    LOG_INF("Displaying GIF: %u bytes", size);
    
    /* TODO: Implement GIF decoder and display
     * For now, just log that we would display it
     * 
     * Steps:
     * 1. Parse GIF header
     * 2. Decode frames
     * 3. Display each frame with timing
     * 4. Loop if animated
     */
    
    /* Placeholder: fill screen with a color to show it worked */
    struct display_buffer_descriptor desc = {
        .buf_size = 240 * 240 * 2,  /* RGB565 */
        .width = 240,
        .height = 240,
        .pitch = 240,
    };
    
    /* Create a simple pattern */
    static uint16_t frame[240 * 240];
    for (int y = 0; y < 240; y++) {
        for (int x = 0; x < 240; x++) {
            /* Green pattern to show success */
            frame[y * 240 + x] = 0x07E0;  /* RGB565 green */
        }
    }
    
    display_write(display_dev, 0, 0, &desc, frame);
    
    LOG_INF("Display updated");
}

/* Main entry point */
int main(void)
{
    int err;
    
    LOG_INF("OpenDOTT starting...");
    LOG_INF("Build: " __DATE__ " " __TIME__);
    
    /* Initialize transfer timeout work */
    k_work_init_delayable(&transfer_timeout_work, transfer_timeout_handler);
    
    /* Initialize display */
    err = init_display();
    if (err) {
        LOG_ERR("Display init failed: %d", err);
        /* Continue anyway - BLE should still work */
    }
    
    /* Initialize button */
    err = init_button();
    if (err) {
        LOG_WRN("Button init failed: %d", err);
    }
    
    /* Initialize BLE service */
    err = ble_service_init(gif_buffer, sizeof(gif_buffer));
    if (err) {
        LOG_ERR("BLE init failed: %d", err);
        return err;
    }
    
    LOG_INF("OpenDOTT ready!");
    LOG_INF("Waiting for BLE connection...");
    
    /* Main loop */
    while (1) {
        transfer_state_t state = ble_get_transfer_state();
        
        if (state == TRANSFER_RECEIVING) {
            /* Reset timeout on each check if still receiving */
            k_work_reschedule(&transfer_timeout_work, K_MSEC(TRANSFER_TIMEOUT_MS));
        }
        
        k_sleep(K_MSEC(100));
    }
    
    return 0;
}
