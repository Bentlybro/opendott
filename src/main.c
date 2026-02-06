/*
 * OpenDOTT - Main Application
 * SPDX-License-Identifier: MIT
 * 
 * Open-source firmware for the DOTT wearable display
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "opendott.h"

LOG_MODULE_REGISTER(main, CONFIG_LOG_DEFAULT_LEVEL);

/* GIF receive buffer - reduced to fit in RAM with other allocations */
#define GIF_BUFFER_SIZE (64 * 1024)  /* 64KB max GIF size */
static uint8_t gif_buffer[GIF_BUFFER_SIZE];

/* Transfer timeout work */
static struct k_work_delayable transfer_timeout_work;
#define TRANSFER_TIMEOUT_MS 3000  /* 3 second timeout after last data */

/* Forward declarations */
static void transfer_timeout_handler(struct k_work *work);
static void button_callback(button_event_t event);

/* Button event handler */
static void button_callback(button_event_t event)
{
    switch (event) {
    case BUTTON_EVENT_SHORT_PRESS:
        LOG_INF("Short press - next image");
        /* TODO: Cycle through stored images */
        break;
    case BUTTON_EVENT_MEDIUM_PRESS:
        LOG_INF("Medium press - toggle mode");
        /* TODO: Toggle display mode */
        break;
    case BUTTON_EVENT_LONG_PRESS:
        LOG_INF("Long press - entering settings");
        /* TODO: Enter settings mode */
        break;
    }
}

/* Transfer timeout - called when no data received for a while */
static void transfer_timeout_handler(struct k_work *work)
{
    transfer_state_t state = ble_get_transfer_state();
    
    if (state == TRANSFER_RECEIVING) {
        size_t received = ble_get_received_size();
        LOG_INF("Transfer timeout, received %zu bytes", received);
        
        /* Validate and display the received image */
        if (received > 0) {
            if (image_validate(gif_buffer, received)) {
                LOG_INF("Image validated successfully");
                ble_transfer_complete(true);
                
                /* Display the image */
                int ret = image_decode_and_display(gif_buffer, received);
                if (ret < 0) {
                    LOG_ERR("Failed to display image: %d", ret);
                }
            } else {
                LOG_ERR("Image validation failed - rejecting upload");
                ble_transfer_complete(false);
            }
        } else {
            LOG_WRN("No data received");
            ble_transfer_complete(false);
        }
    }
}

/* Main entry point */
int main(void)
{
    int err;
    
    LOG_INF("OpenDOTT starting...");
    LOG_INF("Build: " __DATE__ " " __TIME__);
    
    /* Initialize transfer timeout work */
    k_work_init_delayable(&transfer_timeout_work, transfer_timeout_handler);
    
    /* Initialize storage */
    err = storage_init();
    if (err) {
        LOG_ERR("Storage init failed: %d", err);
        /* Continue - we can still receive and display images */
    }
    
    /* Initialize display */
    err = display_init();
    if (err) {
        LOG_ERR("Display init failed: %d", err);
        /* Continue anyway - BLE should still work */
    } else {
        /* Clear display to black */
        display_clear(0x0000);
    }
    
    /* Initialize button */
    err = button_init(button_callback);
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
