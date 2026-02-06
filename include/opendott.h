/*
 * OpenDOTT - Header File
 * SPDX-License-Identifier: MIT
 */

#ifndef OPENDOTT_H
#define OPENDOTT_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

/* Transfer states */
typedef enum {
    TRANSFER_IDLE,
    TRANSFER_TRIGGERED,
    TRANSFER_RECEIVING,
    TRANSFER_COMPLETE,
    TRANSFER_FAILED
} transfer_state_t;

/* BLE Service API */
int ble_service_init(uint8_t *rx_buffer, size_t rx_buffer_size);
transfer_state_t ble_get_transfer_state(void);
size_t ble_get_received_size(void);
void ble_transfer_complete(bool success);

/* Display API */
void display_gif(const uint8_t *data, size_t size);

/* Storage API */
int storage_init(void);
int storage_save_gif(const uint8_t *data, size_t size, uint8_t slot);
int storage_load_gif(uint8_t *data, size_t max_size, uint8_t slot);

#endif /* OPENDOTT_H */
