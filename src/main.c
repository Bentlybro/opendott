/*
 * OpenDOTT - Main Application
 * SPDX-License-Identifier: MIT
 * 
 * Open source firmware for DOTT wearable display.
 * Because uploading a PNG shouldn't brick your device.
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/device.h>
#include <zephyr/drivers/display.h>

#include "opendott.h"

LOG_MODULE_REGISTER(main, CONFIG_LOG_DEFAULT_LEVEL);

/* Forward declarations */
static void on_button_event(button_event_t event);
static void on_transfer_complete(transfer_state_t state, int progress);
static void show_startup_screen(void);

/* Main application entry point */
int main(void)
{
    int ret;

    LOG_INF("========================================");
    LOG_INF("  OpenDOTT v%s", OPENDOTT_VERSION_STRING);
    LOG_INF("  Open source DOTT firmware");
    LOG_INF("========================================");

    /* Initialize display */
    LOG_INF("Initializing display...");
    ret = display_init();
    if (ret < 0) {
        LOG_ERR("Display init failed: %d", ret);
        /* Continue anyway - display might recover */
    } else {
        LOG_INF("Display initialized");
        show_startup_screen();
    }

    /* Initialize storage */
    LOG_INF("Initializing storage...");
    ret = storage_init();
    if (ret < 0) {
        LOG_ERR("Storage init failed: %d", ret);
        /* This is more serious but let's continue */
    } else {
        size_t free_space;
        storage_get_free_space(&free_space);
        LOG_INF("Storage initialized, %zu KB free", free_space / 1024);
    }

    /* Initialize button */
    LOG_INF("Initializing button...");
    ret = button_init(on_button_event);
    if (ret < 0) {
        LOG_ERR("Button init failed: %d", ret);
    } else {
        LOG_INF("Button initialized");
    }

    /* Initialize BLE service */
    LOG_INF("Initializing BLE...");
    ret = ble_service_init();
    if (ret < 0) {
        LOG_ERR("BLE init failed: %d", ret);
    } else {
        LOG_INF("BLE initialized");
        ble_set_transfer_callback(on_transfer_complete);
        
        /* Start advertising */
        ret = ble_start_advertising();
        if (ret < 0) {
            LOG_ERR("Failed to start advertising: %d", ret);
        } else {
            LOG_INF("BLE advertising started");
        }
    }

    /* Try to show the last saved image */
    LOG_INF("Loading last image...");
    ret = display_show_image("current.img");
    if (ret < 0) {
        LOG_INF("No saved image found, showing default");
        /* display_show_default() would show a built-in image */
    }

    LOG_INF("OpenDOTT ready!");

    /* Main loop - most work happens in callbacks and workqueue */
    while (1) {
        k_sleep(K_FOREVER);
    }

    return 0;
}

/* Button event handler */
static void on_button_event(button_event_t event)
{
    switch (event) {
    case BUTTON_EVENT_SHORT_PRESS:
        LOG_INF("Short press - cycling image");
        /* TODO: Cycle to next image in storage */
        break;

    case BUTTON_EVENT_MEDIUM_PRESS:
        LOG_INF("Medium press - toggling display");
        /* TODO: Toggle display on/off */
        break;

    case BUTTON_EVENT_LONG_PRESS:
        LOG_INF("Long press - factory reset");
        /* TODO: Implement factory reset */
        /* storage_format(); */
        /* sys_reboot(SYS_REBOOT_COLD); */
        break;
    }
}

/* BLE transfer callback */
static void on_transfer_complete(transfer_state_t state, int progress)
{
    switch (state) {
    case TRANSFER_IN_PROGRESS:
        LOG_INF("Transfer progress: %d%%", progress);
        break;

    case TRANSFER_COMPLETE:
        LOG_INF("Transfer complete, processing image...");
        /* The image handler will validate and display */
        break;

    case TRANSFER_ERROR:
        LOG_ERR("Transfer failed");
        /* TODO: Show error on display */
        break;

    default:
        break;
    }
}

/* Show startup splash screen */
static void show_startup_screen(void)
{
    /* TODO: Draw OpenDOTT logo */
    /* For now, just clear to a color */
    display_clear();
    
    /* Set full brightness */
    display_set_brightness(100);
}
